const jwt = require('jsonwebtoken');
const { stmts } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'pekepbx-bc-secret';

function generateToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '24h' });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  const token = header.slice(7);
  if (!token || token.length < 10) {
    return res.status(401).json({ error: 'Token invalido' });
  }

  try {
    const decoded = verifyToken(token);
    const session = stmts.getSession.get(token);
    if (!session) {
      return res.status(401).json({ error: 'Sesion expirada' });
    }

    req.user = {
      id: session.user_id,
      username: session.username,
      full_name: session.full_name,
      extension: session.extension,
      sip_peer: session.sip_peer,
      tenant_id: session.tenant_id,
      role: session.role
    };
    req.token = token;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalido' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acceso denegado' });
  }
  next();
}

module.exports = { generateToken, verifyToken, authMiddleware, adminOnly, JWT_SECRET };
