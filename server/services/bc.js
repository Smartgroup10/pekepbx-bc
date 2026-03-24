const { stmts } = require('../db');
const { encrypt, decrypt, isEncrypted } = require('../utils/crypto');
const { FETCH_TIMEOUT, VENDOR_CACHE_TTL } = require('../constants');

/**
 * Business Central SOAP Integration Service (Multi-Tenant)
 * Uses OAuth 2.0 client credentials flow + SOAP web services
 * Each tenant config stored as integration = 'bc_{tenantId}'
 */

const configCache = new Map();
const tokenCache = new Map();
const vendorPhoneCache = new Map();
const customerPhoneCache = new Map();

// ============================================================================
// FETCH WITH TIMEOUT
// ============================================================================

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============================================================================
// CONFIG MANAGEMENT
// ============================================================================

function getConfig(tenantId) {
  if (!tenantId) return {};

  if (configCache.has(tenantId)) return configCache.get(tenantId);

  const integrationKey = `bc_${tenantId}`;
  const rows = stmts.getConfig.all(integrationKey);

  const config = { tenant_id: tenantId };
  for (const row of rows) {
    if (row.config_key === 'client_secret' && row.config_value) {
      // Decrypt secret; auto-migrate if stored in plaintext
      if (isEncrypted(row.config_value)) {
        config.client_secret = decrypt(row.config_value);
      } else {
        config.client_secret = row.config_value;
        // Auto-migrate: encrypt the plaintext secret in DB
        const encrypted = encrypt(row.config_value);
        stmts.upsertConfig.run(integrationKey, 'client_secret', encrypted);
      }
    } else {
      config[row.config_key] = row.config_value;
    }
  }

  if (config.client_id) {
    configCache.set(tenantId, config);
  }

  return config;
}

function getAllConfigs() {
  const rows = stmts.getAllBcConfigs.all();

  const configsByTenant = {};
  for (const row of rows) {
    const tenantId = row.integration.replace('bc_', '');
    if (!configsByTenant[tenantId]) {
      configsByTenant[tenantId] = { tenant_id: tenantId };
    }
    if (row.config_key === 'client_secret' && row.config_value) {
      if (isEncrypted(row.config_value)) {
        configsByTenant[tenantId].client_secret = decrypt(row.config_value);
      } else {
        configsByTenant[tenantId].client_secret = row.config_value;
        // Auto-migrate
        const encrypted = encrypt(row.config_value);
        stmts.upsertConfig.run(row.integration, 'client_secret', encrypted);
      }
    } else {
      configsByTenant[tenantId][row.config_key] = row.config_value;
    }
  }

  const result = [];
  for (const [tenantId, config] of Object.entries(configsByTenant)) {
    if (config.client_id) configCache.set(tenantId, config);
    if (isEnabled(config)) {
      result.push(config);
    }
  }

  return result;
}

function getConfiguredTenants() {
  const rows = stmts.getAllBcConfigs.all();
  const tenants = new Set();
  for (const row of rows) {
    tenants.add(row.integration.replace('bc_', ''));
  }
  return [...tenants];
}

function saveConfig(tenantId, configObj) {
  if (!tenantId) throw new Error('tenantId es requerido');

  const integrationKey = `bc_${tenantId}`;
  const keys = ['client_id', 'client_secret', 'azure_tenant_id', 'bc_environment', 'bc_company', 'enabled'];

  for (const key of keys) {
    if (configObj[key] !== undefined) {
      let val = typeof configObj[key] === 'string' ? configObj[key].trim() : configObj[key];
      // Encrypt client_secret before storing
      if (key === 'client_secret' && val) {
        val = encrypt(val);
      }
      stmts.upsertConfig.run(integrationKey, key, val);
    }
  }

  configCache.delete(tenantId);
  tokenCache.delete(tenantId);
}

function deleteConfig(tenantId) {
  if (!tenantId) throw new Error('tenantId es requerido');
  const integrationKey = `bc_${tenantId}`;
  stmts.deleteConfigByIntegration.run(integrationKey);
  configCache.delete(tenantId);
  tokenCache.delete(tenantId);
}

function isEnabled(config) {
  return config && config.enabled === '1' && config.client_id && config.client_secret && config.azure_tenant_id && config.bc_environment && config.bc_company;
}

