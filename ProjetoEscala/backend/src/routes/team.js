const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function getMembersWithShift() {
  return getDB().prepare(`
    SELECT tm.id, tm.name, tm.active, tm.in_rotation, tm.colaborador_id, tm.created_at,
           tm.monthly_sunday_limit, tm.monthly_holiday_limit,
           s.id as shift_id, s.label as shift_label,
           s.start_time as shift_start, s.end_time as shift_end
    FROM team_members tm
    JOIN shifts s ON tm.shift_id = s.id
    ORDER BY s.start_time, tm.name
  `).all().map(row => ({
    id: row.id,
    name: row.name,
    colaborador_id: row.colaborador_id,
    active: row.active === 1,
    in_rotation: row.in_rotation === 1,
    monthly_sunday_limit: row.monthly_sunday_limit,
    monthly_holiday_limit: row.monthly_holiday_limit,
    created_at: row.created_at,
    shift: {
      id: row.shift_id,
      label: row.shift_label,
      start_time: row.shift_start,
      end_time: row.shift_end,
    }
  }));
}

function cleanLimit(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseInt(v, 10);
  if (Number.isNaN(n) || n < 0) return null;
  return Math.min(n, 99);
}

// GET /api/team
router.get('/', requireAuth, (req, res) => {
  res.json(getMembersWithShift());
});

// POST /api/team
router.post('/', requireAdmin, (req, res) => {
  const { colaborador_id, name: nameOverride, shift_id, in_rotation = true } = req.body;
  if (!shift_id) return res.status(400).json({ error: 'shift_id é obrigatório' });

  let finalName = nameOverride?.trim();
  let finalColaboradorId = colaborador_id || null;

  // Se colaborador_id fornecido, busca nome no cadastro de colaboradores
  if (colaborador_id) {
    const colab = getDB().prepare('SELECT * FROM colaboradores WHERE id = ?').get(colaborador_id);
    if (!colab) return res.status(404).json({ error: 'Colaborador não encontrado' });
    finalName = colab.name;

    // Verifica se já está na equipe
    const alreadyIn = getDB().prepare('SELECT id FROM team_members WHERE colaborador_id = ?').get(colaborador_id);
    if (alreadyIn) return res.status(409).json({ error: 'Este colaborador já está na Equipe de Plantão' });
  }

  if (!finalName) return res.status(400).json({ error: 'colaborador_id ou name é obrigatório' });

  const shift = getDB().prepare('SELECT id FROM shifts WHERE id = ?').get(shift_id);
  if (!shift) return res.status(404).json({ error: 'Turno não encontrado' });

  const id = uuidv4();
  const mSunday = cleanLimit(req.body.monthly_sunday_limit);
  const mHoliday = cleanLimit(req.body.monthly_holiday_limit);
  getDB().prepare('INSERT INTO team_members (id, name, shift_id, active, in_rotation, colaborador_id, monthly_sunday_limit, monthly_holiday_limit) VALUES (?, ?, ?, 1, ?, ?, ?, ?)').run(
    id, finalName, shift_id, in_rotation ? 1 : 0, finalColaboradorId, mSunday, mHoliday
  );

  const members = getMembersWithShift();
  res.status(201).json(members.find(m => m.id === id));
});

// PUT /api/team/:id
router.put('/:id', requireAdmin, (req, res) => {
  const { name, shift_id, active, in_rotation } = req.body;
  const member = getDB().prepare('SELECT * FROM team_members WHERE id = ?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Membro não encontrado' });

  let newShiftId = member.shift_id;
  if (shift_id !== undefined) {
    const shift = getDB().prepare('SELECT id FROM shifts WHERE id = ?').get(shift_id);
    if (!shift) return res.status(404).json({ error: 'Turno não encontrado' });
    newShiftId = shift_id;
  }

  // Nome só pode ser alterado manualmente se não tiver colaborador_id vinculado
  const newName = (name && !member.colaborador_id) ? name.trim() : member.name;
  const newActive = active !== undefined ? (active ? 1 : 0) : member.active;
  const newInRotation = in_rotation !== undefined ? (in_rotation ? 1 : 0) : member.in_rotation;
  const newSundayLimit = req.body.monthly_sunday_limit !== undefined ? cleanLimit(req.body.monthly_sunday_limit) : member.monthly_sunday_limit;
  const newHolidayLimit = req.body.monthly_holiday_limit !== undefined ? cleanLimit(req.body.monthly_holiday_limit) : member.monthly_holiday_limit;

  getDB().prepare('UPDATE team_members SET name = ?, shift_id = ?, active = ?, in_rotation = ?, monthly_sunday_limit = ?, monthly_holiday_limit = ? WHERE id = ?').run(
    newName, newShiftId, newActive, newInRotation, newSundayLimit, newHolidayLimit, req.params.id
  );

  const members = getMembersWithShift();
  res.json(members.find(m => m.id === req.params.id));
});

// DELETE /api/team/:id
router.delete('/:id', requireAdmin, (req, res) => {
  const result = getDB().prepare('DELETE FROM team_members WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Membro não encontrado' });
  res.json({ message: 'Membro removido' });
});

module.exports = router;
