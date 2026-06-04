import { useState } from 'react';
import Badge from './Badge';
import api from '../api';

const EMPTY_FORM = { label: '', start_time: '', end_time: '', sunday_slots: 1, holiday_slots: 2 };

export default function ShiftPanel({ shifts, onUpdate, isAdmin }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const clampSlot = (v, fallback = 1) => {
    const n = parseInt(v, 10);
    if (Number.isNaN(n) || n < 1) return fallback;
    return Math.min(20, n);
  };

  const payloadFromForm = () => ({
    label: form.label,
    start_time: form.start_time,
    end_time: form.end_time,
    sunday_slots: clampSlot(form.sunday_slots, 1),
    holiday_slots: clampSlot(form.holiday_slots, 1),
    // Mantém coluna legada = maior valor, para retrocompatibilidade
    slots: Math.max(clampSlot(form.sunday_slots, 1), clampSlot(form.holiday_slots, 1)),
  });

  const handleAdd = async () => {
    if (!form.label || !form.start_time || !form.end_time) {
      setError('Preencha todos os campos');
      return;
    }
    setSaving(true); setError('');
    try {
      const created = await api.createShift(payloadFromForm());
      onUpdate([...shifts, created]);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (id) => {
    try {
      await api.deleteShift(id);
      onUpdate(shifts.filter(s => s.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleSaveEdit = async () => {
    if (!form.label || !form.start_time || !form.end_time) {
      setError('Preencha todos os campos');
      return;
    }
    setSaving(true); setError('');
    try {
      const updated = await api.updateShift(editing, payloadFromForm());
      onUpdate(shifts.map(s => s.id === editing ? updated : s));
      setEditing(null);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (s) => {
    setEditing(s.id);
    setForm({
      label: s.label,
      start_time: s.start_time,
      end_time: s.end_time,
      sunday_slots: s.sunday_slots != null ? s.sunday_slots : (s.slots || 1),
      holiday_slots: s.holiday_slots != null ? s.holiday_slots : (s.slots || 1),
    });
    setError('');
  };

  const inputSm = {
    padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)',
    background: 'var(--input-bg)', color: 'var(--text)', fontSize: 13, outline: 'none',
  };

  const inputLg = {
    padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)',
    background: 'var(--input-bg)', color: 'var(--text)', fontSize: 14, outline: 'none',
  };

  const slotsBadge = (label, n, color) => (
    <Badge color={color}>
      {label}: {n} {n === 1 ? 'vaga' : 'vagas'}
    </Badge>
  );

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, marginTop: 0 }}>
        Configure os turnos de plantão. Defina quantos colaboradores devem ser escalados em <strong>domingos</strong> e em <strong>feriados</strong> separadamente.
      </p>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#ef444420', border: '1px solid #ef444440', color: '#ef4444', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
        {shifts.length === 0 && (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: 13 }}>
            Nenhum turno cadastrado. Crie um turno abaixo.
          </div>
        )}
        {shifts.map(s => {
          const sSlots = s.sunday_slots != null ? s.sunday_slots : (s.slots || 1);
          const hSlots = s.holiday_slots != null ? s.holiday_slots : (s.slots || 1);
          return (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10,
              background: 'var(--row-bg)', border: '1px solid var(--border)', flexWrap: 'wrap'
            }}>
              {editing === s.id ? (
                <>
                  <input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })}
                    style={{ ...inputSm, flex: 1, minWidth: 100 }} placeholder="Nome" />
                  <input type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })}
                    style={inputSm} />
                  <span style={{ color: 'var(--text-muted)' }}>→</span>
                  <input type="time" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })}
                    style={inputSm} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <label title="Vagas em domingos" style={{ fontSize: 11, color: 'var(--sunday)', whiteSpace: 'nowrap', fontWeight: 600 }}>Dom</label>
                    <input type="number" min={1} max={20} value={form.sunday_slots}
                      onChange={e => setForm({ ...form, sunday_slots: e.target.value })}
                      style={{ ...inputSm, width: 52, textAlign: 'center' }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <label title="Vagas em feriados" style={{ fontSize: 11, color: 'var(--holiday-text)', whiteSpace: 'nowrap', fontWeight: 600 }}>Fer</label>
                    <input type="number" min={1} max={20} value={form.holiday_slots}
                      onChange={e => setForm({ ...form, holiday_slots: e.target.value })}
                      style={{ ...inputSm, width: 52, textAlign: 'center' }} />
                  </div>
                  <button onClick={handleSaveEdit} disabled={saving} style={{
                    background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8,
                    padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer'
                  }}>Salvar</button>
                  <button onClick={() => { setEditing(null); setForm(EMPTY_FORM); }} style={{
                    background: 'none', border: '1px solid var(--border)', borderRadius: 8,
                    padding: '6px 10px', fontSize: 12, cursor: 'pointer', color: 'var(--text-muted)'
                  }}>Cancelar</button>
                </>
              ) : (
                <>
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{s.label}</span>
                  <Badge color="var(--accent)">{s.start_time} → {s.end_time}</Badge>
                  {slotsBadge('Dom', sSlots, 'var(--sunday)')}
                  {slotsBadge('Fer', hSlots, 'var(--holiday-text)')}
                  {isAdmin && (
                    <>
                      <button onClick={() => startEdit(s)} style={{
                        background: 'none', border: '1px solid var(--border)', borderRadius: 8,
                        cursor: 'pointer', padding: '5px 10px', fontSize: 12, color: 'var(--text-muted)'
                      }}>Editar</button>
                      <button onClick={() => handleRemove(s.id)} style={{
                        background: 'none', border: '1px solid #ef444440', borderRadius: 8,
                        cursor: 'pointer', padding: '5px 10px', fontSize: 12, color: '#ef4444'
                      }}>✕</button>
                    </>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {isAdmin && editing === null && (
        <div style={{ padding: '16px 20px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)' }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Novo Turno</h4>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: 1, minWidth: 120 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Nome do turno</label>
              <input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })}
                placeholder="Ex: Manhã"
                style={{ ...inputLg, width: '100%' }}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Início</label>
              <input type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })}
                style={inputLg} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Fim</label>
              <input type="time" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })}
                style={inputLg} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--sunday)', marginBottom: 4, fontWeight: 600 }}>Vagas domingo</label>
              <input type="number" min={1} max={20} value={form.sunday_slots}
                onChange={e => setForm({ ...form, sunday_slots: e.target.value })}
                style={{ ...inputLg, width: 84, textAlign: 'center' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--holiday-text)', marginBottom: 4, fontWeight: 600 }}>Vagas feriado</label>
              <input type="number" min={1} max={20} value={form.holiday_slots}
                onChange={e => setForm({ ...form, holiday_slots: e.target.value })}
                style={{ ...inputLg, width: 84, textAlign: 'center' }}
              />
            </div>
            <button onClick={handleAdd} disabled={saving} style={{
              padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
              fontWeight: 600, fontSize: 14, background: 'var(--accent)', color: '#fff', whiteSpace: 'nowrap'
            }}>+ Turno</button>
          </div>
          <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
            💡 Define quantos colaboradores serão escalados automaticamente neste turno em <strong style={{ color: 'var(--sunday)' }}>domingos</strong> e em <strong style={{ color: 'var(--holiday-text)' }}>feriados</strong>. Valores podem ser diferentes (ex: 1 no domingo, 2 em feriados).
          </p>
        </div>
      )}
    </div>
  );
}