// ============================================================================
// OAUTH 2.0 TOKEN MANAGEMENT
// ============================================================================

async function getAccessToken(config) {
  const tenantId = config.tenant_id;

  if (tenantId && tokenCache.has(tenantId)) {
    const cached = tokenCache.get(tenantId);
    if (cached.expiresAt > Date.now() + 300000) {
      return cached.token;
    }
  }

  const tokenUrl = `https://login.microsoftonline.com/${config.azure_tenant_id}/oauth2/v2.0/token`;

  const response = await fetchWithTimeout(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.client_id,
      client_secret: config.client_secret,
      scope: 'https://api.businesscentral.dynamics.com/.default',
      grant_type: 'client_credentials'
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OAuth token error: ${response.status}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`OAuth error: ${data.error_description || data.error}`);
  }

  if (tenantId) {
    tokenCache.set(tenantId, {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in * 1000)
    });
  }

  return data.access_token;
}

// ============================================================================
// SOAP HELPERS
// ============================================================================

function getServiceUrl(config) {
  return `https://api.businesscentral.dynamics.com/v2.0/${config.azure_tenant_id}/${config.bc_environment}/WS/${config.bc_company}/Codeunit/WSRegistroLlamadas`;
}

async function soapCall(config, soapAction, bodyXml) {
  const token = await getAccessToken(config);
  const url = getServiceUrl(config);

  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="urn:microsoft-dynamics-schemas/codeunit/WSRegistroLlamadas" xmlns:reg="urn:microsoft-dynamics-nav/xmlports/x50090">
  <soap:Body>
    ${bodyXml}
  </soap:Body>
</soap:Envelope>`;

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': soapAction,
      'Authorization': `Bearer ${token}`
    },
    body: envelope
  });

  const text = await response.text();

  if (!response.ok) {
    const faultMatch = text.match(/<faultstring[^>]*>([^<]+)<\/faultstring>/);
    throw new Error(`BC SOAP error (${response.status}): ${faultMatch ? faultMatch[1] : 'Error en servicio web'}`);
  }

  return text;
}

// ============================================================================
// BUSINESS METHODS
// ============================================================================

async function obtenerURL(phone, config) {
  if (!phone) return '';

  const bodyXml = `<tns:ObtenerURL><tns:codTelefono>${escapeXml(phone)}</tns:codTelefono></tns:ObtenerURL>`;
  const result = await soapCall(config, 'urn:microsoft-dynamics-schemas/codeunit/WSRegistroLlamadas:ObtenerURL', bodyXml);

  const match = result.match(/<return_value>([^<]*)<\/return_value>/);
  return match ? unescapeXml(match[1]) : '';
}

async function registrarLlamada(extension, phone, config) {
  const bodyXml = `<tns:RegistrarLlamada>
  <tns:xMLRegistroLlamadas>
    <reg:Registro>
      <reg:Extension>${parseInt(extension) || 0}</reg:Extension>
      <reg:Telefono>${escapeXml(phone)}</reg:Telefono>
    </reg:Registro>
  </tns:xMLRegistroLlamadas>
</tns:RegistrarLlamada>`;

  const result = await soapCall(config, 'urn:microsoft-dynamics-schemas/codeunit/WSRegistroLlamadas:RegistrarLlamada', bodyXml);

  const match = result.match(/<return_value>([^<]*)<\/return_value>/);
  return match ? match[1] === 'true' : false;
}

async function testConnection(configOverride, tenantId) {
  const config = configOverride || (tenantId ? getConfig(tenantId) : {});

  if (!config.client_id || !config.client_secret || !config.azure_tenant_id || !config.bc_environment || !config.bc_company) {
    throw new Error('Configuracion incompleta. Se requiere Client ID, Secret, Azure Tenant, Environment y Company.');
  }

  if (config.tenant_id) tokenCache.delete(config.tenant_id);

  const token = await getAccessToken(config);

  const wsdlUrl = getServiceUrl(config);
  const wsdlResponse = await fetchWithTimeout(wsdlUrl, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!wsdlResponse.ok) {
    throw new Error(`No se pudo acceder al servicio web: ${wsdlResponse.status}`);
  }

  return { success: true, serviceUrl: wsdlUrl, tokenOk: true };
}

function getWebClientUrl(config) {
  return `https://businesscentral.dynamics.com/${config.azure_tenant_id}/${config.bc_environment}/?company=${encodeURIComponent(config.bc_company)}`;
}

