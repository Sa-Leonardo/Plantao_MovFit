const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getDB } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'mude-este-segredo-em-producao';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// Hash de uma API key em formato estável para armazenamento/comparação
function hashApiKey(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

// Tenta autenticar via Bearer JWT ou via X-Api-Key. Popula req.user.
function tryAuthenticate(req) {
  // 1) Bearer JWT
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.slice(7);
    try {
      const payload = verifyToken(token);
      const user = getDB().prepare('SELECT id, username, role, password_changed_at FROM users WHERE id = ?').get(payload.id);
      if (user) {
        // Se a senha foi trocada APÓS o token ter sido emitido, invalida o token
        if (user.password_changed_at && payload.pca !== user.password_changed_at) {
          return null;
        }
        return { user: { id: user.id, username: user.username, role: user.role }, viaApiKey: false };
      }
    } catch (_) {}
  }

  // 2) API Key — APENAS via header X-Api-Key (nunca query string para evitar logs/Referer)
  const raw = req.headers['x-api-key'];
  if (raw) {
    const hash = hashApiKey(raw);
    const db = getDB();
    const row = db.prepare('SELECT id, name, active FROM api_keys WHERE key_hash = ?').get(hash);
    if (row && row.active) {
      // Atualiza last_used
      try { db.prepare("UPDATE api_keys SET last_used = datetime('now') WHERE id = ?").run(row.id); } catch (_) {}
      // API keys têm privilégios de admin (servem para integração)
      return { user: { id: `apikey:${row.id}`, username: `apikey:${row.name}`, role: 'admin' }, viaApiKey: true };
    }
  }

  return null;
}

// Middleware: requer autenticação (qualquer role) — JWT OU API key
function requireAuth(req, res, next) {
  const result = tryAuthenticate(req);
  if (!result) return res.status(401).json({ error: 'Não autenticado. Forneça Bearer token ou X-Api-Key.' });
  req.user = result.user;
  req.viaApiKey = result.viaApiKey;
  next();
}

// Middleware: requer role admin (JWT admin OU API key válida)
function requireAdmin(req, res, next) {
  const result = tryAuthenticate(req);
  if (!result) return res.status(401).json({ error: 'Não autenticado. Forneça Bearer token ou X-Api-Key.' });
  if (result.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso negado. Requer permissão de administrador.' });
  }
  req.user = result.user;
  req.viaApiKey = result.viaApiKey;
  next();
}

// Middleware: exige JWT humano (não aceita API key) — para endpoints sensíveis
// como gerenciar as próprias API keys.
function requireHumanAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token JWT obrigatório para este endpoint' });
  }
  try {
    const payload = verifyToken(auth.slice(7));
    const user = getDB().prepare('SELECT id, username, role FROM users WHERE id = ?').get(payload.id);
    if (!user) return res.status(401).json({ error: 'Usuário não encontrado' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Requer administrador' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

module.exports = { signToken, verifyToken, hashApiKey, requireAuth, requireAdmin, requireHumanAdmin };
