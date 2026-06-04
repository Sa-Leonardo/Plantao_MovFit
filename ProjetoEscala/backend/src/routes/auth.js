const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const { getDB } = require('../db');
const { signToken, requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Hash placeholder usado para fazer bcrypt sempre rodar em login, mesmo quando o
// usuário não existe — evita ataques de enumeração por timing.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-constant-time', 12);

// Política de senha mínima (reforçada em um único lugar)
function validatePasswordStrength(pw) {
  if (typeof pw !== 'string') return 'Senha inválida';
  if (pw.length < 8) return 'Senha deve ter pelo menos 8 caracteres';
  if (pw.length > 128) return 'Senha muito longa';
  const hasLetter = /[A-Za-zÀ-ÿ]/.test(pw);
  const hasDigit = /\d/.test(pw);
  if (!hasLetter || !hasDigit) return 'Senha deve conter letras e números';
  // Bloqueia senhas óbvias
  const lowered = pw.toLowerCase();
  const banned = ['password', 'senha123', '12345678', 'admin@1234', 'qwerty123'];
  if (banned.some(b => lowered.includes(b))) return 'Senha muito comum, escolha outra';
  return null;
}

// Rate limit para login: máx 10 tentativas por 15 min por IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas tentativas. Aguarde 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limit secundário por USERNAME — previne credential stuffing (rotação de IPs)
const usernameAttempts = new Map(); // username -> { count, firstAt }
const USERNAME_WINDOW_MS = 15 * 60 * 1000;
const USERNAME_MAX_ATTEMPTS = 8;
function checkUsernameAttempts(username) {
  const now = Date.now();
  const entry = usernameAttempts.get(username);
  if (!entry) { usernameAttempts.set(username, { count: 1, firstAt: now }); return true; }
  if (now - entry.firstAt > USERNAME_WINDOW_MS) {
    usernameAttempts.set(username, { count: 1, firstAt: now });
    return true;
  }
  entry.count += 1;
  return entry.count <= USERNAME_MAX_ATTEMPTS;
}
function clearUsernameAttempts(username) { usernameAttempts.delete(username); }
// Limpeza periódica
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of usernameAttempts.entries()) {
    if (now - v.firstAt > USERNAME_WINDOW_MS) usernameAttempts.delete(k);
  }
}, 5 * 60 * 1000).unref();

// POST /api/auth/login
router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
  }
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Usuário e senha devem ser strings' });
  }
  if (password.length > 128) {
    return res.status(400).json({ error: 'Senha muito longa' });
  }

  const cleanUsername = username.trim().toLowerCase();
  if (!checkUsernameAttempts(cleanUsername)) {
    return res.status(429).json({ error: 'Muitas tentativas para este usuário. Aguarde alguns minutos.' });
  }

  const user = getDB().prepare('SELECT * FROM users WHERE username = ?').get(cleanUsername);
  // SEMPRE roda bcrypt — mesmo sem usuário — para tempo constante
  const hashToCheck = user ? user.password_hash : DUMMY_HASH;
  const valid = bcrypt.compareSync(password, hashToCheck);

  if (!user || !valid) {
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }

  // Login OK — limpa contador de tentativas
  clearUsernameAttempts(cleanUsername);

  // Token inclui password_changed_at (para invalidar sessões após troca de senha)
  const token = signToken({
    id: user.id,
    username: user.username,
    role: user.role,
    pca: user.password_changed_at || null,
  });
  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role }
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Campos obrigatórios' });
  }
  const weakness = validatePasswordStrength(newPassword);
  if (weakness) return res.status(400).json({ error: weakness });
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'A nova senha deve ser diferente da atual' });
  }

  const user = getDB().prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(401).json({ error: 'Usuário não encontrado' });
  const valid = bcrypt.compareSync(currentPassword, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: 'Senha atual incorreta' });
  }

  const newHash = bcrypt.hashSync(newPassword, 12);
  const now = new Date().toISOString();
  getDB().prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?').run(newHash, now, req.user.id);
  res.json({ message: 'Senha alterada com sucesso' });
});

