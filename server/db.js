const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const { SESSION_CLEANUP_INTERVAL } = require('./constants');

const dbPath = path.join(__dirname, '..', 'pekepbx-bc.db');
const db = new Database(dbPath);

// WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    full_name TEXT NOT NULL DEFAULT '',
    extension TEXT DEFAULT NULL,
    sip_peer TEXT DEFAULT NULL,
    tenant_id TEXT DEFAULT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,
    ip_address TEXT,
    user_agent TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS integrations_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    integration TEXT NOT NULL,
    config_key TEXT NOT NULL,
    config_value TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(integration, config_key)
  );

  CREATE TABLE IF NOT EXISTS call_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT,
    extension TEXT,
    caller_number TEXT,
    bc_url TEXT,
    found INTEGER NOT NULL DEFAULT 0,
    answered INTEGER NOT NULL DEFAULT 0,
    registered INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    ended_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Performance indexes
  CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_config_integration ON integrations_config(integration);
  CREATE INDEX IF NOT EXISTS idx_call_log_tenant_date ON call_log(tenant_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_call_log_created ON call_log(created_at);
`);

// Seed admin user if not exists
const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare('INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)').run('admin', hash, 'Administrador', 'admin');
  console.log('DB: Seeded admin user (admin/admin123)');
}

// Prepared statements
const stmts = {
  // Users
  getUserByUsername: db.prepare('SELECT * FROM users WHERE username = ? AND active = 1'),
  getUserById: db.prepare('SELECT id, username, full_name, extension, sip_peer, tenant_id, role, active, created_at FROM users WHERE id = ?'),
  getAllUsers: db.prepare('SELECT id, username, full_name, extension, sip_peer, tenant_id, role, active, created_at FROM users ORDER BY id'),
  createUser: db.prepare('INSERT INTO users (username, password, full_name, extension, sip_peer, tenant_id, role) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  updateUser: db.prepare('UPDATE users SET full_name = ?, extension = ?, sip_peer = ?, tenant_id = ?, role = ?, active = ?, updated_at = datetime(\'now\') WHERE id = ?'),
  updateUserPassword: db.prepare('UPDATE users SET password = ?, updated_at = datetime(\'now\') WHERE id = ?'),
  updateUserExtension: db.prepare('UPDATE users SET extension = ?, sip_peer = ?, tenant_id = ?, updated_at = datetime(\'now\') WHERE id = ?'),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),

  // Sessions
  createSession: db.prepare('INSERT INTO sessions (user_id, token, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)'),
  getSession: db.prepare('SELECT s.*, u.username, u.full_name, u.extension, u.sip_peer, u.tenant_id, u.role FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > datetime(\'now\') AND u.active = 1'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
  deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= datetime(\'now\')'),

  // Integrations config
  getConfig: db.prepare('SELECT config_key, config_value FROM integrations_config WHERE integration = ?'),
  getAllBcConfigs: db.prepare("SELECT integration, config_key, config_value FROM integrations_config WHERE integration LIKE 'bc_%'"),
  upsertConfig: db.prepare(`INSERT INTO integrations_config (integration, config_key, config_value, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(integration, config_key) DO UPDATE SET config_value = excluded.config_value, updated_at = datetime('now')`),
  deleteConfigByIntegration: db.prepare('DELETE FROM integrations_config WHERE integration = ?'),

  // Call log
  insertCallLog: db.prepare('INSERT INTO call_log (tenant_id, extension, caller_number, bc_url, found, answered, registered, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  getRecentCalls: db.prepare('SELECT * FROM call_log ORDER BY id DESC LIMIT ?'),
  getCallsByTenant: db.prepare('SELECT * FROM call_log WHERE tenant_id = ? ORDER BY id DESC LIMIT ?'),
};

// Clean expired sessions on startup
stmts.deleteExpiredSessions.run();

// Periodic session cleanup
setInterval(() => {
  try {
    const result = stmts.deleteExpiredSessions.run();
    if (result.changes > 0) {
      console.log(`DB: Cleaned ${result.changes} expired sessions`);
    }
  } catch {}
}, SESSION_CLEANUP_INTERVAL);

module.exports = { db, stmts };
