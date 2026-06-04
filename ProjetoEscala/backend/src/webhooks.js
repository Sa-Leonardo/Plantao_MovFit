const { getDB } = require('./db');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const net = require('net');
const dns = require('dns').promises;

/**
 * Bloqueia SSRF — recusa URLs que apontem para endereços internos/reservados.
 * Chamado antes de enviar cada webhook.
 */
function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => Number.isNaN(p))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;                     // loopback
  if (a === 0) return true;                       // "this network"
  if (a === 169 && b === 254) return true;        // link-local (AWS/GCP metadata)
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true;                      // multicast / reservado
  return false;
}
function isPrivateIPv6(ip) {
  const l = ip.toLowerCase();
  if (l === '::1' || l === '::' || l.startsWith('fe80:') || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('::ffff:')) return true;
  return false;
}
async function assertSafeWebhookUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new Error('URL inválida'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Protocolo não permitido (use http/https)');
  const host = u.hostname;
  // Hostnames proibidos explicitamente
  const forbidden = ['localhost', 'metadata.google.internal', 'metadata'];
  if (forbidden.includes(host.toLowerCase())) throw new Error('Host proibido');

  // Se já é IP, valida direto
  if (net.isIP(host)) {
    if (net.isIP(host) === 4 && isPrivateIPv4(host)) throw new Error('IP privado não permitido');
    if (net.isIP(host) === 6 && isPrivateIPv6(host)) throw new Error('IP privado não permitido');
    return;
  }
  // Senão resolve DNS e verifica todos os IPs retornados
  try {
    const addresses = await dns.lookup(host, { all: true });
    for (const a of addresses) {
      if (a.family === 4 && isPrivateIPv4(a.address)) throw new Error('Host resolve para IP privado');
      if (a.family === 6 && isPrivateIPv6(a.address)) throw new Error('Host resolve para IP privado');
    }
  } catch (err) {
    throw new Error(err.message === 'Host resolve para IP privado' ? err.message : 'DNS não resolveu o host');
  }
}

/**
 * Dispara webhooks ativos para um evento específico.
 * event: 'schedule_changed' | 'pre_event'
 * data: objeto com dados do evento
 */
async function triggerWebhook(event, data) {
  const db = getDB();
  const webhooks = db.prepare(`
    SELECT * FROM webhooks WHERE active = 1 AND events LIKE ?
  `).all(`%${event}%`);

  for (const webhook of webhooks) {
    try {
      const events = JSON.parse(webhook.events || '[]');
      if (!events.includes(event)) continue;

      // SSRF: valida destino antes de disparar
      try { await assertSafeWebhookUrl(webhook.url); }
      catch (ssrfErr) {
        console.error(`[Webhook] ${webhook.url} recusado: ${ssrfErr.message}`);
        try {
          db.prepare('INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload, status, response_code) VALUES (?, ?, ?, ?, ?, ?)').run(
            uuidv4(), webhook.id, event, JSON.stringify({ error: ssrfErr.message }), 'blocked', 0
          );
        } catch (_) {}
        continue;
      }

      const payload = {
        event,
        timestamp: new Date().toISOString(),
        data,
      };

      const headers = { 'Content-Type': 'application/json', 'User-Agent': 'escala-suporte/2.0 webhook' };
      if (webhook.secret) {
        const sig = crypto.createHmac('sha256', webhook.secret)
          .update(JSON.stringify(payload))
          .digest('hex');
        headers['X-Escala-Signature'] = `sha256=${sig}`;
      }

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        redirect: 'manual', // evita SSRF por redirecionamento para URL interna
        signal: AbortSignal.timeout(10000),
      });

      db.prepare('INSERT INTO webhook_deliveries (id, webhook_id, event_type, target_date, payload, status, response_code) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        uuidv4(), webhook.id, event,
        data.date || data.event_date || null,
        JSON.stringify(payload),
        response.ok ? 'success' : 'failed',
        response.status
      );
    } catch (err) {
      console.error(`[Webhook] Falha ao chamar ${webhook.url}:`, err.message);
      try {
        db.prepare('INSERT INTO webhook_deliveries (id, webhook_id, event_type, payload, status, response_code) VALUES (?, ?, ?, ?, ?, ?)').run(
          uuidv4(), webhook.id, event, JSON.stringify(data), 'failed', 0
        );
      } catch (_) {}
    }
  }
}

/**
 * Verifica e dispara notificações pre_event agendadas.
 * Chamado a cada minuto pelo cron.
 */
async function checkPreEventNotifications() {
  const db = getDB();
  const now = new Date();
  const HH = String(now.getHours()).padStart(2, '0');
  const MM = String(now.getMinutes()).padStart(2, '0');
  const currentTime = `${HH}:${MM}`;

  const webhooks = db.prepare(`
    SELECT * FROM webhooks WHERE active = 1 AND events LIKE '%pre_event%' AND notify_time = ?
  `).all(currentTime);

  if (webhooks.length === 0) return;

  // Busca feriados e domingos dos próximos dias
  const holidays = db.prepare('SELECT date FROM holidays').all().map(h => h.date);

  for (const webhook of webhooks) {
    const daysAhead = webhook.days_before || 1;
    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + daysAhead);
    const targetStr = dStr(targetDate);

    // Verifica se é dia especial (domingo ou feriado)
    const isDomingo = targetDate.getDay() === 0;
    const isFeriado = holidays.includes(targetStr);
    if (!isDomingo && !isFeriado) continue;

    // Verifica se já foi enviado hoje para esta data
    const todayStr = dStr(now);
    const alreadySent = db.prepare(`
      SELECT id FROM webhook_deliveries
      WHERE webhook_id = ? AND event_type = 'pre_event' AND target_date = ? AND delivered_at LIKE ?
    `).get(webhook.id, targetStr, `${todayStr}%`);
    if (alreadySent) continue;

    // Monta payload com a escala do dia
    const schedule = buildDaySchedule(targetStr);
    const holidayInfo = db.prepare('SELECT * FROM holidays WHERE date = ?').get(targetStr);

    await triggerWebhook('pre_event', {
      event_date: targetStr,
      event_type: isDomingo ? 'sunday' : 'holiday',
      event_name: holidayInfo ? holidayInfo.label : 'Domingo',
      days_before: daysAhead,
      schedule,
    });
  }
}

/**
 * Monta a escala de um dia específico a partir dos overrides e dados do banco.
 * Retorna um objeto legível: { "Turno Manhã": "João", ... }
 */
function buildDaySchedule(dateStr) {
  const db = getDB();
  const overrides = db.prepare('SELECT shift_id, member_id FROM overrides WHERE date = ?').all(dateStr);
  const result = {};
  for (const o of overrides) {
    const shift = db.prepare('SELECT label FROM shifts WHERE id = ?').get(o.shift_id);
    const member = o.member_id ? db.prepare('SELECT name FROM team_members WHERE id = ?').get(o.member_id) : null;
    if (shift) result[shift.label] = member ? member.name : '(vago)';
  }
  return result;
}

function dStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

module.exports = { triggerWebhook, checkPreEventNotifications, assertSafeWebhookUrl };