// GET /api/auth/users
router.get('/users', requireAdmin, (req, res) => {
  const users = getDB().prepare('SELECT id, username, name, role, created_at FROM users ORDER BY created_at').all();
  res.json(users);
});

// POST /api/auth/users
router.post('/users', requireAdmin, (req, res) => {
  const { username, password, role, name } = req.body || {};
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'username, password e role são obrigatórios' });
  }
  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ error: 'role deve ser "admin" ou "user"' });
  }
  if (typeof username !== 'string') {
    return res.status(400).json({ error: 'username inválido' });
  }
  const cleanUsername = username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(cleanUsername)) {
    return res.status(400).json({ error: 'Usuário inválido (3-32 chars; letras, números, . _ -)' });
  }
  const weakness = validatePasswordStrength(password);
  if (weakness) return res.status(400).json({ error: weakness });

  const cleanName = name ? String(name).trim().slice(0, 100) : null;

  const existing = getDB().prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
  if (existing) {
    return res.status(409).json({ error: 'Nome de usuário já existe' });
  }

  const hash = bcrypt.hashSync(password, 12);
  const id = uuidv4();
  getDB().prepare('INSERT INTO users (id, username, name, password_hash, role) VALUES (?, ?, ?, ?, ?)').run(id, cleanUsername, cleanName, hash, role);
  res.status(201).json({ id, username: cleanUsername, name: cleanName, role });
});

// PUT /api/auth/users/:id
router.put('/users/:id', requireAdmin, (req, res) => {
  const { username, password, role, name } = req.body || {};
  const user = getDB().prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

  let newUsername = user.username;
  let newHash = user.password_hash;
  let newRole = user.role;
  let newPwChangedAt = user.password_changed_at;
  let newName = user.name;
  if (name !== undefined) newName = name ? String(name).trim().slice(0, 100) : null;

  if (username) {
    const cleanUsername = String(username).trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(cleanUsername)) {
      return res.status(400).json({ error: 'Usuário inválido' });
    }
    const existing = getDB().prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(cleanUsername, req.params.id);
    if (existing) return res.status(409).json({ error: 'Nome de usuário já existe' });
    newUsername = cleanUsername;
  }
  if (password) {
    const weakness = validatePasswordStrength(password);
    if (weakness) return res.status(400).json({ error: weakness });
    newHash = bcrypt.hashSync(password, 12);
    newPwChangedAt = new Date().toISOString(); // invalida sessões antigas
  }
  if (role) {
    if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'role inválido' });
    // Proteção: não permite o admin rebaixar a si mesmo enquanto for o único admin
    if (user.id === req.user.id && user.role === 'admin' && role !== 'admin') {
      const admins = getDB().prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
      if (admins <= 1) return res.status(400).json({ error: 'Não é possível rebaixar o único administrador' });
    }
    newRole = role;
  }

  getDB().prepare('UPDATE users SET username = ?, name = ?, password_hash = ?, role = ?, password_changed_at = ? WHERE id = ?')
    .run(newUsername, newName, newHash, newRole, newPwChangedAt, req.params.id);
  res.json({ id: req.params.id, username: newUsername, name: newName, role: newRole });
});

// DELETE /api/auth/users/:id
router.delete('/users/:id', requireAdmin, (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Não é possível remover seu próprio usuário' });
  }
  // Protege o último admin
  const target = getDB().prepare('SELECT role FROM users WHERE id = ?').get(req.params.id);
  if (target && target.role === 'admin') {
    const admins = getDB().prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;
    if (admins <= 1) return res.status(400).json({ error: 'Não é possível remover o único administrador' });
  }
  const result = getDB().prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Usuário não encontrado' });
  res.json({ message: 'Usuário removido' });
});

module.exports = router;
