import { useState } from 'react';
import api from '../api';
import Modal from './Modal';

const ABSENCE_TYPES = [
  { value: 'atestado', label: '🏥 Atestado médico' },
  { value: 'folga', label: '🌴 Folga' },
  { value: 'ferias', label: '✈️ Férias' },
  { value: 'ausencia', label: '❌ Ausência' },
  { value: 'outro', label: '📝 Outro' },
];

const MONTHS_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function parseDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isSundayStr(ds) {
  const [y, m, d] = ds.split('-').map(Number);
  return new Date(y, m - 1, d).getDay() === 0;
}
function enumerateRange(start, end) {
  const out = [];
  const [y1, m1, d1] = start.split('-').map(Number);
  const [y2, m2, d2] = end.split('-').map(Number);
  const a = new Date(y1, m1 - 1, d1);
  const b = new Date(y2, m2 - 1, d2);
  while (a <= b) {
    out.push(`${a.getFullYear()}-${String(a.getMonth() + 1).padStart(2, '0')}-${String(a.getDate()).padStart(2, '0')}`);
    a.setDate(a.getDate() + 1);
  }
  return out;
}

export default function AbsencePanel({
  absences, team, onUpdate, isAdmin,
  schedule = {}, shifts = [], overrides = {}, onOverridesUpdate,
  sundayCounts = {}, holidayCounts = {}, holidays = [],
}) {
  const now = new Date();
  const [form, setForm] = useState({
    member_id: '', date: '', end_date: '', reason: '', absence_type: 'atestado',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');
  const [conflicts, setConflicts] = useState(null); // { memberName, items: [...] }
  const [applying, setApplying] = useState(false);

  // Analisa a escala buscando dias em que o membro ausente está escalado.
  // Para cada conflito, sugere um substituto: menor contador (sunday ou holiday)
  // do mesmo turno, que esteja ativo, em rotação e não ausente naquele dia.
  const detectConflicts = (memberId) => {
    const member = team.find(t => t.id === memberId);
    if (!member) return [];
    const absentById = new Set();
    for (const a of absences) {
      if (a.member_id !== memberId) continue;
      for (const d of enumerateRange(a.date, a.end_date || a.date)) absentById.add(d);
    }
    const items = [];
    // Inclui a ausência recém-criada no escopo
    const scopeDates = enumerateRange(form.date, form.end_date || form.date);
    for (const ds of scopeDates) {
      const daySched = schedule[ds];
      if (!daySched) continue;
      for (const [shiftId, ids] of Object.entries(daySched)) {
        if (!Array.isArray(ids) || !ids.includes(memberId)) continue;
        const shift = shifts.find(s => s.id === shiftId);
        if (!shift) continue;

        // Candidatos do mesmo turno que podem substituir
        const alreadyScheduled = new Set(Object.values(daySched).flat());
        const sun = isSundayStr(ds);
        const counts = sun ? sundayCounts : holidayCounts;
        const candidates = team.filter(m =>
          m.active && m.in_rotation !== false &&
          m.shift && m.shift.id === shiftId &&
          m.id !== memberId &&
          !alreadyScheduled.has(m.id)
        ).sort((a, b) => (counts[a.id] || 0) - (counts[b.id] || 0) || a.name.localeCompare(b.name));
        const substitute = candidates[0] || null;

        items.push({
          date: ds,
          shiftId, shiftLabel: shift.label,
          absentMemberId: memberId,
          absentMemberName: member.name,
          substituteId: substitute?.id || null,
          substituteName: substitute?.name || null,
        });
      }
    }
    return items;
  };

  const handleAdd = async () => {
    if (!form.member_id || !form.date || !form.end_date) {
      setError('Selecione o atendente e preencha as duas datas (para um dia só, use a mesma em ambas)');
      return;
    }
    if (form.end_date < form.date) { setError('A data de fim não pode ser anterior à de início'); return; }
    setSaving(true); setError('');
    try {
      const created = await api.createAbsence(form);
      // Detecta conflitos ANTES de limpar o form (precisamos das datas)
      const items = detectConflicts(form.member_id);
      onUpdate([created, ...absences]);
      if (items.length > 0) {
        const memberName = team.find(t => t.id === form.member_id)?.name || '';
        setConflicts({ memberName, items });
      }
      setForm({ member_id: '', date: '', end_date: '', reason: '', absence_type: 'atestado' });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Aplica as substituições sugeridas criando/atualizando overrides
  const applySubstitutions = async () => {
    if (!conflicts) return;
    setApplying(true);
    try {
      // Agrupa por data — um PUT por data
      const byDate = {};
      for (const c of conflicts.items) {
        if (!byDate[c.date]) byDate[c.date] = {};
        byDate[c.date][c.shiftId] = c.substituteId || null;
      }

      const updatedOverrides = { ...overrides };
      for (const [date, changes] of Object.entries(byDate)) {
        // Monta o assignment completo do dia preservando os outros turnos existentes
        const daySched = schedule[date] || {};
        const assignments = {};
        for (const s of shifts) {
          const current = Array.isArray(daySched[s.id]) ? [...daySched[s.id]] : [];
          if (changes[s.id] !== undefined) {
            // Substitui o ausente pelo substituto em cada slot ocupado por ele
            const absentId = conflicts.items.find(c => c.shiftId === s.id && c.date === date)?.absentMemberId;
            const subId = changes[s.id];
            assignments[s.id] = current.map(id => id === absentId ? (subId || null) : id).filter(Boolean);
          } else {
            assignments[s.id] = current;
          }
        }
        await api.setOverride(date, assignments, `Substituição automática — ${conflicts.memberName} ausente`);
        updatedOverrides[date] = assignments;
      }
      onOverridesUpdate?.(updatedOverrides);
      setConflicts(null);
    } catch (err) {
      setError('Erro ao aplicar substituições: ' + err.message);
    } finally {
      setApplying(false);
    }
  };

  const handleRemove = async (absence) => {
    const d = parseDateStr(absence.date);
    const end = absence.end_date ? parseDateStr(absence.end_date) : null;
    const isRange = end && absence.end_date !== absence.date;
    const periodo = isRange
      ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} a ${String(end.getDate()).padStart(2, '0')}/${String(end.getMonth() + 1).padStart(2, '0')}`
      : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (!window.confirm(`Remover a ausência de "${absence.member_name}" (${periodo})?`)) return;
    try {
      await api.deleteAbsence(absence.id);
      onUpdate(absences.filter(a => a.id !== absence.id));
    } catch (err) {
      setError(err.message);
    }
  };

  const filtered = absences.filter(a =>
    !filter || a.member_name?.toLowerCase().includes(filter.toLowerCase())
  ).sort((a, b) => b.date.localeCompare(a.date));

  const typeLabel = (t) => ABSENCE_TYPES.find(x => x.value === t)?.label || t;

  const inputStyle = {
    padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)',
    background: 'var(--input-bg)', color: 'var(--text)', fontSize: 14, outline: 'none',
  };

  const anyMissingSubstitute = conflicts?.items?.some(c => !c.substituteId);

  return (
    <div>
      <Modal open={!!conflicts} onClose={() => setConflicts(null)}
        title={conflicts ? `Conflitos na escala — ${conflicts.memberName}` : ''}>
        <div>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-muted)' }}>
            {conflicts?.items.length} dia(s) com {conflicts?.memberName} já escalado(a). Substitutos sugeridos (menor contador):
          </p>
          <div style={{ maxHeight: 320, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {conflicts?.items.map((c, i) => {
              const d = parseDateStr(c.date);
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                  borderRadius: 8, background: 'var(--row-bg)', border: '1px solid var(--border)', fontSize: 13,
                }}>
                  <div style={{ minWidth: 60, color: 'var(--accent)', fontWeight: 700 }}>
                    {String(d.getDate()).padStart(2, '0')}/{String(d.getMonth() + 1).padStart(2, '0')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: 'var(--text)' }}>
                      <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)' }}>{c.absentMemberName}</span>
                      {' → '}
                      {c.substituteName ? (
                        <strong style={{ color: '#22c55e' }}>{c.substituteName}</strong>
                      ) : (
                        <span style={{ color: '#ef4444' }}>sem substituto elegível</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{c.shiftLabel}</div>
                  </div>
                </div>
              );
            })}
          </div>
          {anyMissingSubstitute && (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: '#f59e0b20', color: '#f59e0b', fontSize: 12, marginBottom: 10 }}>
              ⚠️ Alguns dias não têm substituto disponível. O slot ficará vago nesses dias — ajuste manualmente depois.
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setConflicts(null)} disabled={applying} style={{
              flex: 1, padding: '11px', borderRadius: 10, border: '1px solid var(--border)',
              background: 'var(--input-bg)', color: 'var(--text)', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}>Ignorar</button>
            <button onClick={applySubstitutions} disabled={applying} style={{
              flex: 2, padding: '11px', borderRadius: 10, border: 'none',
              background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 700,
            }}>{applying ? 'Aplicando...' : '✓ Aplicar substituições'}</button>
          </div>
        </div>
      </Modal>

      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16, marginTop: 0 }}>
        Registre ausências de atendentes em domingos/feriados. A escala se ajusta automaticamente
        — quem faltou terá prioridade nos próximos plantões.
      </p>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#ef444420', border: '1px solid #ef444440', color: '#ef4444', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {isAdmin && (
        <div style={{ padding: '16px 20px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', marginBottom: 20 }}>
          <h4 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Registrar ausência</h4>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 140px' }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Atendente *</label>
              <select value={form.member_id} onChange={e => setForm({ ...form, member_id: e.target.value })}
                style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}>
                <option value="">Selecionar</option>
                {team.map(m => <option key={m.id} value={m.id}>{m.name} ({m.shift?.label})</option>)}
              </select>
            </div>
            <div style={{ flex: '0 0 150px' }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Início *</label>
              <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })}
                style={{ ...inputStyle, width: '100%' }}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>
            <div style={{ flex: '0 0 150px' }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Fim *</label>
              <input type="date" value={form.end_date}
                min={form.date || undefined}
                onChange={e => setForm({ ...form, end_date: e.target.value })}
                style={{ ...inputStyle, width: '100%' }}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>
            <div style={{ flex: '1 1 130px' }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Tipo</label>
              <select value={form.absence_type} onChange={e => setForm({ ...form, absence_type: e.target.value })}
                style={{ ...inputStyle, width: '100%', cursor: 'pointer' }}>
                {ABSENCE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div style={{ flex: '2 1 180px' }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Motivo / Observação</label>
              <input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}
                placeholder="Ex: Atestado hospital São Lucas"
                style={{ ...inputStyle, width: '100%' }}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
              />
            </div>
            <button onClick={handleAdd} disabled={saving || !form.member_id || !form.date || !form.end_date} style={{
              padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
              fontWeight: 600, fontSize: 14, background: 'var(--accent)', color: '#fff',
              opacity: (!form.member_id || !form.date || !form.end_date) ? 0.5 : 1, whiteSpace: 'nowrap', alignSelf: 'flex-end',
            }}>+ Registrar</button>
          </div>
        </div>
      )}

      {/* Lista */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{filtered.length} ausência(s) registrada(s)</span>
        <input value={filter} onChange={e => setFilter(e.target.value)}
          placeholder="Filtrar por nome..."
          style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--input-bg)', color: 'var(--text)', fontSize: 13, outline: 'none' }}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>
            Nenhuma ausência registrada
          </p>
        )}
        {filtered.map(a => {
          const d = parseDateStr(a.date);
          const end = a.end_date ? parseDateStr(a.end_date) : null;
          const isRange = end && a.end_date !== a.date;
          const rangeDays = isRange ? Math.round((end - d) / 86400000) + 1 : 1;
          return (
            <div key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
              borderRadius: 10, background: 'var(--row-bg)', border: '1px solid var(--border)'
            }}>
              <div style={{ textAlign: 'center', minWidth: isRange ? 96 : 44 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--accent)', lineHeight: 1.2 }}>
                  {String(d.getDate()).padStart(2, '0')}/{String(d.getMonth() + 1).padStart(2, '0')}
                  {isRange && (
                    <>
                      <span style={{ color: 'var(--text-muted)', margin: '0 4px' }}>→</span>
                      {String(end.getDate()).padStart(2, '0')}/{String(end.getMonth() + 1).padStart(2, '0')}
                    </>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginTop: 2 }}>
                  {isRange ? `${rangeDays} dias` : `${MONTHS_PT[d.getMonth()]} ${d.getFullYear()}`}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{a.member_name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {typeLabel(a.absence_type)}
                  {a.reason && <span style={{ marginLeft: 6 }}>· {a.reason}</span>}
                </div>
              </div>
              {isAdmin && (
                <button onClick={() => handleRemove(a)} style={{
                  background: 'none', border: '1px solid #ef444440', borderRadius: 8,
                  cursor: 'pointer', padding: '5px 10px', fontSize: 12, color: '#ef4444'
                }}>✕</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
