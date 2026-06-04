const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/holidays
router.get('/', requireAuth, (req, res) => {
  const holidays = getDB().prepare('SELECT * FROM holidays ORDER BY date').all();
  res.json(holidays.map(h => ({ ...h, is_fixed: h.is_fixed === 1 })));
});

// POST /api/holidays
router.post('/', requireAdmin, (req, res) => {
  const { date, label, is_fixed = false, scope = 'national', state = null, city = null } = req.body;
  if (!date) return res.status(400).json({ error: 'date é obrigatório (YYYY-MM-DD)' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Formato de data inválido. Use YYYY-MM-DD' });

  const validScopes = ['national', 'state', 'municipal', 'optional'];
  if (!validScopes.includes(scope)) return res.status(400).json({ error: `scope deve ser: ${validScopes.join(', ')}` });

  const existing = getDB().prepare('SELECT id FROM holidays WHERE date = ?').get(date);
  if (existing) return res.status(409).json({ error: 'Já existe um feriado nesta data' });

  const id = uuidv4();
  const finalLabel = (label || 'Feriado').trim();
  getDB().prepare('INSERT INTO holidays (id, date, label, is_fixed, scope, state, city) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, date, finalLabel, is_fixed ? 1 : 0, scope, state || null, city || null
  );
  res.status(201).json({ id, date, label: finalLabel, is_fixed: !!is_fixed, scope, state, city });
});

// PUT /api/holidays/:id  (editar)
router.put('/:id', requireAdmin, (req, res) => {
  const h = getDB().prepare('SELECT * FROM holidays WHERE id = ?').get(req.params.id);
  if (!h) return res.status(404).json({ error: 'Feriado não encontrado' });

  const { label, is_fixed, scope, state, city } = req.body;
  const newLabel = label ? label.trim() : h.label;
  const newFixed = is_fixed !== undefined ? (is_fixed ? 1 : 0) : h.is_fixed;
  const newScope = scope || h.scope;
  const newState = state !== undefined ? state : h.state;
  const newCity = city !== undefined ? city : h.city;

  getDB().prepare('UPDATE holidays SET label=?, is_fixed=?, scope=?, state=?, city=? WHERE id=?').run(
    newLabel, newFixed, newScope, newState, newCity, req.params.id
  );
  res.json({ id: req.params.id, date: h.date, label: newLabel, is_fixed: !!newFixed, scope: newScope, state: newState, city: newCity });
});

// DELETE /api/holidays/:date
router.delete('/:date', requireAdmin, (req, res) => {
  const result = getDB().prepare('DELETE FROM holidays WHERE date = ?').run(req.params.date);
  if (result.changes === 0) return res.status(404).json({ error: 'Feriado não encontrado' });
  res.json({ message: 'Feriado removido' });
});

// GET /api/holidays/brasil-api/:year  — busca feriados nacionais via BrasilAPI
router.get('/brasil-api/:year', requireAuth, async (req, res) => {
  const { year } = req.params;
  if (!/^\d{4}$/.test(year)) return res.status(400).json({ error: 'Ano inválido' });
  try {
    const response = await fetch(`https://brasilapi.com.br/api/feriados/v1/${year}`);
    if (!response.ok) throw new Error(`BrasilAPI retornou ${response.status}`);
    const data = await response.json();
    // Enriquece com info se já existe no banco
    const existingDates = new Set(
      getDB().prepare('SELECT date FROM holidays').all().map(h => h.date)
    );
    // BrasilAPI type: "national" | "optional" | "observance"
    const scopeMap = { national: 'national', optional: 'optional', observance: 'optional' };
    const result = data.map(h => ({
      date: h.date,
      label: h.name,
      scope: scopeMap[h.type] || 'national',
      type_raw: h.type,
      is_fixed: isFixedHoliday(h.date, h.name),
      weekday: h.weekday,
      already_imported: existingDates.has(h.date),
    }));
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: `Erro ao buscar BrasilAPI: ${err.message}` });
  }
});

// POST /api/holidays/import  — importa feriados selecionados
router.post('/import', requireAdmin, (req, res) => {
  const { holidays } = req.body;
  if (!Array.isArray(holidays) || holidays.length === 0) {
    return res.status(400).json({ error: 'Envie um array de feriados em { holidays: [...] }' });
  }

  const insert = getDB().prepare('INSERT OR IGNORE INTO holidays (id, date, label, is_fixed, scope, state, city) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const importAll = getDB().transaction(() => {
    const imported = [];
    for (const h of holidays) {
      if (!h.date || !/^\d{4}-\d{2}-\d{2}$/.test(h.date)) continue;
      const result = insert.run(
        uuidv4(),
        h.date,
        (h.label || h.name || 'Feriado').trim(),
        h.is_fixed ? 1 : 0,
        h.scope || 'national',
        h.state || null,
        h.city || null,
      );
      if (result.changes > 0) imported.push(h.date);
    }
    return imported;
  });

  const imported = importAll();
  res.json({ imported: imported.length, dates: imported });
});

// Detecta feriados de data fixa (mesma data todo ano)
function isFixedHoliday(date, name) {
  const fixedNames = [
    'confraternização', 'tiradentes', 'trabalho', 'aparecida', 'finados',
    'república', 'consciência negra', 'natal', 'ano novo',
    'independência', 'independencia',
  ];
  const lower = (name || '').toLowerCase();
  return fixedNames.some(n => lower.includes(n));
}

module.exports = router;
