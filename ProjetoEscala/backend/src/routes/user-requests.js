const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const { getDB } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Solicitações expiram após 24h se não forem processadas
const REQUEST_TTL_HOURS = 24;

// Nomes de usuário reservados — não podem ser usados em solicitações públicas
const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'sysadmin', 'superuser', 'super',
  'system', 'operator', 'support', 'suporte', 'api', 'apikey',
  'webhook', 'webhooks', 'test', 'teste', 'null', 'undefined',
  'anonymous', 'anon', 'guest', 'convidado', 'default', 'owner',
  'moderator', 'mod', 'staff', 'master',
]);

const USERNAME_REGEX = /^[a-z0-9._-]{3,}$/;

// Valida o padrão e retorna motivo da indisponibilidade (string) ou null se OK.
function checkUsernameAvailability(rawUsername) {
  if (!rawUsername) return { ok: false, reason: 'Informe um usuário' };
  const u = String(rawUsername).trim().toLowerCase();
  if (u.length < 3) return { ok: false, reason: 'Mínimo de 3 caracteres' };
  if (u.length > 32) return { ok: false, reason: 'Máximo de 32 caracteres' };
  if (!USERNAME_REGEX.test(u)) {
    return { ok: false, reason: 'Use apenas letras minúsculas, números, ponto, hífen ou sublinhado' };
  }
  if (RESERVED_USERNAMES.has(u)) {
    return { ok: false, reason: 'Indisponível' };
  }
  const db = getDB();
  const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(u);
  if (existingUser) return { ok: false, reason: 'Já existe um usuário com esse nome' };
  const existingReq = db.prepare("SELECT id FROM user_requests WHERE username = ? AND status = 'pending'").get(u);
  if (existingReq) return { ok: false, reason: 'Já existe uma solicitação pendente para esse usuário' };
  return { ok: true, username: u };
}

// Remove solicitações pendentes expiradas. Usa SQLite para calcular a janela.
function cleanupExpiredRequests() {
  try {
    const info = getDB().prepare(`
      DELETE FROM user_requests
      WHERE status = 'pending'
      AND datetime(created_at) < datetime('now', '-' || ? || ' hours')
    `).run(REQUEST_TTL_HOURS);
    if (info.changes > 0) {
      console.log(`[user-requests] ${info.changes} solicitação(ões) expirada(s) removida(s)`);
    }
    return info.changes;
  } catch (err) {
    console.error('[user-requests] erro ao limpar expiradas:', err.message);
    return 0;
  }
}

// Rate limit para registro público: 5 solicitações por IP a cada 1h
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Muitas solicitações. Tente novamente em 1 hora.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /api/user-requests/check-username?username=X  (público — validação em tempo real)
router.get('/check-username', (req, res) => {
  cleanupExpiredRequests();
  const result = checkUsernameAvailability(req.query.username);
  if (result.ok) return res.json({ available: true, username: result.username });
  return res.json({ available: false, reason: result.reason });
});

// POST /api/user-requests  (público — usuário solicita cadastro)
// Body: { name, username, password }
router.post('/', registerLimiter, (req, res) => {
  cleanupExpiredRequests();
  const { name, username, password } = req.body || {};
  if (!name || !username || !password) {
    return res.status(400).json({ error: 'Nome, usuário e senha são obrigatórios' });
  }
  const pw = String(password);
  if (pw.length < 8 || pw.length > 128) {
    return res.status(400).json({ error: 'Senha deve ter entre 8 e 128 caracteres' });
  }
  if (!/[A-Za-zÀ-ÿ]/.test(pw) || !/\d/.test(pw)) {
    return res.status(400).json({ error: 'Senha deve conter letras e números' });
  }
  if (String(name).length > 100) {
    return res.status(400).json({ error: 'Nome muito longo' });
  }
  const check = checkUsernameAvailability(username);
  if (!check.ok) return res.status(check.reason.includes('Já existe') ? 409 : 400).json({ error: check.reason });
  const cleanUsername = check.username;

  const db = getDB();
  const id = uuidv4();
  const hash = bcrypt.hashSync(String(password), 12);
  db.prepare('INSERT INTO user_requests (id, name, username, password_hash, status) VALUES (?, ?, ?, ?, ?)').run(
    id, String(name).trim(), cleanUsername, hash, 'pending'
  );
  res.status(201).json({ message: 'Solicitação enviada. Aguarde aprovação do administrador.', id });
});

