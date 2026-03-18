const express = require('express');
const jwt = require('jsonwebtoken');
const { stmts } = require('../db');
const { JWT_SECRET, authMiddleware, adminOnly } = require('../middleware/auth');
const sseManager = require('../services/sse');
const { isValidTenantId, isValidExtension } = require('../utils/validate');

const router = express.Router();

// GET /api/events?token=JWT
// SSE endpoint - auth via query param (EventSource can't set headers)
router.get('/', (req, res) => {
  try {
    const token = req.query.token;
    if (!token || token.length < 10) {
      return res.status(401).json({ error: 'Token requerido' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Token invalido' });
    }

    const session = stmts.getSession.get(token);
    if (!session) {
      return res.status(401).json({ error: 'Sesion expirada' });
    }

    const userId = String(session.user_id);
    const extension = session.extension || '';
    const sipPeer = session.sip_peer || '';
    const tenantId = session.tenant_id || '';
    const role = session.role || 'user';

    // Don't let Express timeout the response
    req.socket.setTimeout(0);

    sseManager.addClient(userId, extension, tenantId, res, sipPeer, role);
  } catch (err) {
    console.error('SSE error:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/events/operator?tenant=XXXXX&ext=YY
// Public SSE endpoint for operator panel (no auth, like asterisk-odoo-bridge)
router.get('/operator', (req, res) => {
  try {
    const tenantId = req.query.tenant;
    const ext = req.query.ext;

    if (!tenantId || !ext) {
      return res.status(400).json({ error: 'tenant y ext son requeridos' });
    }

    if (!isValidTenantId(tenantId)) {
      return res.status(400).json({ error: 'Formato de tenant invalido' });
    }

    if (!isValidExtension(ext)) {
      return res.status(400).json({ error: 'Formato de extension invalido' });
    }

    const sipPeer = `ext${tenantId}${ext}`;
    const uniqueId = `op_${tenantId}_${ext}`;

    req.socket.setTimeout(0);

    sseManager.addClient(uniqueId, ext, tenantId, res, sipPeer, 'user');
  } catch (err) {
    console.error('SSE operator error:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/events/extensions — connected extensions (admin only)
router.get('/extensions', authMiddleware, adminOnly, (req, res) => {
  res.json(sseManager.getConnectedClients(req.user.tenant_id));
});

module.exports = router;
