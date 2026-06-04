const express = require('express');
const { getDB } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Parseia valores textuais para tipos primitivos (bool, number, string)
function parseValue(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isNaN(n) && v.trim() !== '') return n;
  return v;
}

function stringifyValue(v) {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (v === null || v === undefined) return '';
  return String(v);
}

// GET /api/settings — retorna todas as configurações como objeto {key: value}
router.get('/', requireAuth, (req, res) => {
  const rows = getDB().prepare('SELECT key, value FROM settings').all();
  const result = {};
  for (const r of rows) result[r.key] = parseValue(r.value);
  res.json(result);
});

// PUT /api/settings — atualiza várias configurações de uma vez
// Body: { key1: value1, key2: value2, ... }
router.put('/', requireAdmin, (req, res) => {
  const payload = req.body || {};
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    return res.status(400).json({ error: 'Body deve ser um objeto { key: value, ... }' });
  }
  const db = getDB();
  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `);
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(payload)) upsert.run(k, stringifyValue(v));
  });
  tx();

  const rows = db.prepare('SELECT key, value FROM settings').all();
  const result = {};
  for (const r of rows) result[r.key] = parseValue(r.value);
  res.json(result);
});

module.exports = router;
