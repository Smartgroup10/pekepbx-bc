require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { LOG_MAX_LENGTH, RATE_LIMIT_WINDOW, RATE_LIMIT_MAX, LOGIN_RATE_LIMIT_WINDOW, LOGIN_RATE_LIMIT_MAX } = require('./constants');

const app = express();
const PORT = parseInt(process.env.PORT) || 4500;

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Vue SPA manages its own CSP
  crossOriginEmbedderPolicy: false
}));

// CORS — restrictivo en producción
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : null;

app.use(cors({
  origin: isProduction
    ? (origin, cb) => {
        if (!origin || (allowedOrigins && allowedOrigins.includes(origin))) {
          cb(null, true);
        } else {
          cb(new Error('CORS: origen no permitido'));
        }
      }
    : true,
  credentials: true,
  maxAge: 86400
}));

// Rate limiting global
app.use(rateLimit({
  windowMs: RATE_LIMIT_WINDOW,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones, intenta de nuevo más tarde' }
}));

// Rate limiting estricto para login
const loginLimiter = rateLimit({
  windowMs: LOGIN_RATE_LIMIT_WINDOW,
  max: LOGIN_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de login, intenta en 15 minutos' }
});

app.use(express.json());

// API Routes
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', require('./routes/auth'));
app.use('/api/bc', require('./routes/bc'));
app.use('/api/users', require('./routes/users'));
app.use('/api/events', require('./routes/events'));

// Public endpoint: list enabled BC tenants (for operator panel, no auth)
app.get('/api/tenants', (req, res) => {
  try {
    const bc = require('./services/bc');
    const configs = bc.getAllConfigs();
    res.json(configs.map(c => ({
      tenantId: c.tenant_id,
      name: c.bc_company || c.tenant_id,
      enabled: true
    })));
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// Health check (no auth)
app.get('/api/health', (req, res) => {
  const { db } = require('./db');
  const ami = require('./services/ami');

  let dbOk = false;
  try {
    db.prepare('SELECT 1').get();
    dbOk = true;
  } catch {}

  const amiOk = ami.connected && ami.loggedIn;
  const healthy = dbOk;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    uptime: Math.floor(process.uptime()),
    db: dbOk ? 'connected' : 'error',
    ami: amiOk ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

// Serve operator panel HTML
app.get('/operador', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'operador.html'));
});

// Serve Vue frontend (built)
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// Intercept console to broadcast logs via SSE (filtered)
const sseManager = require('./services/sse');
const origLog = console.log;
const origError = console.error;

const SENSITIVE_PATTERNS = /secret|password|token|authorization|bearer|client_secret/i;

function sanitizeLogMessage(args) {
  let msg = args.map(a => typeof a === 'string' ? a : (a?.message || JSON.stringify(a))).join(' ');
  if (msg.length > LOG_MAX_LENGTH) {
    msg = msg.substring(0, LOG_MAX_LENGTH) + '... [truncated]';
  }
  // Redact sensitive values: key=value or key: value patterns
  msg = msg.replace(/(secret|password|token|authorization|bearer|client_secret)\s*[=:]\s*\S+/gi, '$1=[REDACTED]');
  return msg;
}

console.log = (...args) => {
  origLog.apply(console, args);
  const msg = sanitizeLogMessage(args);
  sseManager.broadcast('server_log', { level: 'info', message: msg, time: new Date().toISOString() });
};

console.error = (...args) => {
  origError.apply(console, args);
  const msg = sanitizeLogMessage(args);
  sseManager.broadcast('server_log', { level: 'error', message: msg, time: new Date().toISOString() });
};

// EADDRINUSE protection
const server = app.listen(PORT, () => {
  console.log(`PekePBX-BC running on http://localhost:${PORT}`);

  // JWT_SECRET warning
  const jwtSecret = process.env.JWT_SECRET || '';
  if (!jwtSecret || jwtSecret.length < 32 || jwtSecret.includes('change-me') || jwtSecret.includes('pekepbx-bc-secret')) {
    console.error('WARNING: JWT_SECRET is weak or default. Generate a strong random secret for production!');
  }

  // Start AMI connection
  const ami = require('./services/ami');
  ami.connect();

  // Setup BC hooks
  const { setupBcHooks, warmupCaches } = require('./services/bcHooks');
  setupBcHooks(ami);

  // Pre-warm BC caches (OAuth token + Customer/Vendor phone maps)
  warmupCaches().catch(err => console.error('BC warmup failed:', err.message));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    origError(`Port ${PORT} already in use. Kill the other process first.`);
    process.exit(1);
  }
  throw err;
});

// Graceful shutdown
function gracefulShutdown(signal) {
  origLog(`\n${signal} received. Shutting down gracefully...`);

  server.close(() => {
    origLog('HTTP server closed');

    try {
      const ami = require('./services/ami');
      ami.disconnect();
      origLog('AMI disconnected');
    } catch {}

    try {
      const { db } = require('./db');
      db.close();
      origLog('Database closed');
    } catch {}

    process.exit(0);
  });

  // Force exit after 10s
  setTimeout(() => {
    origError('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
