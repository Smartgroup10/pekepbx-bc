const express = require('express');
const bcrypt = require('bcryptjs');
const { stmts } = require('../db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const { isValidUsername, isValidPassword, isValidExtension, isValidTenantId, isValidRole, sanitizeString } = require('../utils/validate');

const router = express.Router();

router.use(authMiddleware, adminOnly);

// GET /api/users
router.get('/', (req, res) => {
  try {
    const users = stmts.getAllUsers.all();
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/users/:id
router.get('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID invalido' });

    const user = stmts.getUserById.get(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// POST /api/users
router.post('/', (req, res) => {
  try {
    const { username, password, full_name, extension, sip_peer, tenant_id, role } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'username y password requeridos' });
    }

    if (!isValidUsername(username)) {
      return res.status(400).json({ error: 'Username: 3-50 chars alfanumericos (. _ - permitidos)' });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({ error: 'Password: minimo 8 caracteres' });
    }

    if (extension && !isValidExtension(extension)) {
      return res.status(400).json({ error: 'Extension: 2-6 digitos' });
    }

    if (tenant_id && !isValidTenantId(tenant_id)) {
      return res.status(400).json({ error: 'Tenant ID: 3-20 chars alfanumericos' });
    }

    if (role && !isValidRole(role)) {
      return res.status(400).json({ error: 'Role debe ser admin o user' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = stmts.createUser.run(
      username,
      hash,
      sanitizeString(full_name || ''),
      extension || null,
      sip_peer || null,
      tenant_id || null,
      role || 'user'
    );

    const user = stmts.getUserById.get(result.lastInsertRowid);
    res.status(201).json(user);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Username ya existe' });
    }
    res.status(500).json({ error: 'Error interno' });
  }
});

// PUT /api/users/:id
router.put('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID invalido' });

    const existing = stmts.getUserById.get(id);
    if (!existing) return res.status(404).json({ error: 'Usuario no encontrado' });

    const { full_name, extension, sip_peer, tenant_id, role, active, password } = req.body;

    if (extension !== undefined && extension && !isValidExtension(extension)) {
      return res.status(400).json({ error: 'Extension: 2-6 digitos' });
    }

    if (tenant_id !== undefined && tenant_id && !isValidTenantId(tenant_id)) {
      return res.status(400).json({ error: 'Tenant ID: 3-20 chars alfanumericos' });
    }

    if (role !== undefined && !isValidRole(role)) {
      return res.status(400).json({ error: 'Role debe ser admin o user' });
    }

    if (password && !isValidPassword(password)) {
      return res.status(400).json({ error: 'Password: minimo 8 caracteres' });
    }

    stmts.updateUser.run(
      full_name !== undefined ? sanitizeString(full_name) : existing.full_name,
      extension !== undefined ? extension : existing.extension,
      sip_peer !== undefined ? sip_peer : existing.sip_peer,
      tenant_id !== undefined ? tenant_id : existing.tenant_id,
      role !== undefined ? role : existing.role,
      active !== undefined ? (active ? 1 : 0) : existing.active,
      id
    );

    if (password) {
      const hash = bcrypt.hashSync(password, 10);
      stmts.updateUserPassword.run(hash, id);
    }

    const user = stmts.getUserById.get(id);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// DELETE /api/users/:id
router.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'ID invalido' });

    if (id === req.user.id) {
      return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
    }
    stmts.deleteUser.run(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
