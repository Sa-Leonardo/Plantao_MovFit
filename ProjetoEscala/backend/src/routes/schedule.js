const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function parseMembers(row) {
  if (row.members) {
    try {
      const arr = JSON.parse(row.members);
      if (Array.isArray(arr)) return arr;
    } catch (_) {}
  }
  return [];
}

// GET /api/schedule/:year/:month — retorna snapshots persistidos no formato { date: { shift_id: [member_ids] } }
router.get('/:year/:month', requireAuth, (req, res) => {
  const year = parseInt(req.params.year, 10);
  const month = parseInt(req.params.month, 10); // 1-12
  if (!year || !month || month < 1 || month > 12) {
    return res.status(400).json({ error: 'Ano ou mês inválido' });
  }
  const ys = String(year).padStart(4, '0');
  const ms = String(month).padStart(2, '0');
  const prefix = `${ys}-${ms}-%`;
  const rows = getDB().prepare('SELECT date, shift_id, members FROM schedule_snapshots WHERE date LIKE ?').all(prefix);
  const result = {};
  for (const row of rows) {
    if (!result[row.date]) result[row.date] = {};
    result[row.date][row.shift_id] = parseMembers(row);
  }
  res.json(result);
});

// POST /api/schedule/snapshot — persiste snapshots de escala gerada
// Body: { schedule: { date: { shift_id: [member_ids] } }, overwrite?: boolean }
// Por padrão NÃO sobrescreve registros existentes (imutabilidade do passado).
router.post('/snapshot', requireAdmin, (req, res) => {
  const { schedule, overwrite } = req.body || {};
  if (typeof schedule !== 'object' || !schedule) {
    return res.status(400).json({ error: 'Body deve conter { schedule: { date: { shift_id: [...] } } }' });
  }
  const db = getDB();
  const insert = db.prepare(`
    INSERT INTO schedule_snapshots (id, date, shift_id, members)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(date, shift_id) DO NOTHING
  `);
  const upsert = db.prepare(`
    INSERT INTO schedule_snapshots (id, date, shift_id, members, generated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(date, shift_id) DO UPDATE SET members = excluded.members, generated_at = datetime('now')
  `);

  let saved = 0;
  const tx = db.transaction(() => {
    for (const [date, shifts] of Object.entries(schedule)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (typeof shifts !== 'object' || !shifts) continue;
      for (const [shiftId, members] of Object.entries(shifts)) {
        const memberIds = Array.isArray(members) ? members.filter(Boolean) : [];
        const json = JSON.stringify(memberIds);
        const stmt = overwrite ? upsert : insert;
        const info = stmt.run(uuidv4(), date, shiftId, json);
        if (info.changes > 0) saved++;
      }
    }
  });
  tx();
  res.json({ saved });
});

// GET /api/schedule/counts?before=YYYY-MM-DD
// Retorna { sundayCounts, holidayCounts } agregados de todos os dias ESCALADOS
// até a data informada (exclusive). Combina overrides (prioridade) + snapshots.
// Usado pelo frontend para semear a fairness entre meses.
router.get('/counts', requireAuth, (req, res) => {
  const db = getDB();
  const before = req.query.before;
  const clauses = [];
  const params = [];
  if (before && /^\d{4}-\d{2}-\d{2}$/.test(before)) {
    clauses.push('date < ?');
    params.push(before);
  }
  // Respeita schedule_start_date: datas anteriores ao início do histórico não
  // existem no sistema, portanto NÃO devem contribuir para o seed de fairness.
  // Sem este filtro, o /counts ficaria inconsistente com rotation.js (que pula
  // dias antes de historyStart), causando seed diferente do mês em si.
  const startRow = db.prepare("SELECT value FROM settings WHERE key = 'schedule_start_date'").get();
  const scheduleStart = startRow && /^\d{4}-\d{2}-\d{2}$/.test(startRow.value) ? startRow.value : null;
  if (scheduleStart) {
    clauses.push('date >= ?');
    params.push(scheduleStart);
  }
  const f = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';

  // Filtro por data aplicado em AMBOS (override e snapshot) para evitar
  // dupla contagem quando a rotação processar o mês atual.
  const overrides = db.prepare(`SELECT date, shift_id, member_id, members FROM overrides${f}`).all(...params);
  const snapshots = db.prepare(`SELECT date, shift_id, members FROM schedule_snapshots${f}`).all(...params);
  const holidaysSet = new Set(db.prepare('SELECT date FROM holidays').all().map(h => h.date));

  const sundayCounts = {};
  const holidayCounts = {};

  const isSundayLocal = (ds) => {
    const [y, m, d] = ds.split('-').map(Number);
    return new Date(y, m - 1, d).getDay() === 0;
  };
  const bump = (memberId, ds) => {
    if (!memberId) return;
    const sun = isSundayLocal(ds);
    const hol = !sun && holidaysSet.has(ds);
    if (sun) sundayCounts[memberId] = (sundayCounts[memberId] || 0) + 1;
    else if (hol) holidayCounts[memberId] = (holidayCounts[memberId] || 0) + 1;
  };

  const seenOverride = new Set();
  for (const o of overrides) {
    seenOverride.add(`${o.date}:${o.shift_id}`);
    let ids = [];
    if (o.members) { try { ids = JSON.parse(o.members); } catch (_) {} }
    if ((!ids || ids.length === 0) && o.member_id) ids = [o.member_id];
    for (const id of ids) bump(id, o.date);
  }
  for (const s of snapshots) {
    if (seenOverride.has(`${s.date}:${s.shift_id}`)) continue;
    let ids = [];
    if (s.members) { try { ids = JSON.parse(s.members); } catch (_) {} }
    for (const id of ids) bump(id, s.date);
  }

  res.json({ sundayCounts, holidayCounts });
});

// DELETE /api/schedule/snapshot/:date — remove snapshot de uma data (admin)
router.delete('/snapshot/:date', requireAdmin, (req, res) => {
  const info = getDB().prepare('DELETE FROM schedule_snapshots WHERE date = ?').run(req.params.date);
  res.json({ removed: info.changes });
});

// DELETE /api/schedule/snapshots — limpa TODOS os snapshots (admin)
// Use com cuidado: apaga o histórico consolidado. Parâmetro opcional ?before=YYYY-MM-DD
// limita a limpeza a datas anteriores ao valor informado.
router.delete('/snapshots', requireAdmin, (req, res) => {
  const { before } = req.query || {};
  let info;
  if (before && /^\d{4}-\d{2}-\d{2}$/.test(before)) {
    info = getDB().prepare('DELETE FROM schedule_snapshots WHERE date < ?').run(before);
  } else {
    info = getDB().prepare('DELETE FROM schedule_snapshots').run();
  }
  res.json({ removed: info.changes });
});

module.exports = router;
