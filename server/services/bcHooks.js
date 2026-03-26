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
          await handleDialEnd(event);
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

  // Key by destChannel (extension channel) to avoid ring group overwrites
  activeCalls.set(destChannel, {
    callerNumber: callerNum,
    callerChannel: channel,
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
  // Store the promise so handleDialEnd can await it if needed
  const call = activeCalls.get(destChannel);
  if (call) {
    call.searchPromise = preSearchBcUrl(callerNum, destChannel, config).catch(err => {
      console.error(`[BC:${config.tenant_id}] Pre-search error:`, err.message);
    });
  }
}

async function preSearchBcUrl(phone, channel, config) {
  const fallbackUrl = bc.getWebClientUrl(config);
  const newContactUrl = `${bc.getWebClientUrl(config)}&page=5052&phoneno=${encodeURIComponent(phone)}`;

  const allResults = []; // { no, name, url, type }

  // Run all 3 searches in parallel
  const [bcUrl, customers, vendors] = await Promise.all([
    bc.obtenerURL(phone, config).catch(err => { console.error(`[BC:${config.tenant_id}] SOAP error:`, err.message); return ''; }),
    bc.searchCustomersByPhone(phone, config).catch(err => { console.error(`[BC:${config.tenant_id}] Customer search error:`, err.message); return []; }),
    bc.searchVendorsByPhone(phone, config).catch(err => { console.error(`[BC:${config.tenant_id}] Vendor search error:`, err.message); return []; })
  ]);

  // 1. SOAP result first (highest priority)
  console.log(`[BC:${config.tenant_id}] ObtenerURL(${phone}) -> ${bcUrl || '(empty)'}`);
  if (bcUrl) {
    allResults.push({ no: 'SOAP', name: '', url: bcUrl, type: 'customer' });
  }

  // 2. Customer results
  for (const c of customers) {
    if (!allResults.some(r => r.url === c.url)) {
      allResults.push(c);
      console.log(`[BC:${config.tenant_id}] Customer found: ${c.name} (${c.no})`);
    }
  }

  // 3. Vendor results
  for (const v of vendors) {
    allResults.push(v);
    console.log(`[BC:${config.tenant_id}] Vendor found: ${v.name} (${v.no})`);
  }

  const found = allResults.length > 0;
  const primaryType = allResults[0]?.type || null;
  const primaryName = allResults[0]?.name || null;
  const primaryUrl = allResults[0]?.url || fallbackUrl;

  // Log in call_log
  const startedAt = new Date().toISOString();
  stmts.insertCallLog.run(config.tenant_id, null, phone, primaryUrl, found ? 1 : 0, 0, 0, startedAt, null);

  // Store results in the active call for when it's answered
  const call = activeCalls.get(channel);
  if (call) {
    call.bcUrl = primaryUrl;
    call.found = found;
    call.type = primaryType;
    call.name = primaryName;
    call.newContactUrl = newContactUrl;
    call.allResults = allResults; // All matching records
  }
}

async function handleDialEnd(event) {
  const destChannel = event.DestChannel || '';
  const call = activeCalls.get(destChannel);
  if (!call) return;

  if (event.DialStatus === 'ANSWER') {
    call.answered = true;

    // Wait for pre-search to finish if still in progress
    if (call.searchPromise) {
      await call.searchPromise;
    }

    // NOW send screen pop — call was answered by THIS extension
    if (call.bcUrl) {
      console.log(`[BC:${call.tenantId}] Screen pop -> ${call.sipPeer} (ext ${call.extension}), phone: ${call.callerNumber}, results: ${(call.allResults || []).length}`);
      sseManager.sendToSipPeer(call.sipPeer, 'bc_screen_pop', {
        phone: call.callerNumber,
        bcUrl: call.bcUrl,
        found: call.found,
        type: call.type,
        name: call.name,
        newContactUrl: call.newContactUrl,
        allResults: call.allResults || [],
        channel: destChannel
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

async function warmupCaches() {
  const configs = getEnabledConfigs();
  if (configs.length === 0) {
    console.log('BC warmup: No enabled tenants, skipping');
    return;
  }

  for (const config of configs) {
    try {
      console.log(`[BC:${config.tenant_id}] Warming up caches...`);
      const start = Date.now();

      // Pre-fetch OAuth token + Customer/Vendor phone maps in parallel
      await Promise.all([
        bc.searchCustomersByPhone('0000000', config),
        bc.searchVendorsByPhone('0000000', config)
      ]);

      const elapsed = Date.now() - start;
      console.log(`[BC:${config.tenant_id}] Cache warmup done in ${elapsed}ms`);
    } catch (err) {
      console.error(`[BC:${config.tenant_id}] Cache warmup error:`, err.message);
    }
  }
}

module.exports = { setupBcHooks, reloadConfigs, warmupCaches };
