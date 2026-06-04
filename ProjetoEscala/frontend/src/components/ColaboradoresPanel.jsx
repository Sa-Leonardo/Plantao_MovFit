import { useState } from 'react';
import Badge from './Badge';
import api from '../api';

// ── Constantes ──────────────────────────────────────────────────────────────

const WEEK_DAYS = [
  { val: 1, label: 'Seg' }, { val: 2, label: 'Ter' }, { val: 3, label: 'Qua' },
  { val: 4, label: 'Qui' }, { val: 5, label: 'Sex' }, { val: 6, label: 'Sáb' }, { val: 0, label: 'Dom' },
];

const ROTATION_PRESETS = [
  { label: '1 × 1', work: 1, rest: 1, desc: 'Trabalha 1 dia, folga 1' },
  { label: '1 × 2', work: 1, rest: 2, desc: 'Trabalha 1 dia, folga 2' },
  { label: '1 × 3', work: 1, rest: 3, desc: 'Trabalha 1 dia, folga 3' },
  { label: '2 × 2', work: 2, rest: 2, desc: 'Trabalha 2 dias, folga 2' },
  { label: '3 × 3', work: 3, rest: 3, desc: 'Trabalha 3 dias, folga 3' },
];

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Calcula se um trabalhador rotativo está de plantão em determinada data
export function isRotatingWorkDay(dateStr, anchorStr, workDays, restDays) {
  if (!anchorStr || !dateStr) return false;
  const d = new Date(dateStr + 'T00:00:00');
  const a = new Date(anchorStr + 'T00:00:00');
  const diffDays = Math.round((d - a) / 86400000);
  const cycleLen = workDays + restDays;
  const pos = ((diffDays % cycleLen) + cycleLen) % cycleLen;
  return pos < workDays;
}

// ── Componentes auxiliares ───────────────────────────────────────────────────

const inputStyle = {
  padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)',
  background: 'var(--input-bg)', color: 'var(--text)', fontSize: 14, outline: 'none',
};

function DayToggle({ days, onChange, disabled }) {
  const toggle = (val) => {
    if (disabled) return;
    const next = days.includes(val) ? days.filter(d => d !== val) : [...days, val];
    onChange(next);
  };
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {WEEK_DAYS.map(d => {
        const active = days.includes(d.val);
        return (
          <button key={d.val} type="button" onClick={() => toggle(d.val)} disabled={disabled} style={{
            padding: '5px 8px', borderRadius: 7, border: 'none', cursor: disabled ? 'default' : 'pointer',
            fontSize: 11, fontWeight: 700, transition: 'all 0.15s',
            background: active ? 'var(--accent)' : 'var(--border)',
            color: active ? '#fff' : 'var(--text-muted)', opacity: disabled ? 0.6 : 1,
          }}>{d.label}</button>
        );
      })}
    </div>
  );
}

function DayBadges({ days }) {
  if (!days || days.length === 0) return <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Sem dias definidos</span>;
  return (
    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
      {WEEK_DAYS.filter(d => days.includes(d.val)).map(d => (
        <span key={d.val} style={{
          padding: '2px 6px', borderRadius: 5, fontSize: 10, fontWeight: 700,
          background: '#E11D4820', color: 'var(--accent)', border: '1px solid #E11D4830',
        }}>{d.label}</span>
      ))}
    </div>
  );
}

function RotationPresets({ workDays, restDays, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {ROTATION_PRESETS.map(p => {
        const active = workDays === p.work && restDays === p.rest;
        return (
          <button key={p.label} type="button" onClick={() => onChange(p.work, p.rest)}
            title={p.desc}
            style={{
              padding: '5px 12px', borderRadius: 8, border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
              cursor: 'pointer', fontSize: 12, fontWeight: 700, transition: 'all 0.15s',
              background: active ? 'var(--accent)' : 'transparent',
              color: active ? '#fff' : 'var(--text-muted)',
            }}>{p.label}</button>
        );
      })}
      <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>ou customize:</span>
    </div>
  );
}

