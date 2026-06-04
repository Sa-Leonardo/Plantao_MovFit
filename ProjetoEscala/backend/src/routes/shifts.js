const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Normaliza uma row: garante que sunday_slots e holiday_slots existam,
// fazendo fallback para a coluna legada `slots` quando não definidos.
function parseShift(s) {
  const legacy = s.slots || 1;
  const sunday = s.sunday_slots != null ? Number(s.sunday_slots) : legacy;
  const holiday = s.holiday_slots != null ? Number(s.holiday_slots) : legacy;
  return {
    ...s,
    slots: legacy,
    sunday_slots: Math.max(1, sunday),
    holiday_slots: Math.max(1, holiday),
  };
}

function clampSlots(v, fallback = 1) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n) || n < 1) return fallback;
  return Math.min(20, n);
}

// GET /api/shifts
router.get('/', requireAuth, (req, res) => {
  const shifts = getDB().prepare('SELECT * FROM shifts ORDER BY start_time').all();
  res.json(shifts.map(parseShift));
});

// POST /api/shifts
router.post('/', requireAdmin, (req, res) => {
  const { label, start_time, end_time, slots, sunday_slots, holiday_slots } = req.body;
  if (!label || !start_time || !end_time) {
    return res.status(400).json({ error: 'label, start_time e end_time são obrigatórios' });
  }
  const legacy = clampSlots(slots != null ? slots : (sunday_slots ?? holiday_slots ?? 1));
  const sSlots = clampSlots(sunday_slots != null ? sunday_slots : legacy);
  const hSlots = clampSlots(holiday_slots != null ? holiday_slots : legacy);
  const id = uuidv4();
  getDB().prepare('INSERT INTO shifts (id, label, start_time, end_time, slots, sunday_slots, holiday_slots) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, label.trim(), start_time, end_time, legacy, sSlots, hSlots
  );
  res.status(201).json(parseShift({ id, label: label.trim(), start_time, end_time, slots: legacy, sunday_slots: sSlots, holiday_slots: hSlots }));
});

// PUT /api/shifts/:id
router.put('/:id', requireAdmin, (req, res) => {
  const { label, start_time, end_time, slots, sunday_slots, holiday_slots } = req.body;
  const shift = getDB().prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
  if (!shift) return res.status(404).json({ error: 'Turno não encontrado' });

  const newLabel = (label || shift.label).trim();
  const newStart = start_time || shift.start_time;
  const newEnd = end_time || shift.end_time;
  const currentLegacy = shift.slots || 1;
  const newLegacy = slots !== undefined ? clampSlots(slots, currentLegacy) : currentLegacy;
  const newSunday = sunday_slots !== undefined ? clampSlots(sunday_slots, newLegacy) : (shift.sunday_slots != null ? shift.sunday_slots : newLegacy);
  const newHoliday = holiday_slots !== undefined ? clampSlots(holiday_slots, newLegacy) : (shift.holiday_slots != null ? shift.holiday_slots : newLegacy);

  getDB().prepare('UPDATE shifts SET label = ?, start_time = ?, end_time = ?, slots = ?, sunday_slots = ?, holiday_slots = ? WHERE id = ?').run(
    newLabel, newStart, newEnd, newLegacy, newSunday, newHoliday, req.params.id
  );
  res.json(parseShift({ id: req.params.id, label: newLabel, start_time: newStart, end_time: newEnd, slots: newLegacy, sunday_slots: newSunday, holiday_slots: newHoliday }));
});

// DELETE /api/shifts/:id
router.delete('/:id', requireAdmin, (req, res) => {
  const members = getDB().prepare('SELECT id FROM team_members WHERE shift_id = ?').all(req.params.id);
  if (members.length > 0) {
    return res.status(409).json({
      error: `Não é possível remover este turno: ${members.length} membro(s) estão vinculados a ele. Realoque-os primeiro.`
    });
  }
  const result = getDB().prepare('DELETE FROM shifts WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Turno não encontrado' });
  res.json({ message: 'Turno removido' });
});

module.exports = router;
