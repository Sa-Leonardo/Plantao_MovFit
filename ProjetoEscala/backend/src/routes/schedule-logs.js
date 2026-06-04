const express = require('express');
const { getDB } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/schedule-logs  (?date=2026-01-05 &limit=50)
router.get('/', requireAuth, (req, res) => {
  const { date, limit = 100 } = req.query;
  let sql = 'SELECT * FROM schedule_logs WHERE 1=1';
  const params = [];
  if (date) { sql += ' AND date = ?'; params.push(date); }
  sql += ' ORDER BY changed_at DESC LIMIT ?';
  params.push(Math.min(Number(limit), 500));
  res.json(getDB().prepare(sql).all(...params));
});

module.exports = router;