function RotatingStatusBadge({ c, dateStr }) {
  if (c.schedule_type !== 'rotating' || !c.rotation_anchor) return null;
  const working = isRotatingWorkDay(dateStr, c.rotation_anchor, c.rotation_work_days, c.rotation_rest_days);
  const cycleLen = c.rotation_work_days + c.rotation_rest_days;
  const diffDays = Math.round((new Date(dateStr + 'T00:00:00') - new Date(c.rotation_anchor + 'T00:00:00')) / 86400000);
  const pos = ((diffDays % cycleLen) + cycleLen) % cycleLen;
  const label = working
    ? `Dia ${pos + 1} de trabalho`
    : `Folga (volta em ${cycleLen - pos} dia${(cycleLen - pos) !== 1 ? 's' : ''})`;
  return (
    <span style={{
      padding: '2px 7px', borderRadius: 6, fontSize: 10, fontWeight: 700,
      background: working ? '#22c55e20' : '#94a3b820',
      color: working ? '#22c55e' : '#94a3b8',
      border: `1px solid ${working ? '#22c55e30' : '#94a3b830'}`,
      whiteSpace: 'nowrap',
    }}>{working ? '🟢' : '🔴'} {label}</span>
  );
}

// ── Formulário de adição ─────────────────────────────────────────────────────

const EMPTY_FORM = {
  name: '', schedule_type: 'fixed',
  work_days: [1, 2, 3, 4, 5], work_start: '08:00', work_end: '17:00',
  rotation_work_days: 1, rotation_rest_days: 2, rotation_anchor: todayStr(),
};

// ── Painel principal ─────────────────────────────────────────────────────────

