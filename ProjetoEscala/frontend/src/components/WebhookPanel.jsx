import { useState } from 'react';
import Modal from './Modal';
import Badge from './Badge';
import api from '../api';

const EVENT_LABELS = {
  schedule_changed: '📋 Alteração de escala',
  pre_event: '🔔 Aviso pré-evento',
};

export default function WebhookPanel({ webhooks, onUpdate }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({
    name: '', url: '', secret: '',
    events: ['schedule_changed'],
    notify_time: '08:00', days_before: 1,
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deliveries, setDeliveries] = useState({ webhookId: null, data: [] });
  const [testing, setTesting] = useState(null);
  const [testResult, setTestResult] = useState('');

  const openCreate = () => {
    setForm({ name: '', url: '', secret: '', events: ['schedule_changed'], notify_time: '08:00', days_before: 1 });
    setError(''); setEditing(null); setShowForm(true);
  };

  const openEdit = (wh) => {
    setForm({
      name: wh.name, url: wh.url, secret: wh.secret || '',
      events: wh.events || ['schedule_changed'],
      notify_time: wh.notify_time || '08:00',
      days_before: wh.days_before ?? 1,
    });
    setError(''); setEditing(wh); setShowForm(true);
  };

  const toggleEvent = (evt) => {
    setForm(f => ({
      ...f,
      events: f.events.includes(evt) ? f.events.filter(e => e !== evt) : [...f.events, evt],
    }));
  };

  const handleSave = async () => {
    if (!form.name || !form.url) { setError('Nome e URL são obrigatórios'); return; }
    if (form.events.length === 0) { setError('Selecione pelo menos um evento'); return; }
    setSaving(true); setError('');
    try {
      const payload = { ...form, secret: form.secret || null };
      if (editing) {
        const updated = await api.updateWebhook(editing.id, payload);
        onUpdate(webhooks.map(w => w.id === editing.id ? updated : w));
      } else {
        const created = await api.createWebhook(payload);
        onUpdate([...webhooks, created]);
      }
      setShowForm(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remover este webhook?')) return;
    try {
      await api.deleteWebhook(id);
      onUpdate(webhooks.filter(w => w.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleToggle = async (wh) => {
    try {
      const updated = await api.updateWebhook(wh.id, { active: !wh.active });
      onUpdate(webhooks.map(w => w.id === wh.id ? updated : w));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleTest = async (wh) => {
    setTesting(wh.id); setTestResult('');
    try {
      const result = await api.testWebhook(wh.id);
      const nxt = result?.next_event;
      const label = nxt
        ? `${nxt.is_sunday ? 'Domingo' : 'Feriado'} — ${nxt.date}${nxt.holiday_name ? ` (${nxt.holiday_name})` : ''}`
        : '';
      setTestResult(`✅ Teste POST enviado com dados do próximo plantão${label ? `: ${label}` : ''}`);
    } catch (err) {
      setTestResult(`❌ Erro: ${err.message}`);
    } finally {
      setTesting(null);
      setTimeout(() => setTestResult(''), 6000);
    }
  };

  const loadDeliveries = async (wh) => {
    try {
      const data = await api.getWebhookDeliveries(wh.id);
      setDeliveries({ webhookId: wh.id, data });
    } catch (err) {
      setError(err.message);
    }
  };

  const inputStyle = {
    width: '100%', padding: '10px 14px', borderRadius: 10,
    border: '1px solid var(--border)', background: 'var(--input-bg)',
    color: 'var(--text)', fontSize: 14, outline: 'none', marginBottom: 12,
  };

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, marginTop: 0 }}>
        Configure webhooks para receber notificações quando a escala for alterada ou antes de domingos/feriados. Todas as chamadas são feitas via <strong style={{ color: 'var(--text)' }}>HTTP POST</strong> com <code style={{ background: 'var(--cell-bg)', padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>Content-Type: application/json</code>.
      </p>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#ef444420', border: '1px solid #ef444440', color: '#ef4444', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {testResult && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#E11D4820', border: '1px solid #E11D4840', color: 'var(--text)', fontSize: 13, marginBottom: 12 }}>
          {testResult}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button onClick={openCreate} style={{
          padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
          fontWeight: 600, fontSize: 13, background: 'var(--accent)', color: '#fff'
        }}>+ Novo webhook</button>
      </div>

      {/* Dica de eventos */}
      <div style={{ padding: '12px 16px', borderRadius: 10, background: '#E11D4810', border: '1px solid #E11D4830', marginBottom: 16, fontSize: 12, color: 'var(--text-muted)' }}>
        <strong style={{ color: 'var(--text)' }}>Tipos de evento:</strong>{' '}
        <strong>schedule_changed</strong> — dispara imediatamente quando uma escala é editada manualmente. {' '}
        <strong>pre_event</strong> — dispara automaticamente no horário configurado X dias antes de cada domingo/feriado.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {webhooks.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>Nenhum webhook configurado</p>
        )}
        {webhooks.map(wh => (
          <div key={wh.id} style={{ borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', flexWrap: 'wrap' }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                background: wh.active ? '#22c55e' : '#ef4444',
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{wh.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{wh.url}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {wh.events.map(e => (
                  <Badge key={e} color={e === 'pre_event' ? '#f59e0b' : '#E11D48'}>{EVENT_LABELS[e]}</Badge>
                ))}
                {wh.events.includes('pre_event') && (
                  <Badge color="#94a3b8">{wh.days_before}d antes · {wh.notify_time}</Badge>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => handleToggle(wh)} style={{
                  background: 'none', border: '1px solid var(--border)', borderRadius: 8,
                  cursor: 'pointer', padding: '4px 8px', fontSize: 11, color: 'var(--text-muted)'
                }}>{wh.active ? 'Desativar' : 'Ativar'}</button>
                <button onClick={() => handleTest(wh)} disabled={testing === wh.id}
                  title="Envia um POST de teste com os dados do próximo domingo/feriado"
                  style={{
                    background: '#22c55e15', border: '1px solid #22c55e40', borderRadius: 8,
                    cursor: 'pointer', padding: '4px 10px', fontSize: 11, color: '#22c55e', fontWeight: 600,
                  }}>{testing === wh.id ? '...' : '▶ Testar'}</button>
                <button onClick={() => loadDeliveries(wh)} style={{
                  background: 'none', border: '1px solid var(--border)', borderRadius: 8,
                  cursor: 'pointer', padding: '4px 8px', fontSize: 11, color: 'var(--text-muted)'
                }}>Histórico</button>
                <button onClick={() => openEdit(wh)} style={{
                  background: 'none', border: '1px solid var(--border)', borderRadius: 8,
                  cursor: 'pointer', padding: '4px 8px', fontSize: 11, color: 'var(--text-muted)'
                }}>✏️</button>
                <button onClick={() => handleDelete(wh.id)} style={{
                  background: 'none', border: '1px solid #ef444440', borderRadius: 8,
                  cursor: 'pointer', padding: '4px 8px', fontSize: 11, color: '#ef4444'
                }}>✕</button>
              </div>
            </div>

            {/* Histórico de entregas */}
            {deliveries.webhookId === wh.id && deliveries.data.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border)', padding: '10px 16px', background: 'var(--cell-bg)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>Últimas entregas:</div>
                {deliveries.data.slice(0, 8).map(d => (
                  <div key={d.id} style={{ display: 'flex', gap: 10, fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                    <span style={{ color: d.status === 'success' ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                      {d.status === 'success' ? '✓' : '✗'} {d.response_code || 'ERR'}
                    </span>
                    <span>{d.event_type}</span>
                    {d.target_date && <span>· {d.target_date}</span>}
                    <span style={{ marginLeft: 'auto' }}>{d.delivered_at?.slice(0, 16).replace('T', ' ')}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Modal criar/editar */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title={editing ? 'Editar webhook' : 'Novo webhook'}>
        <div>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Nome</label>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
            placeholder="Ex: Notificações Slack" style={inputStyle}
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'}
          />

          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
            URL do webhook * <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 700, marginLeft: 6, padding: '1px 6px', borderRadius: 4, background: '#22c55e20' }}>POST</span>
          </label>
          <input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })}
            placeholder="https://... (receberá requisição POST com JSON)" style={inputStyle}
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'}
          />
          <div style={{ marginTop: -6, marginBottom: 12, fontSize: 11, color: 'var(--text-muted)' }}>
            💡 O destino deve aceitar <strong style={{ color: 'var(--text)' }}>HTTP POST</strong> com <code style={{ background: 'var(--cell-bg)', padding: '1px 5px', borderRadius: 3 }}>Content-Type: application/json</code>. Se informar um <em>secret</em>, a requisição vem com o header <code style={{ background: 'var(--cell-bg)', padding: '1px 5px', borderRadius: 3 }}>X-Escala-Signature: sha256=…</code>.
          </div>

          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Secret (opcional — para validar assinatura)</label>
          <input value={form.secret} onChange={e => setForm({ ...form, secret: e.target.value })}
            placeholder="Deixe em branco para não usar" style={inputStyle}
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'}
          />

          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Eventos *</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {Object.entries(EVENT_LABELS).map(([evt, lbl]) => (
              <label key={evt} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, padding: '6px 12px', borderRadius: 8, border: `1px solid ${form.events.includes(evt) ? 'var(--accent)' : 'var(--border)'}`, background: form.events.includes(evt) ? '#E11D4820' : 'transparent' }}>
                <input type="checkbox" checked={form.events.includes(evt)} onChange={() => toggleEvent(evt)} style={{ margin: 0 }} />
                {lbl}
              </label>
            ))}
          </div>

          {form.events.includes('pre_event') && (
            <div style={{ padding: '12px 14px', borderRadius: 10, background: '#f59e0b10', border: '1px solid #f59e0b30', marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Configuração do aviso pré-evento:</div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Dias antes</label>
                  <select value={form.days_before} onChange={e => setForm({ ...form, days_before: Number(e.target.value) })}
                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)', fontSize: 13 }}>
                    <option value={1}>1 dia antes</option>
                    <option value={2}>2 dias antes</option>
                    <option value={0}>No mesmo dia</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Horário</label>
                  <input type="time" value={form.notify_time} onChange={e => setForm({ ...form, notify_time: e.target.value })}
                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)', fontSize: 13 }}
                  />
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', paddingTop: 16 }}>
                  Ex: às {form.notify_time} de {form.days_before === 0 ? 'cada domingo/feriado' : form.days_before === 1 ? 'cada sábado/véspera' : `${form.days_before} dias antes`}
                </div>
              </div>
            </div>
          )}

          {error && (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: '#ef444420', color: '#ef4444', fontSize: 13, marginBottom: 12 }}>{error}</div>
          )}

          <button onClick={handleSave} disabled={saving} style={{
            width: '100%', padding: '12px', borderRadius: 10, border: 'none', cursor: 'pointer',
            fontWeight: 700, fontSize: 14, background: 'var(--accent)', color: '#fff'
          }}>{saving ? 'Salvando...' : editing ? 'Salvar alterações' : 'Criar webhook'}</button>
        </div>
      </Modal>
    </div>
  );
}