// ============================================================================
// OData v4 — VENDOR SEARCH (PhoneNo, PhoneNo2-5, MobilePhoneNo)
// ============================================================================

function getODataBaseUrl(config) {
  return `https://api.businesscentral.dynamics.com/v2.0/${config.azure_tenant_id}/${config.bc_environment}/ODataV4/Company('${encodeURIComponent(config.bc_company)}')`;
}

function normalizePhone(phone) {
  return phone.replace(/[\s\-().+]/g, '');
}

const VENDOR_PHONE_FIELDS = ['PhoneNo', 'PhoneNo2', 'PhoneNo3', 'PhoneNo4', 'PhoneNo5', 'MobilePhoneNo'];

async function loadVendorPhoneMap(config) {
  const tid = config.tenant_id;
  const cached = vendorPhoneCache.get(tid);
  if (cached && Date.now() - cached.loadedAt < VENDOR_CACHE_TTL) return cached.vendors;

  const token = await getAccessToken(config);
  const baseUrl = getODataBaseUrl(config);
  const selectFields = ['No', 'Name', ...VENDOR_PHONE_FIELDS].join(',');

  let vendors = [];
  let url = `${baseUrl}/Vendor?$select=${selectFields}&$top=1000`;

  while (url) {
    const response = await fetchWithTimeout(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!response.ok) break;
    const data = await response.json();
    for (const v of data.value) {
      const phones = [];
      for (const field of VENDOR_PHONE_FIELDS) {
        if (v[field] && v[field].trim()) {
          phones.push(normalizePhone(v[field]));
        }
      }
      if (phones.length > 0) {
        vendors.push({ number: v.No, displayName: v.Name, phones });
      }
    }
    url = data['@odata.nextLink'] || null;
  }

  vendorPhoneCache.set(tid, { vendors, loadedAt: Date.now() });
  console.log(`[BC:${tid}] Vendor phone cache loaded: ${vendors.length} vendors with phones`);
  return vendors;
}

