const express = require('express');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const bc = require('../services/bc');
const { reloadConfigs } = require('../services/bcHooks');
const { isValidTenantId, isValidPhone, sanitizeString } = require('../utils/validate');

const router = express.Router();

// All routes require auth + admin
router.use(authMiddleware, adminOnly);

// GET /api/bc/tenants - List configured tenant IDs
router.get('/tenants', (req, res) => {
  try {
    const tenants = bc.getConfiguredTenants();
    res.json({ tenants: tenants.map(t => ({ tenant_id: t })) });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/bc/config/:tenantId - Get config for a tenant
router.get('/config/:tenantId', (req, res) => {
  try {
    if (!isValidTenantId(req.params.tenantId)) {
      return res.status(400).json({ error: 'Formato de tenant_id invalido' });
    }

    const config = bc.getConfig(req.params.tenantId);
    // Don't send secret in plain text
    const safe = { ...config };
    if (safe.client_secret) {
      safe.has_secret = true;
      safe.client_secret = undefined;
    }
    res.json(safe);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// PUT /api/bc/config/:tenantId - Save config
router.put('/config/:tenantId', (req, res) => {
  try {
    if (!isValidTenantId(req.params.tenantId)) {
      return res.status(400).json({ error: 'Formato de tenant_id invalido' });
    }

    const { client_id, client_secret, azure_tenant_id, bc_environment, bc_company, enabled } = req.body;
    const configObj = {};

    if (client_id !== undefined) configObj.client_id = sanitizeString(client_id, 100);
    if (client_secret) configObj.client_secret = client_secret;
    if (azure_tenant_id !== undefined) configObj.azure_tenant_id = sanitizeString(azure_tenant_id, 100);
    if (bc_environment !== undefined) configObj.bc_environment = sanitizeString(bc_environment, 100);
    if (bc_company !== undefined) configObj.bc_company = sanitizeString(bc_company, 200);
    if (enabled !== undefined) configObj.enabled = enabled ? '1' : '0';

    bc.saveConfig(req.params.tenantId, configObj);
    reloadConfigs();

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// DELETE /api/bc/config/:tenantId
router.delete('/config/:tenantId', (req, res) => {
  try {
    if (!isValidTenantId(req.params.tenantId)) {
      return res.status(400).json({ error: 'Formato de tenant_id invalido' });
    }

    bc.deleteConfig(req.params.tenantId);
    reloadConfigs();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/bc/test/:tenantId - Test connection
router.post('/test/:tenantId', async (req, res) => {
  try {
    if (!isValidTenantId(req.params.tenantId)) {
      return res.status(400).json({ error: 'Formato de tenant_id invalido' });
    }

    const { client_id, client_secret, azure_tenant_id, bc_environment, bc_company } = req.body;

    // Build config from request + stored
    const stored = bc.getConfig(req.params.tenantId);
    const config = {
      tenant_id: req.params.tenantId,
      client_id: client_id || stored.client_id,
      client_secret: client_secret || stored.client_secret,
      azure_tenant_id: azure_tenant_id || stored.azure_tenant_id,
      bc_environment: bc_environment || stored.bc_environment,
      bc_company: bc_company || stored.bc_company
    };

    const result = await bc.testConnection(config);
    res.json({ success: true, message: 'Conexion exitosa', ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: 'Error de conexion', error: err.message });
  }
});

// GET /api/bc/test-url/:tenantId?phone=XXX - Test ObtenerURL
router.get('/test-url/:tenantId', async (req, res) => {
  try {
    if (!isValidTenantId(req.params.tenantId)) {
      return res.status(400).json({ error: 'Formato de tenant_id invalido' });
    }

    const phone = req.query.phone;
    if (!phone) return res.status(400).json({ error: 'phone requerido' });

    if (!isValidPhone(phone)) {
      return res.status(400).json({ error: 'Formato de telefono invalido' });
    }

    const config = bc.getConfig(req.params.tenantId);
    if (!bc.isEnabled(config)) {
      return res.status(400).json({ error: 'Tenant no configurado o deshabilitado' });
    }

    const bcUrl = await bc.obtenerURL(phone, config);
    res.json({ phone, bcUrl, found: !!bcUrl });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/bc/test-screenpop - Send a fake screen pop to the requesting user
router.post('/test-screenpop', (req, res) => {
  try {
    const sseManager = require('../services/sse');
    const { type, phone, name } = req.body;

    const config = bc.getConfig(req.user.tenant_id || '20242');
    const baseUrl = bc.getWebClientUrl(config);

    const data = {
      phone: phone || '667601605',
      bcUrl: type === 'vendor'
        ? `${baseUrl}&page=26&filter='No.' IS '011'`
        : type === 'contact'
          ? `${baseUrl}&page=5050&filter='No.' IS 'CO016781'`
          : baseUrl,
      found: type === 'contact' || type === 'vendor',
      type: type || null,
      name: name || (type === 'vendor' ? 'Eva Maria Garcia Garcia' : type === 'contact' ? 'Hugo Andre de Castro' : ''),
      newContactUrl: `${baseUrl}&page=5052&phoneno=${encodeURIComponent(phone || '612345678')}`,
      channel: 'TEST/fake-channel'
    };

    // Send to authenticated user AND via sipPeer (covers both panel types)
    sseManager.sendToUser(String(req.user.id), 'bc_screen_pop', data);
    if (req.user.sip_peer) {
      sseManager.sendToSipPeer(req.user.sip_peer, 'bc_screen_pop', data, req.user.tenant_id);
    }
    res.json({ ok: true, sent: data });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/bc/calls?tenant_id=X&limit=N - Call log
router.get('/calls', (req, res) => {
  try {
    const { tenant_id, limit } = req.query;
    const n = Math.min(parseInt(limit) || 50, 500);

    const calls = tenant_id
      ? require('../db').stmts.getCallsByTenant.all(tenant_id, n)
      : require('../db').stmts.getRecentCalls.all(n);

    res.json({ calls });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
