const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function parseRow(c) {
  return {
    ...c,
    active: c.active === 1,
    work_days: JSON.parse(c.work_days || '[]'),
    rotation_work_days: c.rotation_work_days || 1,
    rotation_rest_days: c.rotation_rest_days || 2,
    schedule_type: c.schedule_type || 'fixed',
    rotation_anchor: c.rotation_anchor || '',
  };
}

// GET /api/colaboradores
router.get('/', requireAuth, (req, res) => {
  const list = getDB().prepare('SELECT * FROM colaboradores ORDER BY name').all();
  res.json(list.map(parseRow));
});

// POST /api/colaboradores
router.post('/', requireAdmin, (req, res) => {
  const {
    name,
    schedule_type = 'fixed',
    work_days = [],
    work_start = '',
    work_end = '',
    rotation_work_days = 1,
    rotation_rest_days = 2,
    rotation_anchor = '',
  } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: 'Nome é obrigatório' });
  if (!['fixed', 'rotating'].includes(schedule_type)) return res.status(400).json({ error: 'schedule_type inválido' });
  if (schedule_type === 'rotating' && !rotation_anchor) return res.status(400).json({ error: 'Data de referência é obrigatória para escala rotativa' });

  const id = uuidv4();
  getDB().prepare(`
    INSERT INTO colaboradores (id, name, schedule_type, work_days, work_start, work_end, rotation_work_days, rotation_rest_days, rotation_anchor, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(id, name.trim(), schedule_type, JSON.stringify(work_days), work_start, work_end, rotation_work_days, rotation_rest_days, rotation_anchor);

  res.status(201).json({
    id, name: name.trim(), schedule_type, work_days, work_start, work_end,
    rotation_work_days, rotation_rest_days, rotation_anchor, active: true,
  });
});

// PUT /api/colaboradores/:id
router.put('/:id', requireAdmin, (req, res) => {
  const c = getDB().prepare('SELECT * FROM colaboradores WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Colaborador não encontrado' });

  const {
    name, schedule_type, work_days, work_start, work_end,
    rotation_work_days, rotation_rest_days, rotation_anchor, active,
  } = req.body;

  const newName = name?.trim() || c.name;
  const newType = schedule_type !== undefined ? schedule_type : (c.schedule_type || 'fixed');
  const newDays = work_days !== undefined ? JSON.stringify(work_days) : c.work_days;
  const newStart = work_start !== undefined ? work_start : c.work_start;
  const newEnd = work_end !== undefined ? work_end : c.work_end;
  const newRotWork = rotation_work_days !== undefined ? rotation_work_days : (c.rotation_work_days || 1);
  const newRotRest = rotation_rest_days !== undefined ? rotation_rest_days : (c.rotation_rest_days || 2);
  const newAnchor = rotation_anchor !== undefined ? rotation_anchor : (c.rotation_anchor || '');
  const newActive = active !== undefined ? (active ? 1 : 0) : c.active;

  getDB().prepare(`
    UPDATE colaboradores SET name=?, schedule_type=?, work_days=?, work_start=?, work_end=?,
    rotation_work_days=?, rotation_rest_days=?, rotation_anchor=?, active=? WHERE id=?
  `).run(newName, newType, newDays, newStart, newEnd, newRotWork, newRotRest, newAnchor, newActive, req.params.id);

  res.json({
    id: req.params.id, name: newName, schedule_type: newType,
    work_days: JSON.parse(newDays), work_start: newStart, work_end: newEnd,
    rotation_work_days: newRotWork, rotation_rest_days: newRotRest,
    rotation_anchor: newAnchor, active: !!newActive,
  });
});

// DELETE /api/colaboradores/:id
router.delete('/:id', requireAdmin, (req, res) => {
  const inUse = getDB().prepare('SELECT id FROM team_members WHERE colaborador_id = ?').get(req.params.id);
  if (inUse) {
    return res.status(409).json({ error: 'Colaborador está na Equipe de Plantão. Remova-o da equipe antes de excluir.' });
  }
  const result = getDB().prepare('DELETE FROM colaboradores WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Colaborador não encontrado' });
  res.json({ message: 'Colaborador removido' });
});

module.exports = router;