export default function ColaboradoresPanel({ colaboradores, onUpdate, isAdmin }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const today = todayStr();

  const handleAdd = async () => {
    if (!form.name.trim()) { setError('Informe o nome do colaborador'); return; }
    if (form.schedule_type === 'rotating' && !form.rotation_anchor) { setError('Informe a data de referência'); return; }
    setSaving(true); setError('');
    try {
      const created = await api.createColaborador({
        name: form.name.trim(),
        schedule_type: form.schedule_type,
        work_days: form.work_days,
        work_start: form.work_start,
        work_end: form.work_end,
        rotation_work_days: form.rotation_work_days,
        rotation_rest_days: form.rotation_rest_days,
        rotation_anchor: form.rotation_anchor,
      });
      onUpdate([...colaboradores, created]);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (c) => {
    setEditingId(c.id);
    setEditForm({
      name: c.name, schedule_type: c.schedule_type || 'fixed',
      work_days: c.work_days || [], work_start: c.work_start || '', work_end: c.work_end || '',
      rotation_work_days: c.rotation_work_days || 1, rotation_rest_days: c.rotation_rest_days || 2,
      rotation_anchor: c.rotation_anchor || todayStr(), active: c.active,
    });
    setError('');
  };

  const handleSaveEdit = async () => {
    if (!editForm.name.trim()) { setError('Nome é obrigatório'); return; }
    setSaving(true); setError('');
    try {
      const updated = await api.updateColaborador(editingId, editForm);
      onUpdate(colaboradores.map(c => c.id === editingId ? updated : c));
      setEditingId(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (c) => {
    try {
      const updated = await api.updateColaborador(c.id, { active: !c.active });
      onUpdate(colaboradores.map(x => x.id === c.id ? updated : x));
    } catch (err) { setError(err.message); }
  };

  const handleRemove = async (c) => {
    if (!window.confirm(`Remover "${c.name}" do cadastro?`)) return;
    try {
      await api.deleteColaborador(c.id);
      onUpdate(colaboradores.filter(x => x.id !== c.id));
    } catch (err) { setError(err.message); }
  };

  const sorted = [...colaboradores].sort((a, b) => a.name.localeCompare(b.name));
  const activeList = sorted.filter(c => c.active);
  const inactiveList = sorted.filter(c => !c.active);

  return (
    <div>
      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#ef444420', border: '1px solid #ef444440', color: '#ef4444', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ padding: '12px 16px', borderRadius: 10, background: '#E11D4810', border: '1px solid #E11D4830', marginBottom: 20, fontSize: 13, color: 'var(--text-muted)' }}>
        ℹ️ Cadastre aqui <strong style={{ color: 'var(--text)' }}>todos os colaboradores</strong> com seus horários. Trabalhadores com <strong style={{ color: 'var(--text)' }}>escala rotativa</strong> (madrugada, 1x2, etc.) têm ciclo calculado automaticamente.
      </div>

      {isAdmin && (
        <div style={{ padding: '16px 20px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', marginBottom: 20 }}>
          <h4 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Adicionar colaborador</h4>

          {/* Tipo de escala */}
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Tipo de escala</label>
            <div style={{ display: 'flex', gap: 0, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', width: 'fit-content' }}>
              {[
                { val: 'fixed', label: '📅 Dias fixos', desc: 'Seg–Sex, Seg–Sáb etc.' },
                { val: 'rotating', label: '🔄 Rotativo', desc: 'Trabalha X dias, folga Y dias' },
              ].map(opt => (
                <button key={opt.val} type="button" onClick={() => setForm({ ...form, schedule_type: opt.val })}
                  title={opt.desc}
                  style={{
                    padding: '8px 16px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                    background: form.schedule_type === opt.val ? 'var(--accent)' : 'var(--input-bg)',
                    color: form.schedule_type === opt.val ? '#fff' : 'var(--text-muted)',
                  }}>{opt.label}</button>
              ))}
            </div>
          </div>

          {/* Nome e horário */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Nome *</label>
              <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="Ex: Gabriel Santos" style={{ ...inputStyle, width: '100%' }}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Entrada</label>
              <input type="time" value={form.work_start} onChange={e => setForm({ ...form, work_start: e.target.value })}
                style={{ ...inputStyle, width: 110 }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Saída</label>
              <input type="time" value={form.work_end} onChange={e => setForm({ ...form, work_end: e.target.value })}
                style={{ ...inputStyle, width: 110 }} />
            </div>
          </div>

          {/* Dias fixos */}
          {form.schedule_type === 'fixed' && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Dias de trabalho</label>
              <DayToggle days={form.work_days} onChange={days => setForm({ ...form, work_days: days })} />
            </div>
          )}

          {/* Rotativo */}
          {form.schedule_type === 'rotating' && (
            <div style={{ padding: '14px 16px', borderRadius: 10, background: '#f59e0b10', border: '1px solid #f59e0b25', marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b', marginBottom: 10 }}>🔄 Configuração do ciclo rotativo</div>

              <div style={{ marginBottom: 10 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>Ciclo (atalhos)</label>
                <RotationPresets workDays={form.rotation_work_days} restDays={form.rotation_rest_days}
                  onChange={(w, r) => setForm({ ...form, rotation_work_days: w, rotation_rest_days: r })} />
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Dias trabalhando</label>
                  <input type="number" min={1} max={10} value={form.rotation_work_days}
                    onChange={e => setForm({ ...form, rotation_work_days: Number(e.target.value) })}
                    style={{ ...inputStyle, width: 80, textAlign: 'center' }} />
                </div>
                <span style={{ fontSize: 16, color: 'var(--text-muted)', paddingBottom: 10 }}>×</span>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Dias de folga</label>
                  <input type="number" min={1} max={10} value={form.rotation_rest_days}
                    onChange={e => setForm({ ...form, rotation_rest_days: Number(e.target.value) })}
                    style={{ ...inputStyle, width: 80, textAlign: 'center' }} />
                </div>
                <div style={{ paddingBottom: 2 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Ciclo de <strong style={{ color: 'var(--text)' }}>{form.rotation_work_days + form.rotation_rest_days} dias</strong>
                  </span>
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                  📍 Data de referência <span style={{ fontStyle: 'italic' }}>(dia em que ele <strong>começa</strong> a trabalhar)</span>
                </label>
                <input type="date" value={form.rotation_anchor}
                  onChange={e => setForm({ ...form, rotation_anchor: e.target.value })}
                  style={{ ...inputStyle, width: 180 }} />
                {form.rotation_anchor && (
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)', background: 'var(--input-bg)', padding: '8px 12px', borderRadius: 8 }}>
                    {previewRotation(form.rotation_anchor, form.rotation_work_days, form.rotation_rest_days)}
                  </div>
                )}
              </div>
            </div>
          )}

          <button onClick={handleAdd} disabled={saving || !form.name.trim()} style={{
            padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
            fontWeight: 600, fontSize: 14, background: 'var(--accent)', color: '#fff',
            opacity: !form.name.trim() ? 0.5 : 1,
          }}>+ Adicionar colaborador</button>
        </div>
      )}

      {/* Lista: Ativos */}
      {activeList.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionDivider label={`ATIVOS (${activeList.length})`} color="#22c55e" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {activeList.map(c => (
              <ColaboradorRow key={c.id} c={c} today={today} isAdmin={isAdmin}
                editingId={editingId} editForm={editForm} setEditForm={setEditForm} saving={saving}
                onEdit={() => startEdit(c)} onSaveEdit={handleSaveEdit} onCancelEdit={() => setEditingId(null)}
                onToggleActive={() => handleToggleActive(c)} onRemove={() => handleRemove(c)} />
            ))}
          </div>
        </div>
      )}

      {/* Lista: Inativos */}
      {inactiveList.length > 0 && (
        <div>
          <SectionDivider label={`INATIVOS (${inactiveList.length})`} color="#94a3b8" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {inactiveList.map(c => (
              <ColaboradorRow key={c.id} c={c} today={today} isAdmin={isAdmin}
                editingId={editingId} editForm={editForm} setEditForm={setEditForm} saving={saving}
                onEdit={() => startEdit(c)} onSaveEdit={handleSaveEdit} onCancelEdit={() => setEditingId(null)}
                onToggleActive={() => handleToggleActive(c)} onRemove={() => handleRemove(c)} />
            ))}
          </div>
        </div>
      )}

      {colaboradores.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 30 }}>Nenhum colaborador cadastrado</p>
      )}
    </div>
  );
}

// ── Sub-componentes ──────────────────────────────────────────────────────────

function SectionDivider({ label, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <div style={{ height: 1, flex: 1, background: 'var(--border)' }} />
      <span style={{ fontSize: 12, fontWeight: 700, color, letterSpacing: 0.5, whiteSpace: 'nowrap' }}>{label}</span>
      <div style={{ height: 1, flex: 1, background: 'var(--border)' }} />
    </div>
  );
}

function ColaboradorRow({ c, today, isAdmin, editingId, editForm, setEditForm, saving, onEdit, onSaveEdit, onCancelEdit, onToggleActive, onRemove }) {
  const isEditing = editingId === c.id;
  const isRotating = c.schedule_type === 'rotating';

  return (
    <div style={{
      borderRadius: 10, background: c.active ? 'var(--row-bg)' : 'var(--row-inactive)',
      border: '1px solid var(--border)', overflow: 'hidden',
    }}>
      {isEditing ? (
        <EditForm editForm={editForm} setEditForm={setEditForm} saving={saving}
          onSave={onSaveEdit} onCancel={onCancelEdit} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
          <div style={{
            width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 14, color: '#fff',
            background: c.active ? `hsl(${c.name.charCodeAt(0) * 7 % 360}, 55%, 50%)` : 'var(--text-muted)',
          }}>{c.name.charAt(0).toUpperCase()}</div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span style={{
                fontWeight: 600, fontSize: 14,
                color: c.active ? 'var(--text)' : 'var(--text-muted)',
                textDecoration: c.active ? 'none' : 'line-through',
              }}>{c.name}</span>
              {isRotating && (
                <span style={{
                  padding: '1px 7px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                  background: '#f59e0b20', color: '#f59e0b', border: '1px solid #f59e0b30',
                }}>🔄 {c.rotation_work_days}×{c.rotation_rest_days}</span>
              )}
              <RotatingStatusBadge c={c} dateStr={today} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
              {isRotating ? (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Ciclo de {c.rotation_work_days + c.rotation_rest_days} dias · ref. {formatDate(c.rotation_anchor)}
                  {(c.work_start || c.work_end) && ` · 🕐 ${c.work_start}–${c.work_end}`}
                </span>
              ) : (
                <>
                  <DayBadges days={c.work_days} />
                  {(c.work_start || c.work_end) && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>🕐 {c.work_start}{c.work_end ? `–${c.work_end}` : ''}</span>
                  )}
                </>
              )}
            </div>
          </div>

          <Badge color={c.active ? '#22c55e' : '#94a3b8'}>{c.active ? 'Ativo' : 'Inativo'}</Badge>

          {isAdmin && (
            <>
              <button onClick={onEdit} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', padding: '5px 10px', fontSize: 12, color: 'var(--text-muted)' }}>✏️</button>
              <button onClick={onToggleActive} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', padding: '5px 10px', fontSize: 12, color: 'var(--text-muted)' }}>{c.active ? 'Desativar' : 'Ativar'}</button>
              <button onClick={onRemove} style={{ background: 'none', border: '1px solid #ef444440', borderRadius: 8, cursor: 'pointer', padding: '5px 10px', fontSize: 12, color: '#ef4444' }}>✕</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function EditForm({ editForm, setEditForm, saving, onSave, onCancel }) {
  const isRotating = editForm.schedule_type === 'rotating';
  return (
    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Tipo */}
      <div style={{ display: 'flex', gap: 0, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)', width: 'fit-content' }}>
        {[{ val: 'fixed', label: '📅 Dias fixos' }, { val: 'rotating', label: '🔄 Rotativo' }].map(opt => (
          <button key={opt.val} type="button" onClick={() => setEditForm({ ...editForm, schedule_type: opt.val })} style={{
            padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
            background: editForm.schedule_type === opt.val ? 'var(--accent)' : 'var(--input-bg)',
            color: editForm.schedule_type === opt.val ? '#fff' : 'var(--text-muted)',
          }}>{opt.label}</button>
        ))}
      </div>

      {/* Nome e horário */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: 130 }}>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Nome</label>
          <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })}
            style={{ ...inputStyle, width: '100%' }}
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'}
          />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Entrada</label>
          <input type="time" value={editForm.work_start || ''} onChange={e => setEditForm({ ...editForm, work_start: e.target.value })}
            style={{ ...inputStyle, width: 110 }} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Saída</label>
          <input type="time" value={editForm.work_end || ''} onChange={e => setEditForm({ ...editForm, work_end: e.target.value })}
            style={{ ...inputStyle, width: 110 }} />
        </div>
      </div>

      {/* Fixo: dias da semana */}
      {!isRotating && (
        <div>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Dias de trabalho</label>
          <DayToggle days={editForm.work_days || []} onChange={days => setEditForm({ ...editForm, work_days: days })} />
        </div>
      )}

      {/* Rotativo */}
      {isRotating && (
        <div style={{ padding: '12px 14px', borderRadius: 10, background: '#f59e0b10', border: '1px solid #f59e0b25' }}>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>Ciclo</label>
            <RotationPresets workDays={editForm.rotation_work_days || 1} restDays={editForm.rotation_rest_days || 2}
              onChange={(w, r) => setEditForm({ ...editForm, rotation_work_days: w, rotation_rest_days: r })} />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Trabalhando</label>
              <input type="number" min={1} max={10} value={editForm.rotation_work_days || 1}
                onChange={e => setEditForm({ ...editForm, rotation_work_days: Number(e.target.value) })}
                style={{ ...inputStyle, width: 70, textAlign: 'center' }} />
            </div>
            <span style={{ fontSize: 14, color: 'var(--text-muted)', paddingBottom: 10 }}>×</span>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Folga</label>
              <input type="number" min={1} max={10} value={editForm.rotation_rest_days || 2}
                onChange={e => setEditForm({ ...editForm, rotation_rest_days: Number(e.target.value) })}
                style={{ ...inputStyle, width: 70, textAlign: 'center' }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>📍 Data de referência</label>
              <input type="date" value={editForm.rotation_anchor || ''}
                onChange={e => setEditForm({ ...editForm, rotation_anchor: e.target.value })}
                style={{ ...inputStyle, width: 180 }} />
            </div>
          </div>
          {editForm.rotation_anchor && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
              {previewRotation(editForm.rotation_anchor, editForm.rotation_work_days || 1, editForm.rotation_rest_days || 2)}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={editForm.active} onChange={e => setEditForm({ ...editForm, active: e.target.checked })} />
          Ativo
        </label>
        <div style={{ flex: 1 }} />
        <button onClick={onSave} disabled={saving} style={{
          background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8,
          padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}>Salvar</button>
        <button onClick={onCancel} style={{
          background: 'none', border: '1px solid var(--border)', borderRadius: 8,
          padding: '8px 12px', fontSize: 13, cursor: 'pointer', color: 'var(--text-muted)',
        }}>Cancelar</button>
      </div>
    </div>
  );
}

// ── Utilitários ──────────────────────────────────────────────────────────────

function formatDate(str) {
  if (!str) return '—';
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

function previewRotation(anchor, workDays, restDays) {
  if (!anchor) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lines = [];
  for (let i = 0; i < workDays + restDays; i++) {
    const d = new Date(anchor + 'T00:00:00');
    d.setDate(d.getDate() + i);
    const ds = d.toISOString().slice(0, 10);
    const pos = i % (workDays + restDays);
    const isWork = pos < workDays;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const isToday = d.getTime() === today.getTime();
    lines.push(`${dd}/${mm}${isToday ? ' (hoje)' : ''} → ${isWork ? '🟢 Trabalhando' : '🔴 Folga'}`);
  }
  return `Prévia do ciclo (${workDays + restDays} dias): ${lines.join(' · ')}`;
}
