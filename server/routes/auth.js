const express = require('express');
const bcrypt = require('bcryptjs');
const { stmts } = require('../db');
const { generateToken, authMiddleware } = require('../middleware/auth');
const { isValidUsername, isValidExtension, isValidTenantId, sanitizeString } = require('../utils/validate');

const router = express.Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Usuario y contrasena requeridos' });
    }

    if (!isValidUsername(username)) {
      return res.status(400).json({ error: 'Formato de usuario invalido' });
    }

    if (typeof password !== 'string' || password.length < 1 || password.length > 128) {
      return res.status(400).json({ error: 'Contrasena invalida' });
    }

    const user = stmts.getUserByUsername.get(username);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Credenciales invalidas' });
    }

    const token = generateToken(user.id);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    stmts.createSession.run(
      user.id,
      token,
      req.ip,
      req.headers['user-agent'] || '',
      expiresAt
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        extension: user.extension,
        sip_peer: user.sip_peer,
        tenant_id: user.tenant_id,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/auth/logout
router.post('/logout', authMiddleware, (req, res) => {
  try {
    stmts.deleteSession.run(req.token);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// PUT /api/auth/me/extension — user self-service extension config
router.put('/me/extension', authMiddleware, (req, res) => {
  try {
    const { tenant_id, extension } = req.body;
    if (!tenant_id || !extension) {
      return res.status(400).json({ error: 'tenant_id y extension son requeridos' });
    }

    if (!isValidTenantId(tenant_id)) {
      return res.status(400).json({ error: 'Formato de tenant_id invalido' });
    }

    if (!isValidExtension(extension)) {
      return res.status(400).json({ error: 'Extension debe ser 2-6 digitos' });
    }

    const sip_peer = `ext${tenant_id}${extension}`;
    stmts.updateUserExtension.run(extension, sip_peer, tenant_id, req.user.id);
    const user = stmts.getUserById.get(req.user.id);
    res.json({ user });
  } catch (err) {
    console.error('Update extension error:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/auth/tenants — list BC-configured tenants (any authenticated user)
router.get('/tenants', authMiddleware, (req, res) => {
  try {
    const bc = require('../services/bc');
    const configs = bc.getAllConfigs();
    const tenants = configs.map(c => ({
      id: c.tenant_id,
      company: c.bc_company || c.tenant_id
    }));
    res.json({ tenants });
  } catch (err) {
    console.error('Get tenants error:', err.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
