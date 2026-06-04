const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { triggerWebhook } = require('../webhooks');

const router = express.Router();

// Lê membros de uma row — suporta coluna `members` (JSON array) ou legado `member_id`
function parseMembers(row) {
  if (row.members) {
    try {
      const arr = JSON.parse(row.members);
      if (Array.isArray(arr) && arr.length > 0) return arr;
    } catch (_) {}
  }
  // legado: coluna member_id
  if (row.member_id) return [row.member_id];
  return [];
}

// GET /api/overrides
// Retorna { date: { shift_id: [member_id, ...] } }
router.get('/', requireAuth, (req, res) => {
  const rows = getDB().prepare('SELECT date, shift_id, member_id, members FROM overrides').all();
  const result = {};
  for (const row of rows) {
    if (!result[row.date]) result[row.date] = {};
    result[row.date][row.shift_id] = parseMembers(row);
  }
  res.json(result);
});

// PUT /api/overrides/:date
// Body: { assignments: { shift_id: [member_id, ...] }, reason: "motivo" }
// Também aceita formato legado: { shift_id: member_id }
router.put('/:date', requireAdmin, (req, res) => {
  const { date } = req.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Formato de data inválido. Use YYYY-MM-DD' });
  }

  const { assignments, reason } = req.body;
  if (typeof assignments !== 'object' || Array.isArray(assignments)) {
    return res.status(400).json({ error: 'Body deve conter { assignments: { shift_id: [member_id,...] }, reason: string }' });
  }

  const db = getDB();

  // Lê estado anterior
  const previousRows = db.prepare('SELECT shift_id, member_id, members FROM overrides WHERE date = ?').all(date);
  const previousMap = {};
  for (const r of previousRows) previousMap[r.shift_id] = parseMembers(r);

  const upsert = db.prepare(`
    INSERT INTO overrides (id, date, shift_id, member_id, members)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(date, shift_id) DO UPDATE SET member_id = excluded.member_id, members = excluded.members
  `);
  const del = db.prepare('DELETE FROM overrides WHERE date = ? AND shift_id = ?');

  const logInsert = db.prepare(`
    INSERT INTO schedule_logs (id, date, shift_id, shift_label, old_member_id, old_member_name, new_member_id, new_member_name, reason, changed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const saveAll = db.transaction(() => {
    for (const [shiftId, rawValue] of Object.entries(assignments)) {
      // Normaliza para array
      let memberIds;
      if (Array.isArray(rawValue)) {
        memberIds = rawValue.filter(Boolean);
      } else if (rawValue === null || rawValue === '') {
        memberIds = [];
      } else {
        memberIds = [rawValue];
      }

      const shift = db.prepare('SELECT label FROM shifts WHERE id = ?').get(shiftId);
      const oldMembers = previousMap[shiftId] || [];

      if (memberIds.length === 0) {
        del.run(date, shiftId);
      } else {
        // Usa o primeiro como member_id legado; todos ficam em members JSON
        upsert.run(uuidv4(), date, shiftId, memberIds[0], JSON.stringify(memberIds));
      }

      // Log: registra cada mudança individualmente (primeiro membro como representativo)
      const oldFirst = oldMembers[0] || null;
      const newFirst = memberIds[0] || null;
      if (oldFirst !== newFirst || oldMembers.length !== memberIds.length) {
        const oldMember = oldFirst ? db.prepare('SELECT name FROM team_members WHERE id = ?').get(oldFirst) : null;
        const newMember = newFirst ? db.prepare('SELECT name FROM team_members WHERE id = ?').get(newFirst) : null;
        logInsert.run(
          uuidv4(), date, shiftId,
          shift ? shift.label : shiftId,
          oldFirst, oldMember ? oldMember.name : null,
          newFirst, newMember ? newMember.name : null,
          reason || null,
          req.user.username
        );
      }
    }
  });
  saveAll();

  // Dispara webhook
  triggerWebhook('schedule_changed', {
    date,
    assignments,
    reason: reason || null,
    changed_by: req.user.username,
  }).catch(err => console.error('[Webhook] Erro ao disparar:', err.message));

  // Retorna overrides atualizados
  const rows = db.prepare('SELECT shift_id, member_id, members FROM overrides WHERE date = ?').all(date);
  const result = {};
  for (const row of rows) result[row.shift_id] = parseMembers(row);
  res.json({ date, assignments: result });
});

// DELETE /api/overrides/:date
router.delete('/:date', requireAdmin, (req, res) => {
  getDB().prepare('DELETE FROM overrides WHERE date = ?').run(req.params.date);
  res.json({ message: 'Overrides removidos para ' + req.params.date });
});

module.exports = router;
