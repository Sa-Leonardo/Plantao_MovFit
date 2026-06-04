const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// GET /api/absences  (opcionalmente ?member_id=... &year=... &month=...)
router.get('/', requireAuth, (req, res) => {
  const { member_id, year, month } = req.query;
  let sql = `
    SELECT a.*, tm.name as member_name
    FROM absences a
    JOIN team_members tm ON a.member_id = tm.id
    WHERE 1=1
  `;
  const params = [];
  if (member_id) { sql += ' AND a.member_id = ?'; params.push(member_id); }
  if (year && month) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    // Retorna ausências que CONTÊM algum dia do mês solicitado
    const monthEnd = `${prefix}-31`;
    const monthStart = `${prefix}-01`;
    sql += ' AND a.date <= ? AND COALESCE(a.end_date, a.date) >= ?';
    params.push(monthEnd, monthStart);
  } else if (year) {
    sql += ' AND (a.date LIKE ? OR COALESCE(a.end_date, a.date) LIKE ?)';
    params.push(`${year}%`, `${year}%`);
  }
  sql += ' ORDER BY a.date DESC';
  res.json(getDB().prepare(sql).all(...params));
});

// POST /api/absences
// Body: { member_id, date (início), end_date (opcional), reason, absence_type }
router.post('/', requireAdmin, (req, res) => {
  const { member_id, date, end_date, reason, absence_type } = req.body || {};
  if (!member_id || !date) {
    return res.status(400).json({ error: 'member_id e date (início) são obrigatórios' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Formato de data de início inválido. Use YYYY-MM-DD' });
  }
  const endDate = end_date || date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return res.status(400).json({ error: 'Formato de data de fim inválido. Use YYYY-MM-DD' });
  }
  if (endDate < date) {
    return res.status(400).json({ error: 'A data de fim não pode ser anterior à de início' });
  }

  const member = getDB().prepare('SELECT id, name FROM team_members WHERE id = ?').get(member_id);
  if (!member) return res.status(404).json({ error: 'Membro não encontrado' });

  // Impede sobreposição (início <= fim do existente E fim >= início do existente)
  const overlap = getDB().prepare(`
    SELECT id FROM absences
    WHERE member_id = ?
      AND date <= ?
      AND COALESCE(end_date, date) >= ?
  `).get(member_id, endDate, date);
  if (overlap) return res.status(409).json({ error: 'Já existe ausência para este membro que sobrepõe o período informado' });

  const id = uuidv4();
  const validType = ['atestado', 'folga', 'ferias', 'ausencia', 'outro'].includes(absence_type) ? absence_type : 'ausencia';
  getDB().prepare('INSERT INTO absences (id, member_id, date, end_date, reason, absence_type, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, member_id, date, endDate, reason || null, validType, req.user.id
  );

  res.status(201).json({
    id, member_id, member_name: member.name,
    date, end_date: endDate, reason: reason || null, absence_type: validType,
  });
});

// DELETE /api/absences/:id
router.delete('/:id', requireAdmin, (req, res) => {
  const result = getDB().prepare('DELETE FROM absences WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Ausência não encontrada' });
  res.json({ message: 'Ausência removida' });
});

// DELETE /api/absences/member/:member_id/date/:date  (atalho por membro+data)
router.delete('/member/:member_id/date/:date', requireAdmin, (req, res) => {
  const result = getDB().prepare(`
    DELETE FROM absences
    WHERE member_id = ?
      AND date <= ?
      AND COALESCE(end_date, date) >= ?
  `).run(req.params.member_id, req.params.date, req.params.date);
  if (result.changes === 0) return res.status(404).json({ error: 'Ausência não encontrada' });
  res.json({ message: 'Ausência removida' });
});

module.exports = router;
