const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { requireHumanAdmin, hashApiKey } = require('../middleware/auth');

const router = express.Router();

// Gera uma chave em texto plano, visível apenas no momento da criação
function generateRawKey() {
  // 32 bytes = 64 chars hex, prefixado para identificar a origem
  return 'esk_' + crypto.randomBytes(32).toString('hex');
}

// GET /api/api-keys — lista (sem expor o hash/chave)
router.get('/', requireHumanAdmin, (req, res) => {
  const rows = getDB().prepare('SELECT id, name, active, created_at, last_used FROM api_keys ORDER BY created_at DESC').all();
  res.json(rows.map(r => ({ ...r, active: !!r.active })));
});

// POST /api/api-keys — cria uma nova API key e retorna a chave EM TEXTO PLANO uma única vez
router.post('/', requireHumanAdmin, (req, res) => {
  const { name } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Nome da chave é obrigatório' });
  }
  const raw = generateRawKey();
  const id = uuidv4();
  getDB().prepare('INSERT INTO api_keys (id, name, key_hash, active) VALUES (?, ?, ?, 1)').run(id, String(name).trim(), hashApiKey(raw));
  res.status(201).json({
    id,
    name: String(name).trim(),
    key: raw, // <- mostrada uma única vez
    active: true,
    warning: 'Guarde esta chave agora — ela não será exibida novamente.',
  });
});

// PUT /api/api-keys/:id — ativa/desativa
router.put('/:id', requireHumanAdmin, (req, res) => {
  const { active, name } = req.body || {};
  const db = getDB();
  const row = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Chave não encontrada' });
  db.prepare('UPDATE api_keys SET active = ?, name = ? WHERE id = ?').run(
    active !== undefined ? (active ? 1 : 0) : row.active,
    name ? String(name).trim() : row.name,
    req.params.id,
  );
  const updated = db.prepare('SELECT id, name, active, created_at, last_used FROM api_keys WHERE id = ?').get(req.params.id);
  res.json({ ...updated, active: !!updated.active });
});

// DELETE /api/api-keys/:id — revoga permanentemente
router.delete('/:id', requireHumanAdmin, (req, res) => {
  const info = getDB().prepare('DELETE FROM api_keys WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Chave não encontrada' });
  res.json({ message: 'Chave revogada' });
});

module.exports = router;
