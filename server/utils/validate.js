function isValidExtension(ext) {
  return typeof ext === 'string' && /^\d{2,6}$/.test(ext);
}

function isValidTenantId(tid) {
  return typeof tid === 'string' && /^[a-zA-Z0-9_-]{3,20}$/.test(tid);
}

function isValidUsername(u) {
  return typeof u === 'string' && /^[a-zA-Z0-9._-]{3,50}$/.test(u);
}

function isValidPassword(p) {
  return typeof p === 'string' && p.length >= 8;
}

function isValidPhone(ph) {
  return typeof ph === 'string' && /^\+?\d{7,20}$/.test(ph.replace(/[\s\-()]/g, ''));
}

function isValidRole(r) {
  return r === 'admin' || r === 'user';
}

function sanitizeString(s, maxLen = 200) {
  if (typeof s !== 'string') return '';
  return s.trim().substring(0, maxLen);
}

module.exports = { isValidExtension, isValidTenantId, isValidUsername, isValidPassword, isValidPhone, isValidRole, sanitizeString };
