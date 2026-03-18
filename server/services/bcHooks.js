const bc = require('./bc');
const sseManager = require('./sse');
const { stmts } = require('../db');
const { SEARCH_DEBOUNCE, CONFIGS_TTL, STALE_CALL_THRESHOLD, STALE_CALL_CLEANUP_INTERVAL } = require('../constants');

/**
 * Business Central Hooks for AMI Events (Multi-Tenant)
 * - DialBegin: Search BC contact URL and cache it
 * - DialEnd (ANSWER): Send screen pop to operator (opens BC automatically)
 * - Hangup: Register answered call in BC
 */

const activeCalls = new Map();
const recentSearches = new Map();

// Cached enabled configs with TTL
let enabledConfigs = [];
let configsLastLoaded = 0;

function getEnabledConfigs() {
  if (Date.now() - configsLastLoaded < CONFIGS_TTL && enabledConfigs.length > 0) {
    return enabledConfigs;
  }
  enabledConfigs = bc.getAllConfigs();
  configsLastLoaded = Date.now();
  return enabledConfigs;
}

function reloadConfigs() {
  configsLastLoaded = 0;
}

function setupBcHooks(amiService) {
  amiService.on('ami_event', async (event) => {
    try {
      if (!['DialBegin', 'DialEnd', 'Hangup'].includes(event.Event)) return;

      const channel = event.Channel || '';

      if (event.Event !== 'DialBegin') {
        if (event.Event === 'DialEnd') {
          handleDialEnd(event);
        } else if (event.Event === 'Hangup') {
          const call = activeCalls.get(channel);
          if (call) {
            const configs = getEnabledConfigs();
            const config = configs.find(c => c.tenant_id === call.tenantId);
            if (config) {
              handleHangup(event, config);
            } else {
              activeCalls.delete(channel);
            }
          } else {
            activeCalls.delete(channel);
          }
        }
        return;
      }

      // DialBegin: find matching tenant config
      const configs = getEnabledConfigs();
      if (configs.length === 0) return;

      const dest = event.DestChannel || '';

      for (const config of configs) {
        const tid = config.tenant_id;
        if (dest.includes(`ext${tid}`) || dest.includes(`pd${tid}`)) {
          handleDialBegin(event, config);
          break;
        }
      }
    } catch (err) {
      console.error('BC hooks error:', err.message);
    }
  });

  console.log('BC hooks: Listening for AMI events (multi-tenant)');
}

function handleDialBegin(event, config) {
  const callerNum = event.CallerIDNum || '';
  const channel = event.Channel || '';
  const destChannel = event.DestChannel || '';

  if (callerNum.length < 7) return;

  const sipPeerMatch = destChannel.match(/SIP\/(ext\d+)-/i);
  if (!sipPeerMatch) return;

  const sipPeer = sipPeerMatch[1];
  const extMatch = sipPeer.match(/ext\d{5}(\d+)/);
  const extension = extMatch ? extMatch[1] : sipPeer;

  activeCalls.set(channel, {
    callerNumber: callerNum,
    sipPeer,
    extension,
    tenantId: config.tenant_id,
    startTime: Date.now(),
    answered: false,
    bcUrl: null,
    found: false,
    type: null,
    name: null,
    newContactUrl: null
  });

  // Debounce: pre-search BC URL while ringing
  const searchKey = `bc_${callerNum}_${sipPeer}`;
  if (recentSearches.has(searchKey)) return;
  recentSearches.set(searchKey, true);
  setTimeout(() => recentSearches.delete(searchKey), SEARCH_DEBOUNCE);

  // Search BC URL now (while ringing) and store result in activeCalls
  preSearchBcUrl(callerNum, channel, config).catch(err => {
    console.error(`[BC:${config.tenant_id}] Pre-search error:`, err.message);
  });
}

async function preSearchBcUrl(phone, channel, config) {
  const bcUrl = await bc.obtenerURL(phone, config);
  const contactFound = !!bcUrl;
  const fallbackUrl = bc.getWebClientUrl(config);
  const newContactUrl = `${bc.getWebClientUrl(config)}&page=5052&phoneno=${encodeURIComponent(phone)}`;

  console.log(`[BC:${config.tenant_id}] ObtenerURL(${phone}) -> ${bcUrl || '(empty)'}`);

  let finalUrl = bcUrl || fallbackUrl;
  let found = contactFound;
  let type = contactFound ? 'contact' : null;
  let name = null;

  // Fallback: if not found as contact, search vendors via REST API
  if (!contactFound) {
    const vendorResult = await bc.searchVendorByPhone(phone, config);
    if (vendorResult.found) {
      finalUrl = vendorResult.vendorUrl;
      found = true;
      type = 'vendor';
      name = vendorResult.vendorName;
      console.log(`[BC:${config.tenant_id}] Vendor found: ${name} (${vendorResult.vendorNo})`);
    }
  }

  // Log in call_log
  const startedAt = new Date().toISOString();
  stmts.insertCallLog.run(config.tenant_id, null, phone, finalUrl, found ? 1 : 0, 0, 0, startedAt, null);

  // Store results in the active call for when it's answered
  const call = activeCalls.get(channel);
  if (call) {
    call.bcUrl = finalUrl;
    call.found = found;
    call.type = type;
    call.name = name;
    call.newContactUrl = newContactUrl;
  }
}

function handleDialEnd(event) {
  const channel = event.Channel || '';
  const call = activeCalls.get(channel);
  if (!call) return;

  if (event.DialStatus === 'ANSWER') {
    call.answered = true;

    // NOW send screen pop — call was answered
    if (call.bcUrl) {
      sseManager.sendToSipPeer(call.sipPeer, 'bc_screen_pop', {
        phone: call.callerNumber,
        bcUrl: call.bcUrl,
        found: call.found,
        type: call.type,
        name: call.name,
        newContactUrl: call.newContactUrl,
        channel
      }, call.tenantId);
    }
  }
}

function handleHangup(event, config) {
  const channel = event.Channel || '';
  const call = activeCalls.get(channel);
  if (!call) {
    activeCalls.delete(channel);
    return;
  }

  activeCalls.delete(channel);

  if (!call.answered) return;

  bc.registrarLlamada(call.extension, call.callerNumber, config).then((ok) => {
    console.log(`[BC:${config.tenant_id}] Call registered: ext=${call.extension}, phone=${call.callerNumber}, ok=${ok}`);

    // Update call_log
    const endedAt = new Date().toISOString();
    stmts.insertCallLog.run(config.tenant_id, call.extension, call.callerNumber, '', 1, 1, ok ? 1 : 0, new Date(call.startTime).toISOString(), endedAt);
  }).catch(err => {
    console.error(`[BC:${config.tenant_id}] Register call error:`, err.message);
  });
}

// Clean up stale calls periodically
setInterval(() => {
  const now = Date.now();
  for (const [channel, call] of activeCalls) {
    if (now - call.startTime > STALE_CALL_THRESHOLD) {
      activeCalls.delete(channel);
    }
  }
}, STALE_CALL_CLEANUP_INTERVAL);

module.exports = { setupBcHooks, reloadConfigs };