async function searchVendorsByPhone(phone, config) {
  try {
    const normalized = normalizePhone(phone);
    const results = [];
    const seen = new Set();

    // Strategy 1: Quick OData filter
    const token = await getAccessToken(config);
    const baseUrl = getODataBaseUrl(config);
    const filterParts = VENDOR_PHONE_FIELDS.map(f => `${f} eq '${phone}'`).join(' or ');
    const url = `${baseUrl}/Vendor?$filter=${encodeURIComponent(filterParts)}&$select=No,Name&$top=10`;

    const response = await fetchWithTimeout(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (response.ok) {
      const data = await response.json();
      for (const v of (data.value || [])) {
        if (!seen.has(v.No)) {
          seen.add(v.No);
          results.push({ no: v.No, name: v.Name, url: buildVendorCardUrl(v.No, config), type: 'vendor' });
        }
      }
    }

    // Strategy 2: Normalized cache search
    const vendors = await loadVendorPhoneMap(config);
    for (const v of vendors) {
      if (v.phones.includes(normalized) && !seen.has(v.number)) {
        seen.add(v.number);
        results.push({ no: v.number, name: v.displayName, url: buildVendorCardUrl(v.number, config), type: 'vendor' });
      }
    }

    return results;
  } catch (err) {
    console.error(`[BC:${config.tenant_id}] Vendor search error:`, err.message);
    return [];
  }
}

function buildVendorCardUrl(vendorNo, config) {
  const base = `https://businesscentral.dynamics.com/${config.azure_tenant_id}/${config.bc_environment}`;
  const bookmark = buildBookmark(23, vendorNo); // Table 23 = Vendor
  return `${base}/?company=${encodeURIComponent(config.bc_company)}&page=26&bookmark=${encodeURIComponent(bookmark)}`;
}

// ============================================================================
// OData v4 — CUSTOMER SEARCH (Phone_No)
// ============================================================================

const CUSTOMER_PHONE_FIELDS = ['PhoneNo', 'PhoneNo2'];

async function loadCustomerPhoneMap(config) {
  const tid = config.tenant_id;
  const cached = customerPhoneCache.get(tid);
  if (cached && Date.now() - cached.loadedAt < VENDOR_CACHE_TTL) return cached.customers;

  const token = await getAccessToken(config);
  const baseUrl = getODataBaseUrl(config);
  const selectFields = ['No', 'Name', ...CUSTOMER_PHONE_FIELDS].join(',');

  let customers = [];
  let url = `${baseUrl}/Customer?$select=${selectFields}&$top=1000`;

  while (url) {
    const response = await fetchWithTimeout(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!response.ok) break;
    const data = await response.json();
    for (const c of data.value) {
      const phones = [];
      for (const field of CUSTOMER_PHONE_FIELDS) {
        if (c[field] && c[field].trim()) {
          phones.push(normalizePhone(c[field]));
        }
      }
      if (phones.length > 0) {
        customers.push({ number: c.No, displayName: c.Name, phones });
      }
    }
    url = data['@odata.nextLink'] || null;
  }

  customerPhoneCache.set(tid, { customers, loadedAt: Date.now() });
  console.log(`[BC:${tid}] Customer phone cache loaded: ${customers.length} customers with phones`);
  return customers;
}

async function searchCustomersByPhone(phone, config) {
  try {
    const normalized = normalizePhone(phone);
    const results = [];
    const seen = new Set();

    // Strategy 1: Quick OData filter
    const token = await getAccessToken(config);
    const baseUrl = getODataBaseUrl(config);
    const filterParts = CUSTOMER_PHONE_FIELDS.map(f => `${f} eq '${phone}'`).join(' or ');
    const url = `${baseUrl}/Customer?$filter=${encodeURIComponent(filterParts)}&$select=No,Name&$top=10`;

    const response = await fetchWithTimeout(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (response.ok) {
      const data = await response.json();
      for (const c of (data.value || [])) {
        if (!seen.has(c.No)) {
          seen.add(c.No);
          results.push({ no: c.No, name: c.Name, url: buildCustomerCardUrl(c.No, config), type: 'customer' });
        }
      }
    }

    // Strategy 2: Normalized cache search (catches formatting differences)
    const customers = await loadCustomerPhoneMap(config);
    for (const c of customers) {
      if (c.phones.includes(normalized) && !seen.has(c.number)) {
        seen.add(c.number);
        results.push({ no: c.number, name: c.displayName, url: buildCustomerCardUrl(c.number, config), type: 'customer' });
      }
    }

    return results;
  } catch (err) {
    console.error(`[BC:${config.tenant_id}] Customer search error:`, err.message);
    return [];
  }
}

function buildCustomerCardUrl(customerNo, config) {
  const base = `https://businesscentral.dynamics.com/${config.azure_tenant_id}/${config.bc_environment}`;
  const bookmark = buildBookmark(18, customerNo); // Table 18 = Customer
  return `${base}/?company=${encodeURIComponent(config.bc_company)}&page=21&bookmark=${encodeURIComponent(bookmark)}`;
}

// Build BC bookmark: matches SOAP format exactly
// Format: "<prefix>;<base64>" where base64 encodes [tableId LE, 0x00, 0x00, 0x02, 0x7b, strLen, recordNo UTF16LE trimmed]
function buildBookmark(tableId, recordNo) {
  const header = Buffer.from([tableId & 0xFF, (tableId >> 8) & 0xFF, 0x00, 0x00, 0x02, 0x7b]);
  const noUtf16 = Buffer.from(recordNo, 'utf16le');
  const trimmed = noUtf16.subarray(0, noUtf16.length - 1);
  const length = Buffer.from([recordNo.length]);
  const payload = Buffer.concat([header, length, trimmed]);
  const b64 = payload.toString('base64').replace(/=+$/, '');
  const prefix = payload.length + 5;
  return `${prefix};${b64}`;
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function unescapeXml(str) {
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

module.exports = {
  getConfig,
  getAllConfigs,
  getConfiguredTenants,
  saveConfig,
  deleteConfig,
  isEnabled,
  getAccessToken,
  obtenerURL,
  registrarLlamada,
  testConnection,
  getWebClientUrl,
  searchCustomersByPhone,
  buildCustomerCardUrl,
  searchVendorsByPhone,
  buildVendorCardUrl
};