// GET /api/user-requests  (admin — lista solicitações)
// Query: ?status=pending|approved|rejected|all  (default: pending)
router.get('/', requireAdmin, (req, res) => {
  cleanupExpiredRequests();
  const status = req.query.status || 'pending';
  const db = getDB();
  let rows;
  if (status === 'all') {
    rows = db.prepare('SELECT id, name, username, status, created_at, processed_at, processed_by FROM user_requests ORDER BY created_at DESC').all();
  } else {
    rows = db.prepare('SELECT id, name, username, status, created_at, processed_at, processed_by FROM user_requests WHERE status = ? ORDER BY created_at DESC').all(status);
  }
  res.json(rows);
});

// POST /api/user-requests/:id/approve  (admin — cria usuário tipo 'user')
router.post('/:id/approve', requireAdmin, (req, res) => {
  const db = getDB();
  const reqRow = db.prepare("SELECT * FROM user_requests WHERE id = ?").get(req.params.id);
  if (!reqRow) return res.status(404).json({ error: 'Solicitação não encontrada' });
  if (reqRow.status !== 'pending') return res.status(409).json({ error: `Solicitação já foi ${reqRow.status === 'approved' ? 'aprovada' : 'recusada'}` });

  // Verifica colisão de username (caso algum admin tenha criado depois da solicitação)
  const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(reqRow.username);
  if (existingUser) {
    return res.status(409).json({ error: 'Já existe um usuário com esse nome. Recuse ou peça outro username.' });
  }

  const tx = db.transaction(() => {
    const userId = uuidv4();
    db.prepare('INSERT INTO users (id, username, name, password_hash, role) VALUES (?, ?, ?, ?, ?)').run(
      userId, reqRow.username, reqRow.name, reqRow.password_hash, 'user'
    );
    db.prepare("UPDATE user_requests SET status = 'approved', processed_at = datetime('now'), processed_by = ? WHERE id = ?").run(
      req.user.username, req.params.id
    );
    return userId;
  });
  const userId = tx();
  res.json({ message: 'Solicitação aprovada — usuário criado', user: { id: userId, username: reqRow.username, name: reqRow.name, role: 'user' } });
});

// POST /api/user-requests/:id/reject  (admin — marca como recusada)
router.post('/:id/reject', requireAdmin, (req, res) => {
  const db = getDB();
  const reqRow = db.prepare("SELECT * FROM user_requests WHERE id = ?").get(req.params.id);
  if (!reqRow) return res.status(404).json({ error: 'Solicitação não encontrada' });
  if (reqRow.status !== 'pending') return res.status(409).json({ error: `Solicitação já foi ${reqRow.status === 'approved' ? 'aprovada' : 'recusada'}` });

  db.prepare("UPDATE user_requests SET status = 'rejected', processed_at = datetime('now'), processed_by = ? WHERE id = ?").run(
    req.user.username, req.params.id
  );
  res.json({ message: 'Solicitação recusada' });
});

// DELETE /api/user-requests/:id (admin — remove registro)
router.delete('/:id', requireAdmin, (req, res) => {
  const info = getDB().prepare('DELETE FROM user_requests WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Solicitação não encontrada' });
  res.json({ message: 'Solicitação removida' });
});

module.exports = router;
module.exports.cleanupExpiredRequests = cleanupExpiredRequests;
