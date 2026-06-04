import { useState } from 'react';
import Badge from './Badge';
import api from '../api';

// Formata o horário do colaborador para exibição
function scheduleInfo(c) {
  if (!c) return '';
  const time = (c.work_start && c.work_end) ? `${c.work_start}–${c.work_end}` : c.work_start || '';
  if (c.schedule_type === 'rotating') {
    return `🔄 ${c.rotation_work_days}×${c.rotation_rest_days}${time ? ` · ${time}` : ''}`;
  }
  const DAYS = {0:'Dom',1:'Seg',2:'Ter',3:'Qua',4:'Qui',5:'Sex',6:'Sáb'};
  const days = (c.work_days || []).sort((a, b) => a === 0 ? 1 : b === 0 ? -1 : a - b).map(d => DAYS[d]).join(' ');
  return [days, time].filter(Boolean).join(' · ');
}

export default function TeamPanel({ team, shifts, colaboradores, onUpdate, isAdmin }) {
  const [colaboradorId, setColaboradorId] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [inRotation, setInRotation] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ shift_id: '', active: true, in_rotation: true, monthly_sunday_limit: '', monthly_holiday_limit: '' });

  // Colaboradores disponíveis para adicionar (ativos, não já na equipe)
  const teamColaboradorIds = new Set(team.map(m => m.colaborador_id).filter(Boolean));
  const availableColaboradores = (colaboradores || []).filter(c => c.active && !teamColaboradorIds.has(c.id));

  const noShifts = shifts.length === 0;
  const noColaboradores = (colaboradores || []).filter(c => c.active).length === 0;

  const handleAdd = async () => {
    if (!colaboradorId) { setError('Selecione um colaborador'); return; }
    if (!shiftId) { setError('Selecione um turno de plantão'); return; }
    setSaving(true); setError('');
    try {
      const created = await api.createMember({ colaborador_id: colaboradorId, shift_id: shiftId, in_rotation: inRotation });
      onUpdate([...team, created]);
      setColaboradorId(''); setShiftId(''); setInRotation(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (member) => {
    try {
      const updated = await api.updateMember(member.id, { active: !member.active });
      onUpdate(team.map(m => m.id === member.id ? updated : m));
    } catch (err) { setError(err.message); }
  };

  const handleRemove = async (id) => {
    if (!window.confirm('Remover este colaborador da Equipe de Plantão?')) return;
    try {
      await api.deleteMember(id);
      onUpdate(team.filter(m => m.id !== id));
    } catch (err) { setError(err.message); }
  };

  const startEdit = (member) => {
    setEditingId(member.id);
    setEditForm({
      shift_id: member.shift.id,
      active: member.active,
      in_rotation: member.in_rotation,
      monthly_sunday_limit: member.monthly_sunday_limit ?? '',
      monthly_holiday_limit: member.monthly_holiday_limit ?? '',
    });
    setError('');
  };

  const handleSaveEdit = async () => {
    if (!editForm.shift_id) { setError('Turno obrigatório'); return; }
    setSaving(true); setError('');
    try {
      const updated = await api.updateMember(editingId, {
        shift_id: editForm.shift_id,
        active: editForm.active,
        in_rotation: editForm.in_rotation,
        monthly_sunday_limit: editForm.monthly_sunday_limit === '' ? null : Number(editForm.monthly_sunday_limit),
        monthly_holiday_limit: editForm.monthly_holiday_limit === '' ? null : Number(editForm.monthly_holiday_limit),
      });
      onUpdate(team.map(m => m.id === editingId ? updated : m));
      setEditingId(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const selectStyle = {
    flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)',
    background: 'var(--input-bg)', color: 'var(--text)', fontSize: 14, outline: 'none', cursor: 'pointer',
  };

  const inRotationMembers = team.filter(m => m.in_rotation);
  const outOfRotationMembers = team.filter(m => !m.in_rotation);

  // Agrupa membros por turno, ordenando turnos pelo horário de início e membros alfabeticamente
  const groupByShift = (members) => {
    const sortedShifts = [...shifts].sort((a, b) => {
      const ta = a.start_time || '99:99';
      const tb = b.start_time || '99:99';
      if (ta !== tb) return ta.localeCompare(tb);
      return (a.label || '').localeCompare(b.label || '');
    });
    const groups = sortedShifts
      .map(s => ({
        shift: s,
        items: members
          .filter(m => m.shift && m.shift.id === s.id)
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .filter(g => g.items.length > 0);
    // Membros sem turno (improvável, mas mantém segurança)
    const orphans = members.filter(m => !m.shift);
    if (orphans.length > 0) {
      groups.push({ shift: { id: '__none__', label: 'Sem turno', start_time: '', end_time: '' }, items: orphans });
    }
    return groups;
  };

  const shiftGroupColor = (start) => {
    if (!start) return '#94a3b8';
    const h = parseInt(String(start).split(':')[0], 10);
    if (h < 6)  return '#DC2626';
    if (h < 12) return '#f59e0b';
    if (h < 18) return '#22c55e';
    return '#E11D48';
  };

  const ShiftGroupHeader = ({ shift, count }) => {
    const color = shiftGroupColor(shift.start_time);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 8px' }}>
        <span style={{
          fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 7,
          background: `${color}20`, color, border: `1px solid ${color}40`, whiteSpace: 'nowrap',
        }}>
          🕐 {shift.label}{shift.start_time ? ` · ${shift.start_time}${shift.end_time ? `–${shift.end_time}` : ''}` : ''} ({count})
        </span>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      </div>
    );
  };

  const MemberRow = ({ m }) => {
    const colaborador = (colaboradores || []).find(c => c.id === m.colaborador_id);
    return (
      <div style={{
        borderRadius: 10,
        background: m.active ? 'var(--row-bg)' : 'var(--row-inactive)',
        border: '1px solid var(--border)', overflow: 'hidden',
      }}>
        {editingId === m.id ? (
          <div style={{ display: 'flex', gap: 8, padding: '10px 14px', flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={editForm.shift_id} onChange={e => setEditForm({ ...editForm, shift_id: e.target.value })}
              style={{ ...selectStyle, minWidth: 130 }}>
              {shifts.map(s => <option key={s.id} value={s.id}>{s.label} ({s.start_time}–{s.end_time})</option>)}
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={editForm.active} onChange={e => setEditForm({ ...editForm, active: e.target.checked })} />
              Ativo
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={editForm.in_rotation} onChange={e => setEditForm({ ...editForm, in_rotation: e.target.checked })} />
              Faz plantão
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <label title="Máximo de domingos por mês (em branco = sem limite)" style={{ fontSize: 11, color: 'var(--sunday)', fontWeight: 600 }}>Lim. Dom</label>
              <input type="number" min={0} max={10} placeholder="—" value={editForm.monthly_sunday_limit}
                onChange={e => setEditForm({ ...editForm, monthly_sunday_limit: e.target.value })}
                style={{ ...selectStyle, width: 56, padding: '7px 8px', textAlign: 'center' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <label title="Máximo de feriados por mês (em branco = sem limite)" style={{ fontSize: 11, color: 'var(--holiday-text)', fontWeight: 600 }}>Lim. Fer</label>
              <input type="number" min={0} max={10} placeholder="—" value={editForm.monthly_holiday_limit}
                onChange={e => setEditForm({ ...editForm, monthly_holiday_limit: e.target.value })}
                style={{ ...selectStyle, width: 56, padding: '7px 8px', textAlign: 'center' }} />
            </div>
            <button onClick={handleSaveEdit} disabled={saving} style={{
              background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8,
              padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>Salvar</button>
            <button onClick={() => setEditingId(null)} style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 8,
              padding: '7px 10px', fontSize: 12, cursor: 'pointer', color: 'var(--text-muted)',
            }}>Cancelar</button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px' }}>
            <div style={{
              width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 14, color: '#fff',
              background: m.active ? `hsl(${m.name.charCodeAt(0) * 7 % 360}, 55%, 50%)` : 'var(--text-muted)',
            }}>{m.name.charAt(0).toUpperCase()}</div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontWeight: 600, fontSize: 14,
                color: m.active ? 'var(--text)' : 'var(--text-muted)',
                textDecoration: m.active ? 'none' : 'line-through',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{m.name}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                Plantão: {m.shift.label} · {m.shift.start_time}–{m.shift.end_time}
                {colaborador && scheduleInfo(colaborador) && (
                  <span style={{ marginLeft: 8 }}>· {scheduleInfo(colaborador)}</span>
                )}
                {(m.monthly_sunday_limit != null || m.monthly_holiday_limit != null) && (
                  <span style={{ marginLeft: 8 }}>
                    {m.monthly_sunday_limit != null && (
                      <span style={{ color: 'var(--sunday)', fontWeight: 600 }}>· máx {m.monthly_sunday_limit} dom/mês</span>
                    )}
                    {m.monthly_holiday_limit != null && (
                      <span style={{ color: 'var(--holiday-text)', fontWeight: 600 }}> · máx {m.monthly_holiday_limit} fer/mês</span>
                    )}
                  </span>
                )}
              </div>
            </div>

            <Badge color={m.active ? '#22c55e' : '#94a3b8'}>{m.active ? 'Ativo' : 'Inativo'}</Badge>

            {isAdmin && (
              <>
                <button onClick={() => startEdit(m)} title="Editar turno de plantão" style={{
                  background: 'none', border: '1px solid var(--border)', borderRadius: 8,
                  cursor: 'pointer', padding: '5px 10px', fontSize: 12, color: 'var(--text-muted)',
                }}>✏️</button>
                <button onClick={() => handleToggleActive(m)} title={m.active ? 'Desativar' : 'Ativar'} style={{
                  background: 'none', border: '1px solid var(--border)', borderRadius: 8,
                  cursor: 'pointer', padding: '5px 10px', fontSize: 12, color: 'var(--text-muted)',
                }}>{m.active ? 'Desativar' : 'Ativar'}</button>
                <button onClick={() => handleRemove(m.id)} title="Remover da equipe" style={{
                  background: 'none', border: '1px solid #ef444440', borderRadius: 8,
                  cursor: 'pointer', padding: '5px 10px', fontSize: 12, color: '#ef4444',
                }}>✕</button>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#ef444420', border: '1px solid #ef444440', color: '#ef4444', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {/* Info box */}
      <div style={{ padding: '12px 16px', borderRadius: 10, background: '#E11D4810', border: '1px solid #E11D4830', marginBottom: 20, fontSize: 13, color: 'var(--text-muted)' }}>
        👥 Aqui ficam os colaboradores que farão <strong style={{ color: 'var(--text)' }}>plantão nos domingos e feriados</strong>. Para adicionar alguém, cadastre-o primeiro em <strong style={{ color: 'var(--text)' }}>Colaboradores</strong> e selecione aqui o turno de plantão.
      </div>

      {isAdmin && noColaboradores && (
        <div style={{ padding: '14px 18px', borderRadius: 12, background: '#f59e0b20', border: '1px solid #f59e0b40', color: '#f59e0b', fontSize: 13, fontWeight: 500, marginBottom: 16 }}>
          ⚠️ Cadastre colaboradores na aba <strong>"Colaboradores"</strong> antes de montar a equipe de plantão.
        </div>
      )}

      {isAdmin && noShifts && (
        <div style={{ padding: '14px 18px', borderRadius: 12, background: '#f59e0b20', border: '1px solid #f59e0b40', color: '#f59e0b', fontSize: 13, fontWeight: 500, marginBottom: 16 }}>
          ⚠️ Crie ao menos um <strong>turno</strong> na aba "Turnos" antes de montar a equipe.
        </div>
      )}

      {isAdmin && !noColaboradores && !noShifts && (
        <div style={{ padding: '16px 20px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', marginBottom: 20 }}>
          <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Adicionar à Equipe de Plantão</h4>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>

            <div style={{ flex: 2, minWidth: 200 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Colaborador *</label>
              <select value={colaboradorId} onChange={e => setColaboradorId(e.target.value)} style={{ ...selectStyle, width: '100%' }}>
                <option value="">Selecionar colaborador...</option>
                {availableColaboradores.length === 0
                  ? <option disabled>Todos os colaboradores já estão na equipe</option>
                  : availableColaboradores.map(c => {
                    const info = scheduleInfo(c);
                    return (
                      <option key={c.id} value={c.id}>
                        {c.name}{info ? ` — ${info}` : ''}
                      </option>
                    );
                  })
                }
              </select>
            </div>

            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Turno de plantão *</label>
              <select value={shiftId} onChange={e => setShiftId(e.target.value)} style={{ ...selectStyle, width: '100%' }}>
                <option value="">Selecionar turno...</option>
                {shifts.map(s => <option key={s.id} value={s.id}>{s.label} ({s.start_time}–{s.end_time})</option>)}
              </select>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)', padding: '10px 0', whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={inRotation} onChange={e => setInRotation(e.target.checked)} />
              Faz plantão
            </label>

            <button onClick={handleAdd} disabled={saving || !colaboradorId || !shiftId} style={{
              padding: '10px 20px', borderRadius: 10, border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
              fontWeight: 600, fontSize: 14, background: 'var(--accent)', color: '#fff',
              opacity: (!colaboradorId || !shiftId) ? 0.5 : 1, whiteSpace: 'nowrap', alignSelf: 'flex-end',
            }}>+ Adicionar</button>
          </div>
        </div>
      )}

      {/* Grupo: Fazem plantão */}
      {inRotationMembers.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ height: 1, flex: 1, background: 'var(--border)' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#22c55e', letterSpacing: 0.5, whiteSpace: 'nowrap' }}>
              ✅ PARTICIPAM DO PLANTÃO ({inRotationMembers.length})
            </span>
            <div style={{ height: 1, flex: 1, background: 'var(--border)' }} />
          </div>
          {groupByShift(inRotationMembers).map(({ shift, items }) => (
            <div key={shift.id}>
              <ShiftGroupHeader shift={shift} count={items.length} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {items.map(m => <MemberRow key={m.id} m={m} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Grupo: Não fazem plantão */}
      {outOfRotationMembers.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ height: 1, flex: 1, background: 'var(--border)' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', letterSpacing: 0.5, whiteSpace: 'nowrap' }}>
              🚫 NÃO PARTICIPAM DO PLANTÃO ({outOfRotationMembers.length})
            </span>
            <div style={{ height: 1, flex: 1, background: 'var(--border)' }} />
          </div>
          {groupByShift(outOfRotationMembers).map(({ shift, items }) => (
            <div key={shift.id}>
              <ShiftGroupHeader shift={shift} count={items.length} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {items.map(m => <MemberRow key={m.id} m={m} />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {team.length === 0 && (
        <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 30 }}>
          Nenhum colaborador na equipe de plantão
        </p>
      )}
    </div>
  );
}
