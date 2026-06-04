const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { triggerWebhook, assertSafeWebhookUrl } = require('../webhooks');

const router = express.Router();

function parseWebhook(row) {
  return { ...row, events: JSON.parse(row.events || '[]'), active: row.active === 1 };
}

// GET /api/webhooks
router.get('/', requireAdmin, (req, res) => {
  const rows = getDB().prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all();
  res.json(rows.map(parseWebhook));
});

// GET /api/webhooks/:id/deliveries
router.get('/:id/deliveries', requireAdmin, (req, res) => {
  const rows = getDB().prepare(`
    SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY delivered_at DESC LIMIT 50
  `).all(req.params.id);
  res.json(rows);
});

// POST /api/webhooks
router.post('/', requireAdmin, async (req, res) => {
  const { name, url, secret, events, notify_time, days_before } = req.body;
  if (!name || !url) return res.status(400).json({ error: 'name e url são obrigatórios' });
  try { await assertSafeWebhookUrl(url); }
  catch (err) { return res.status(400).json({ error: `URL bloqueada: ${err.message}` }); }

  const validEvents = ['schedule_changed', 'pre_event'];
  const eventsArr = Array.isArray(events) ? events.filter(e => validEvents.includes(e)) : ['schedule_changed'];
  if (eventsArr.length === 0) return res.status(400).json({ error: `events deve conter: ${validEvents.join(', ')}` });

  const id = uuidv4();
  getDB().prepare(`
    INSERT INTO webhooks (id, name, url, secret, events, notify_time, days_before)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name.trim(), url.trim(), secret || null, JSON.stringify(eventsArr), notify_time || '08:00', days_before || 1);

  const created = getDB().prepare('SELECT * FROM webhooks WHERE id = ?').get(id);
  res.status(201).json(parseWebhook(created));
});

// PUT /api/webhooks/:id
router.put('/:id', requireAdmin, async (req, res) => {
  const wh = getDB().prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id);
  if (!wh) return res.status(404).json({ error: 'Webhook não encontrado' });

  const { name, url, secret, events, active, notify_time, days_before } = req.body;
  if (url && url !== wh.url) {
    try { await assertSafeWebhookUrl(url); }
    catch (err) { return res.status(400).json({ error: `URL bloqueada: ${err.message}` }); }
  }
  const validEvents = ['schedule_changed', 'pre_event'];
  const eventsArr = Array.isArray(events)
    ? events.filter(e => validEvents.includes(e))
    : JSON.parse(wh.events || '[]');

  getDB().prepare(`
    UPDATE webhooks SET name=?, url=?, secret=?, events=?, active=?, notify_time=?, days_before=? WHERE id=?
  `).run(
    name ? name.trim() : wh.name,
    url ? url.trim() : wh.url,
    secret !== undefined ? secret : wh.secret,
    JSON.stringify(eventsArr),
    active !== undefined ? (active ? 1 : 0) : wh.active,
    notify_time || wh.notify_time,
    days_before !== undefined ? days_before : wh.days_before,
    req.params.id
  );

  const updated = getDB().prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id);
  res.json(parseWebhook(updated));
});

// DELETE /api/webhooks/:id
router.delete('/:id', requireAdmin, (req, res) => {
  const result = getDB().prepare('DELETE FROM webhooks WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Webhook não encontrado' });
  res.json({ message: 'Webhook removido' });
});

// Calcula o próximo domingo/feriado a partir de hoje (até 90 dias à frente)
function findNextSpecialDate(db) {
  const holidays = new Set(db.prepare('SELECT date FROM holidays').all().map(h => h.date));
  const today = new Date();
  for (let i = 0; i < 90; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const isSunday = d.getDay() === 0;
    const isHoliday = holidays.has(ds);
    if (isSunday || isHoliday) {
      return {
        date: ds,
        day_of_week: ['Dom','Seg','Ter','Qua','Qui','Sex','Sab'][d.getDay()],
        is_sunday: isSunday,
        is_holiday: isHoliday,
        holiday_name: isHoliday ? (db.prepare('SELECT label FROM holidays WHERE date = ?').get(ds)?.label || null) : null,
      };
    }
  }
  return null;
}

// Monta a escala completa de um dia (domingos/feriados) com nomes dos membros por turno
function buildFullDaySchedule(db, dateStr) {
  const shifts = db.prepare('SELECT id, label, start_time, end_time FROM shifts ORDER BY start_time').all();
  const overrides = db.prepare('SELECT shift_id, member_id, members FROM overrides WHERE date = ?').all(dateStr);
  const snapshots = db.prepare('SELECT shift_id, members FROM schedule_snapshots WHERE date = ?').all(dateStr);

  const membersByShift = {};
  for (const s of shifts) membersByShift[s.id] = [];

  const parseMembers = (row) => {
    if (row.members) { try { const a = JSON.parse(row.members); if (Array.isArray(a)) return a; } catch(_){} }
    if (row.member_id) return [row.member_id];
    return [];
  };

  // Override tem prioridade
  const overriddenShifts = new Set();
  for (const o of overrides) {
    membersByShift[o.shift_id] = parseMembers(o);
    overriddenShifts.add(o.shift_id);
  }
  // Snapshots preenchem os turnos não sobrescritos
  for (const sn of snapshots) {
    if (!overriddenShifts.has(sn.shift_id)) {
      membersByShift[sn.shift_id] = parseMembers(sn);
    }
  }

  return shifts.map(s => {
    const ids = membersByShift[s.id] || [];
    const memberNames = ids.map(id => {
      const m = db.prepare('SELECT name FROM team_members WHERE id = ?').get(id);
      return m ? m.name : null;
    }).filter(Boolean);
    return {
      shift_id: s.id,
      shift_label: s.label,
      start_time: s.start_time,
      end_time: s.end_time,
      members: memberNames,
    };
  });
}

// POST /api/webhooks/:id/test — envia payload de teste com o PRÓXIMO plantão real
router.post('/:id/test', requireAdmin, async (req, res) => {
  const db = getDB();
  const wh = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(req.params.id);
  if (!wh) return res.status(404).json({ error: 'Webhook não encontrado' });

  const next = findNextSpecialDate(db);
  if (!next) {
    return res.status(400).json({ error: 'Nenhum domingo ou feriado encontrado nos próximos 90 dias' });
  }

  try {
    await triggerWebhook('pre_event', {
      test: true,
      event_date: next.date,
      event_type: next.is_sunday ? 'sunday' : 'holiday',
      event_name: next.holiday_name || (next.is_sunday ? 'Domingo' : 'Feriado'),
      day_of_week: next.day_of_week,
      schedule: buildFullDaySchedule(db, next.date),
      message: 'Webhook de teste — dados do próximo plantão',
      triggered_by: req.user.username,
    });
    res.json({
      message: 'Teste enviado com sucesso',
      next_event: next,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
