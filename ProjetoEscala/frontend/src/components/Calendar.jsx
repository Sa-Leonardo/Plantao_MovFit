import { useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { parseDateStr, isSpecialDay, isHoliday, normalizeOverrideMembers, prevDayStr } from '../utils/rotation';
import { isRotatingWorkDay } from './ColaboradoresPanel';
import api from '../api';

const MONTHS_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const DAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const DAYS_FULL = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

function scheduleGroupColor(startTime) {
  if (!startTime) return '#94a3b8';
  const h = parseInt(startTime.split(':')[0], 10);
  if (h < 6)  return '#DC2626';
  if (h < 12) return '#f59e0b';
  if (h < 18) return '#22c55e';
  return '#E11D48';
}

function groupBySchedule(colabs) {
  const sorted = [...colabs].sort((a, b) => {
    const ta = a.work_start || '99:99';
    const tb = b.work_start || '99:99';
    if (ta !== tb) return ta.localeCompare(tb);
    return a.name.localeCompare(b.name);
  });
  const groupMap = new Map();
  for (const c of sorted) {
    const key = (c.work_start && c.work_end)
      ? `${c.work_start}–${c.work_end}`
      : c.work_start || '__sem__';
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(c);
  }
  return Array.from(groupMap.entries()).map(([key, items]) => ({
    key,
    label: key === '__sem__' ? '⏱️ Sem horário definido' : `🕐 ${key}`,
    color: scheduleGroupColor(items[0]?.work_start),
    items,
  }));
}

function dStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function memberColor(name) {
  return `hsl(${name.charCodeAt(0) * 7 % 360}, 55%, 50%)`;
}

const selectStyle = {
  width: '100%', padding: '8px 12px', borderRadius: 8,
  border: '1px solid var(--border)', background: 'var(--input-bg)',
  color: 'var(--text)', fontSize: 13, outline: 'none',
};

export default function Calendar({ year, month, team, holidays, shifts, schedule, overrides, absences, colaboradores, onOverrideUpdate, onLogsUpdate, isAdmin, settings = {}, snapshots = {}, cutoffDate = null, isMobile = false, onMonthChange }) {
  const compensatoryMondayRest = !!settings?.compensatory_monday_rest;
  // Datas anteriores ao início do histórico são tratadas como "antes do app existir":
  // não renderizam expediente nem plantão, não são clicáveis. O algoritmo de rotação
  // já ignora esses dias (rotation.js:132); aqui é apenas o corte na UI para dias úteis,
  // que são derivados direto de colaboradores.work_days e não passam pela rotação.
  const historyStart = settings?.schedule_start_date || null;
  const isBeforeHistory = (ds) => !!(historyStart && ds < historyStart);
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const getMember = (id) => team.find(m => m.id === id);
  const activeTeam = team.filter(m => m.active);

  // Expande o intervalo [date ... end_date] no mapa de absências (1 entry por dia)
  const absenceMap = {};
  for (const a of absences) {
    const start = parseDateStr(a.date);
    const end = a.end_date ? parseDateStr(a.end_date) : start;
    const cursor = new Date(start);
    while (cursor <= end) {
      const ds = dStr(cursor);
      if (!absenceMap[ds]) absenceMap[ds] = [];
      absenceMap[ds].push(a);
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  // editAssign: { shift_id: [memberId | '', ...] }
  const [editDay, setEditDay] = useState(null);
  const [editAssign, setEditAssign] = useState({});
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Modal expediente (dias úteis)
  const [expedienteDay, setExpedienteDay] = useState(null);
  // Modal de visualização (domingos/feriados) — somente leitura para não-admin
  const [viewDay, setViewDay] = useState(null);

  // Mobile: dia selecionado (default = hoje, se dentro do mês visualizado; senão, dia 1)
  const today = new Date();
  const isViewingCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  const defaultMobileDay = isViewingCurrentMonth ? today.getDate() : 1;
  const [mobileDay, setMobileDay] = useState(defaultMobileDay);
  const clampedMobileDay = Math.min(mobileDay, daysInMonth);
  const mobileDs = dStr(new Date(year, month, clampedMobileDay));

  // Retorna quantas vagas este turno tem no tipo do dia (domingo vs feriado)
  const slotsForShiftOnDate = (shift, ds) => {
    if (!ds) return Math.max(1, shift.slots || 1);
    const sun = parseDateStr(ds).getDay() === 0;
    const legacy = Math.max(1, shift.slots || 1);
    const val = sun
      ? (shift.sunday_slots != null ? shift.sunday_slots : legacy)
      : (shift.holiday_slots != null ? shift.holiday_slots : legacy);
    return Math.max(1, val);
  };

  const openEdit = (ds, current) => {
    // Inicializa editAssign com arrays — um slot por vaga configurada, preenchido com override/schedule atual
    const initialAssign = {};
    for (const shift of shifts) {
      const currentIds = normalizeOverrideMembers(current?.[shift.id]);
      const slots = slotsForShiftOnDate(shift, ds);
      const arr = [...currentIds];
      while (arr.length < slots) arr.push('');
      initialAssign[shift.id] = arr;
    }
    setEditDay(ds);
    setEditAssign(initialAssign);
    setReason('');
    setError('');
  };

  const setSlotValue = (shiftId, slotIdx, value) => {
    setEditAssign(prev => {
      const arr = [...(prev[shiftId] || [])];
      arr[slotIdx] = value;
      return { ...prev, [shiftId]: arr };
    });
  };

  const addAvulsoSlot = (shiftId) => {
    setEditAssign(prev => ({
      ...prev,
      [shiftId]: [...(prev[shiftId] || []), ''],
    }));
  };

  const removeSlot = (shiftId, slotIdx) => {
    setEditAssign(prev => {
      const arr = [...(prev[shiftId] || [])];
      arr.splice(slotIdx, 1);
      return { ...prev, [shiftId]: arr };
    });
  };

  // Reset manual: remove o override e volta pra escala auto-gerada.
  // Disponível apenas em dias >= hoje — dias passados têm snapshot consolidado
  // que, após o fix do Bug N, só guarda os turnos NÃO-override, então resetar
  // o passado deixaria o turno como um buraco vazio (sem regenerar).
  const canResetToDefault = !!(editDay && overrides[editDay] && (!cutoffDate || editDay >= cutoffDate));
  const resetToDefault = async () => {
    if (!canResetToDefault) return;
    const ok = window.confirm(
      'Remover a edição manual deste dia e voltar à escala gerada pelo algoritmo?\n\n' +
      'Os membros serão redistribuídos automaticamente com base na fairness atual.'
    );
    if (!ok) return;
    setSaving(true); setError('');
    try {
      await api.deleteOverride(editDay);
      const newOverrides = { ...overrides };
      delete newOverrides[editDay];
      onOverrideUpdate(newOverrides);
      if (onLogsUpdate) onLogsUpdate();
      setEditDay(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async () => {
    setSaving(true); setError('');
    try {
      // Filtra IDs vazios e monta assignments finais
      const assignments = {};
      for (const [shiftId, arr] of Object.entries(editAssign)) {
        assignments[shiftId] = arr.filter(Boolean);
      }
      await api.setOverride(editDay, assignments, reason);

      // Estado local PRECISA espelhar o que o backend persiste: o PUT em
      // overrides.js deleta rows com lista vazia. Se mantivermos `{turno: []}`
      // no estado React, a rotação entra no caminho de override com um turno
      // "explicitamente vazio", divergindo do que aparece depois de um refresh
      // (quando o backend GET retorna o turno ausente, não vazio). Sem esta
      // limpeza, o schedule exibido fica inconsistente até a próxima recarga.
      const cleanedAssignments = {};
      for (const [k, v] of Object.entries(assignments)) {
        if (v.length > 0) cleanedAssignments[k] = v;
      }
      const newOverrides = { ...overrides };
      if (Object.keys(cleanedAssignments).length === 0) {
        delete newOverrides[editDay];
      } else {
        newOverrides[editDay] = cleanedAssignments;
      }
      onOverrideUpdate(newOverrides);

      if (onLogsUpdate) onLogsUpdate();
      setEditDay(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Conjunto de IDs de colaboradores que estão ausentes numa determinada data.
  // Ausências ficam em team_members (via member_id); para o colaborador ser
  // considerado ausente, precisa existir um team_member com o mesmo colaborador_id
  // que esteja ausente no dia.
  const absentColaboradorIds = (dateStr) => {
    const absentMemberIds = absenceMap[dateStr];
    if (!absentMemberIds || absentMemberIds.length === 0) return new Set();
    const memberIdSet = new Set(absentMemberIds.map(a => a.member_id));
    const out = new Set();
    for (const m of team) {
      if (memberIdSet.has(m.id) && m.colaborador_id) out.add(m.colaborador_id);
    }
    return out;
  };

  const getWorkingOnDay = (dow, dateStr) => {
    const absentToday = absentColaboradorIds(dateStr);
    return (colaboradores || []).filter(c => {
      if (!c.active) return false;
      if (absentToday.has(c.id)) return false;      // não aparece quando ausente
      if (c.schedule_type === 'rotating') {
        return isRotatingWorkDay(dateStr, c.rotation_anchor, c.rotation_work_days || 1, c.rotation_rest_days || 2);
      }
      const days = Array.isArray(c.work_days) ? c.work_days : [];
      return days.includes(dow);
    });
  };

  // IDs de membros em folga compensatória (se regra ativa + dia editado é feriado na segunda).
  // Busca em cascata: schedule atual → overrides → snapshots (inclusive mês anterior),
  // igual ao que rotation.js faz — caso contrário, quando o dia editado é dia 1
  // do mês, o domingo anterior (mês anterior) não aparece e o badge some,
  // mesmo que a rotação exclua os membros corretamente.
  const compensatoryRestIds = (() => {
    if (!compensatoryMondayRest || !editDay) return new Set();
    const editDate = parseDateStr(editDay);
    if (editDate.getDay() !== 1) return new Set();
    if (!isHoliday(editDay, holidays)) return new Set();
    const prevDs = prevDayStr(editDay);
    const prevAssign = schedule[prevDs] || overrides[prevDs] || snapshots[prevDs];
    if (!prevAssign) return new Set();
    const ids = new Set();
    for (const memberIds of Object.values(prevAssign)) {
      for (const mid of normalizeOverrideMembers(memberIds)) ids.add(mid);
    }
    return ids;
  })();

  // Data é imutável? (anterior ao cutoff e com snapshot consolidado)
  const isEditDayLocked = !!(editDay && cutoffDate && editDay < cutoffDate && snapshots[editDay]);

  const expedienteDateObj = expedienteDay ? new Date(expedienteDay + 'T00:00:00') : null;
  const expedienteDow = expedienteDateObj ? expedienteDateObj.getDay() : null;
  const expedienteColabs = (expedienteDay && expedienteDow !== null) ? getWorkingOnDay(expedienteDow, expedienteDay) : [];

  return (
    <div>
      {/* Modal: editar escala de plantão */}
      <Modal open={!!editDay} onClose={() => setEditDay(null)}
        title={editDay ? `Editar escala — ${parseDateStr(editDay).getDate()} de ${MONTHS_PT[month]}` : ''}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {isEditDayLocked && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: '#6b728020', border: '1px solid #6b728040', fontSize: 12, color: 'var(--text-muted)' }}>
              <strong>🔒 Data consolidada:</strong> Esta data é anterior à data atual e já foi registrada no histórico. A edição ainda é permitida, mas alterações aqui não reprocessam a escala passada.
            </div>
          )}
          {canResetToDefault && (
            <div style={{
              padding: '10px 14px', borderRadius: 8,
              background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
              fontSize: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            }}>
              <span style={{ flex: 1, minWidth: 180, color: 'var(--text-muted)' }}>
                <strong style={{ color: 'var(--accent)' }}>✏️ Edição manual:</strong>{' '}
                Esta data foi ajustada manualmente. Você pode voltar à escala que o algoritmo geraria.
              </span>
              <button
                onClick={resetToDefault}
                disabled={saving}
                style={{
                  padding: '7px 14px', borderRadius: 8,
                  border: '1px solid var(--accent)', background: 'transparent',
                  color: 'var(--accent)', cursor: saving ? 'not-allowed' : 'pointer',
                  fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap',
                  opacity: saving ? 0.6 : 1,
                }}
                title="Remove a edição manual e regenera a escala pelo algoritmo"
              >
                ↺ Voltar ao padrão
              </button>
            </div>
          )}
          {compensatoryMondayRest && compensatoryRestIds.size > 0 && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: '#ef444415', border: '1px solid #ef444440', fontSize: 12 }}>
              <strong style={{ color: '#ef4444' }}>🔴 Folga compensatória ativa:</strong>
              <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
                {compensatoryRestIds.size} membro(s) trabalharam no domingo anterior e deveriam estar de folga hoje.
              </span>
            </div>
          )}

          {editDay && absenceMap[editDay] && (
            <div style={{ padding: '10px 14px', borderRadius: 8, background: '#f59e0b15', border: '1px solid #f59e0b30', fontSize: 12 }}>
              <strong style={{ color: '#f59e0b' }}>⚠️ Ausências registradas neste dia:</strong>
              {absenceMap[editDay].map(a => (
                <div key={a.id} style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                  · {a.member_name} — {a.absence_type}{a.reason ? ` (${a.reason})` : ''}
                </div>
              ))}
            </div>
          )}

          {shifts.map(s => {
            const poolForShift = activeTeam.filter(m => m.shift && m.shift.id === s.id);
            const others = activeTeam.filter(m => !m.shift || m.shift.id !== s.id);
            const absentIds = (absenceMap[editDay] || []).map(a => a.member_id);
            const slotArr = editAssign[s.id] || [''];
            const configuredSlots = slotsForShiftOnDate(s, editDay);

            return (
              <div key={s.id} style={{ padding: '14px 16px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)' }}>
                {/* Cabeçalho do turno */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{s.label}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.start_time}–{s.end_time}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    {configuredSlots} {configuredSlots === 1 ? 'vaga' : 'vagas'} configurada{configuredSlots > 1 ? 's' : ''}
                  </span>
                </div>

                {/* Dropdowns: um por slot */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {slotArr.map((currentId, slotIdx) => {
                    const isAvulso = slotIdx >= configuredSlots;
                    return (
                      <div key={slotIdx} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 60 }}>
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
                            background: isAvulso ? '#f59e0b20' : '#E11D4815',
                            color: isAvulso ? '#f59e0b' : 'var(--accent)',
                            border: `1px solid ${isAvulso ? '#f59e0b40' : '#E11D4830'}`,
                            whiteSpace: 'nowrap',
                          }}>
                            {isAvulso ? '⭐ Avulso' : `Vaga ${slotIdx + 1}`}
                          </span>
                        </div>
                        <select
                          value={currentId}
                          onChange={e => setSlotValue(s.id, slotIdx, e.target.value)}
                          style={selectStyle}
                        >
                          <option value="">— Ninguém —</option>
                          {poolForShift.length > 0 && (
                            <optgroup label={`Turno ${s.label}`}>
                              {poolForShift.map(m => (
                                <option key={m.id} value={m.id}>
                                  {m.name}{absentIds.includes(m.id) ? ' ⚠️ ausente' : ''}{compensatoryRestIds.has(m.id) ? ' 🔴 folga comp.' : ''}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {others.length > 0 && (
                            <optgroup label="Outros turnos">
                              {others.map(m => (
                                <option key={m.id} value={m.id}>
                                  {m.name} ({m.shift?.label}){absentIds.includes(m.id) ? ' ⚠️ ausente' : ''}{compensatoryRestIds.has(m.id) ? ' 🔴 folga comp.' : ''}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                        {/* Botão remover slot avulso (ou extra) */}
                        {slotIdx >= configuredSlots && (
                          <button onClick={() => removeSlot(s.id, slotIdx)} title="Remover" style={{
                            background: 'none', border: '1px solid #ef444440', borderRadius: 6,
                            cursor: 'pointer', padding: '4px 8px', fontSize: 13, color: '#ef4444', flexShrink: 0,
                          }}>✕</button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Botão adicionar avulso */}
                <button onClick={() => addAvulsoSlot(s.id)} style={{
                  marginTop: 8, background: 'none', border: '1px dashed #f59e0b60',
                  borderRadius: 8, cursor: 'pointer', padding: '5px 12px',
                  fontSize: 12, color: '#f59e0b', fontWeight: 600,
                }}>
                  + Adicionar avulso
                </button>
              </div>
            );
          })}

          <div>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
              Motivo da alteração <span style={{ fontSize: 11 }}>(ficará registrado no histórico)</span>
            </label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Ex: João estava de atestado, substituído por Maria"
              rows={2}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 10,
                border: '1px solid var(--border)', background: 'var(--input-bg)',
                color: 'var(--text)', fontSize: 13, resize: 'vertical', outline: 'none',
              }}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />
          </div>

          {error && <div style={{ padding: '8px 12px', borderRadius: 8, background: '#ef444420', color: '#ef4444', fontSize: 13 }}>{error}</div>}
          <button onClick={saveEdit} disabled={saving} style={{
            padding: '12px 24px', borderRadius: 10, border: 'none', cursor: 'pointer',
            fontWeight: 700, fontSize: 14, background: 'var(--accent)', color: '#fff'
          }}>{saving ? 'Salvando...' : 'Salvar alteração'}</button>
        </div>
      </Modal>

      {/* Modal: visualização de domingo/feriado (somente leitura) */}
      <Modal
        open={!!viewDay}
        onClose={() => setViewDay(null)}
        title={viewDay ? (() => {
          const dt = parseDateStr(viewDay);
          const holidayItem = holidays.find(h => h.date === viewDay);
          const label = dt.getDay() === 6 ? 'Sábado' : dt.getDay() === 0 ? 'Domingo' : (holidayItem ? holidayItem.label : 'Feriado');
          return `${label} — ${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}`;
        })() : ''}
      >
        <div>
          {viewDay && (() => {
            const daySched = schedule[viewDay] || {};
            const hasAny = Object.values(daySched).some(arr => normalizeOverrideMembers(arr).length > 0);
            const absentList = absenceMap[viewDay] || [];
            if (!hasAny && absentList.length === 0) {
              return (
                <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                  Nenhuma escala definida para este dia
                </p>
              );
            }
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {isAdmin && absentList.length > 0 && (
                  <div style={{ padding: '10px 14px', borderRadius: 8, background: '#f59e0b15', border: '1px solid #f59e0b30', fontSize: 12 }}>
                    <strong style={{ color: '#f59e0b' }}>⚠️ Ausências neste dia:</strong>
                    {absentList.map(a => (
                      <div key={a.id} style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                        · {a.member_name} — {a.absence_type}{a.reason ? ` (${a.reason})` : ''}
                      </div>
                    ))}
                  </div>
                )}
                {shifts.map(s => {
                  const memberIds = normalizeOverrideMembers(daySched[s.id]);
                  if (memberIds.length === 0) return null;
                  return (
                    <div key={s.id} style={{ padding: '12px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{s.label}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.start_time}–{s.end_time}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                          {memberIds.length} {memberIds.length === 1 ? 'escalado' : 'escalados'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        {memberIds.map((mid, idx) => {
                          const m = getMember(mid);
                          if (!m) return null;
                          const isAvulso = idx >= slotsForShiftOnDate(s, viewDay);
                          return (
                            <div key={`${s.id}-${idx}`} style={{
                              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                              borderRadius: 8, background: 'var(--row-bg)',
                              border: isAvulso ? '1px dashed #f59e0b40' : '1px solid var(--border)',
                            }}>
                              <div style={{
                                width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontWeight: 700, fontSize: 12, color: '#fff', background: memberColor(m.name),
                              }}>{m.name.charAt(0).toUpperCase()}</div>
                              <span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                                {isAvulso && <span style={{ color: '#f59e0b', marginRight: 4 }}>⭐</span>}
                                {m.name}
                              </span>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.shift?.label}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </Modal>

      {/* Modal: expediente do dia útil */}
      <Modal
        open={!!expedienteDay}
        onClose={() => setExpedienteDay(null)}
        title={expedienteDay ? `Expediente — ${DAYS_FULL[expedienteDow]}, ${String(expedienteDateObj.getDate()).padStart(2, '0')}/${String(expedienteDateObj.getMonth() + 1).padStart(2, '0')}` : ''}
      >
        <div>
          {expedienteColabs.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
              Nenhum colaborador cadastrado para este dia
            </p>
          ) : (
            <div>
              <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--text-muted)' }}>
                {expedienteColabs.length} colaborador(es) em expediente
              </p>
              {groupBySchedule(expedienteColabs).map(({ key, label, color, items }) =>
                items.length === 0 ? null : (
                  <div key={key} style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: 0.5 }}>{label} ({items.length})</span>
                      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {items.map(c => (
                        <div key={c.id} style={{
                          display: 'flex', alignItems: 'center', gap: 10, padding: '9px 13px',
                          borderRadius: 10, background: 'var(--row-bg)', border: '1px solid var(--border)',
                        }}>
                          <div style={{
                            width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontWeight: 700, fontSize: 12, color: '#fff', background: memberColor(c.name),
                          }}>{c.name.charAt(0).toUpperCase()}</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                              <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{c.name}</span>
                              {c.schedule_type === 'rotating' && (
                                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 5, background: '#f59e0b20', color: '#f59e0b', border: '1px solid #f59e0b30' }}>
                                  🔄 {c.rotation_work_days}×{c.rotation_rest_days}
                                </span>
                              )}
                            </div>
                          </div>
                          {(c.work_start || c.work_end) && (
                            <span style={{ fontSize: 12, color, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0 }}>
                              {c.work_start}{c.work_end ? `–${c.work_end}` : ''}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* ============== VISTA MOBILE: dia selecionado ============== */}
      {isMobile && (() => {
        const mDate = parseDateStr(mobileDs);
        const mBeforeHistory = isBeforeHistory(mobileDs);
        const mHoliday = holidays.find(h => h.date === mobileDs);
        const mSched = schedule[mobileDs];
        const mSpecial = !mBeforeHistory && (isSpecialDay(mobileDs, holidays) || !!mSched);
        const mWorkingCount = (!mBeforeHistory && !mSpecial) ? getWorkingOnDay(mDate.getDay(), mobileDs).length : 0;
        const mWorking = (!mBeforeHistory && !mSpecial) ? getWorkingOnDay(mDate.getDay(), mobileDs) : [];
        const mAbsent = mBeforeHistory ? [] : (absenceMap[mobileDs] || []);

        const stepDay = (delta) => {
          const next = new Date(mDate);
          next.setDate(next.getDate() + delta);
          if (next.getMonth() !== month || next.getFullYear() !== year) {
            onMonthChange?.(next.getFullYear(), next.getMonth());
            setMobileDay(next.getDate());
          } else {
            setMobileDay(next.getDate());
          }
        };

        const goToday = () => {
          const t = new Date();
          if (t.getMonth() !== month || t.getFullYear() !== year) {
            onMonthChange?.(t.getFullYear(), t.getMonth());
          }
          setMobileDay(t.getDate());
        };

        return (
          <div>
            {/* Seletor de data */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
              background: 'var(--surface)', border: '1px solid var(--card-border)',
              borderRadius: 14, padding: 8,
            }}>
              <button onClick={() => stepDay(-1)} style={{
                width: 38, height: 38, borderRadius: 10, border: '1px solid var(--border)',
                background: 'var(--input-bg)', color: 'var(--text)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}><Icon name="chevronLeft" size={18} /></button>
              <input
                type="date"
                value={mobileDs}
                onChange={(e) => {
                  if (!e.target.value) return;
                  const [y, m, d] = e.target.value.split('-').map(Number);
                  if (y !== year || m - 1 !== month) {
                    onMonthChange?.(y, m - 1);
                  }
                  setMobileDay(d);
                }}
                style={{
                  flex: 1, minWidth: 0, textAlign: 'center',
                  padding: '10px 8px', borderRadius: 10, border: '1px solid var(--border)',
                  background: 'var(--input-bg)', color: 'var(--text)',
                  fontSize: 14, fontWeight: 700, outline: 'none',
                }}
              />
              <button onClick={() => stepDay(1)} style={{
                width: 38, height: 38, borderRadius: 10, border: '1px solid var(--border)',
                background: 'var(--input-bg)', color: 'var(--text)', cursor: 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}><Icon name="chevronRight" size={18} /></button>
            </div>

            {/* Botão "Hoje" */}
            {!(today.getFullYear() === year && today.getMonth() === month && today.getDate() === clampedMobileDay) && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                <button onClick={goToday} style={{
                  padding: '6px 14px', borderRadius: 8, border: '1px solid var(--accent)',
                  background: 'color-mix(in srgb, var(--accent) 15%, transparent)',
                  color: 'var(--accent)', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                }}>
                  Voltar para hoje
                </button>
              </div>
            )}

            {/* Card do dia */}
            <div style={{
              background: mBeforeHistory ? 'var(--cell-bg)' : (mSpecial ? 'var(--special-bg)' : 'var(--surface)'),
              border: mBeforeHistory ? '1px dashed var(--border)' : `1px solid ${mSpecial ? 'var(--special-border)' : 'var(--card-border)'}`,
              borderRadius: 16, padding: '18px 18px', marginBottom: 14,
              opacity: mBeforeHistory ? 0.55 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
                <span style={{ fontSize: 36, fontWeight: 800, color: mDate.getDay() === 0 ? 'var(--sunday)' : 'var(--text)', lineHeight: 1 }}>
                  {String(mDate.getDate()).padStart(2, '0')}
                </span>
                <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>
                  {DAYS_FULL[mDate.getDay()]}, {MONTHS_PT[mDate.getMonth()]} {mDate.getFullYear()}
                </span>
              </div>
              {mHoliday && !mBeforeHistory && (
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--holiday-text)', marginBottom: 8 }}>
                  🎉 {mHoliday.label}
                </div>
              )}

              {mBeforeHistory ? (
                <p style={{
                  color: 'var(--text-muted)', fontSize: 13, fontStyle: 'italic',
                  margin: '14px 0 0', opacity: 0.7,
                }}>
                  Antes do início do histórico — o aplicativo ainda não existia nesta data.
                </p>
              ) : mSpecial ? (
                <>
                  {mSched ? (
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {shifts.map(s => {
                        const ids = normalizeOverrideMembers(mSched[s.id]);
                        if (ids.length === 0) return null;
                        return (
                          <div key={s.id} style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--row-bg)', border: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                              <strong style={{ fontSize: 13, color: 'var(--text)' }}>{s.label}</strong>
                              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.start_time}–{s.end_time}</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                              {ids.map((id, idx) => {
                                const m = getMember(id);
                                if (!m) return null;
                                const isAvulso = idx >= slotsForShiftOnDate(s, mobileDs);
                                return (
                                  <div key={idx} style={{
                                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
                                    borderRadius: 8, background: 'var(--cell-bg)',
                                    border: isAvulso ? '1px dashed #f59e0b60' : '1px solid var(--border)',
                                  }}>
                                    <div style={{
                                      width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                                      fontWeight: 700, fontSize: 12, color: '#fff', background: memberColor(m.name),
                                    }}>{m.name.charAt(0).toUpperCase()}</div>
                                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                                      {isAvulso && <span style={{ color: '#f59e0b', marginRight: 4 }}>⭐</span>}
                                      {m.name}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                      {isAdmin && (
                        <button onClick={() => openEdit(mobileDs, mSched)} style={{
                          padding: '11px', borderRadius: 10, border: 'none',
                          background: 'var(--accent)', color: '#fff', cursor: 'pointer',
                          fontSize: 13, fontWeight: 700, marginTop: 4,
                        }}>Editar escala do dia</button>
                      )}
                    </div>
                  ) : (
                    <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '10px 0 0' }}>Sem escala</p>
                  )}
                </>
              ) : (
                <>
                  {mWorkingCount > 0 ? (
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
                        {mWorkingCount} colaborador(es) em expediente
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {groupBySchedule(mWorking).map(({ key, label, color, items }) =>
                          items.length === 0 ? null : (
                            <div key={key}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 6px' }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: 0.5 }}>{label}</span>
                                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                              </div>
                              {items.map(c => (
                                <div key={c.id} style={{
                                  display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                                  borderRadius: 8, background: 'var(--row-bg)', border: '1px solid var(--border)',
                                  marginBottom: 4,
                                }}>
                                  <div style={{
                                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontWeight: 700, fontSize: 12, color: '#fff', background: memberColor(c.name),
                                  }}>{c.name.charAt(0).toUpperCase()}</div>
                                  <span style={{ flex: 1, fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{c.name}</span>
                                  {(c.work_start || c.work_end) && (
                                    <span style={{ fontSize: 11, color, fontWeight: 700, whiteSpace: 'nowrap' }}>
                                      {c.work_start}{c.work_end ? `–${c.work_end}` : ''}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  ) : (
                    <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '10px 0 0' }}>Expediente normal, sem colaboradores cadastrados para este dia</p>
                  )}
                  {isAdmin && mAbsent.length > 0 && (
                    <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 8, background: '#f59e0b15', border: '1px solid #f59e0b30', fontSize: 12 }}>
                      <strong style={{ color: '#f59e0b' }}>⚠️ Ausências:</strong>
                      {mAbsent.map(a => (
                        <div key={a.id} style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                          · {a.member_name} — {a.absence_type}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* ============== VISTA DESKTOP: grade mensal ============== */}
      {!isMobile && (
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--card-border)',
        borderRadius: 16, padding: 12, overflow: 'hidden',
      }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 6 }}>
        {DAYS_PT.map(d => (
          <div key={d} style={{ padding: '10px 4px', textAlign: 'center', fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: 1.5, textTransform: 'uppercase' }}>{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`e${i}`} style={{ minHeight: 90 }} />;
          const ds = dStr(new Date(year, month, day));

          // Antes do início do histórico: célula apagada, não clicável, sem conteúdo
          if (isBeforeHistory(ds)) {
            return (
              <div key={ds} style={{
                minHeight: 110, padding: '8px 10px', borderRadius: 12,
                cursor: 'default', opacity: 0.4,
                background: 'var(--cell-bg)',
                border: '1px dashed var(--border)',
              }} title="Data anterior ao início do histórico — o app ainda não existia">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-muted)' }}>{day}</span>
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 6, lineHeight: 1.3 }}>
                  Antes do histórico
                </div>
              </div>
            );
          }

          const dow = new Date(year, month, day).getDay();
          const holiday = holidays.find(h => h.date === ds);
          const daySchedule = schedule[ds];
          const special = isSpecialDay(ds, holidays) || !!daySchedule;
          const isOverridden = !!overrides[ds];
          const hasAbsences = !!(absenceMap[ds]?.length);

          const workingCount = !special ? getWorkingOnDay(dow, ds).length : 0;
          // Special (domingo/feriado): admin abre edição, demais abrem visualização
          const hasSpecialContent = special && (daySchedule || holiday);
          const isClickable = (special && (isAdmin || hasSpecialContent)) || (!special && workingCount > 0);

          const handleClick = () => {
            if (special) {
              if (isAdmin) { openEdit(ds, daySchedule); }
              else if (hasSpecialContent) { setViewDay(ds); }
              return;
            }
            if (!special && workingCount > 0) { setExpedienteDay(ds); }
          };

          return (
            <div
              key={ds}
              onClick={handleClick}
              style={{
                minHeight: 110, padding: '8px 10px', borderRadius: 12,
                cursor: isClickable ? 'pointer' : 'default',
                background: special ? 'var(--special-bg)' : 'var(--cell-bg)',
                border: special ? '1px solid var(--special-border)' : '1px solid var(--border)',
                transition: 'all 0.15s', position: 'relative',
              }}
              onMouseEnter={e => { if (isClickable) { e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.2)'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 2 }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: dow === 0 ? 'var(--sunday)' : 'var(--text)' }}>{day}</span>
                <div style={{ display: 'flex', gap: 2 }}>
                  {isAdmin && hasAbsences && <span title="Ausências registradas" style={{ fontSize: 9, background: '#f59e0b', color: '#fff', padding: '1px 5px', borderRadius: 8, fontWeight: 700 }}>AUS</span>}
                  {isAdmin && isOverridden && <span style={{ fontSize: 9, background: 'var(--accent)', color: '#fff', padding: '1px 5px', borderRadius: 8, fontWeight: 700 }}>EDIT</span>}
                </div>
              </div>

              {holiday && <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--holiday-text)', marginBottom: 4, lineHeight: 1.2 }}>{holiday.label}</div>}

              {/* Dias de plantão (domingos/feriados) */}
              {special && daySchedule && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {shifts.map(s => {
                    const memberIds = normalizeOverrideMembers(daySchedule[s.id]);
                    if (memberIds.length === 0) return null;
                    return memberIds.map((memberId, idx) => {
                      const member = getMember(memberId);
                      if (!member) return null;
                      const isAbsent = absenceMap[ds]?.some(a => a.member_id === member.id);
                      const isAvulso = idx >= slotsForShiftOnDate(s, ds);
                      return (
                        <div key={`${s.id}-${idx}`} style={{
                          display: 'flex', alignItems: 'center', gap: 4,
                          padding: '2px 5px', borderRadius: 6,
                          background: isAvulso ? '#f59e0b12' : `${memberColor(member.name)}18`,
                          fontSize: 10, lineHeight: 1.3,
                          border: isAbsent ? '1px solid #f59e0b40' : isAvulso ? '1px dashed #f59e0b40' : 'none',
                        }}>
                          <div style={{
                            width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 8, fontWeight: 800, color: '#fff',
                            background: memberColor(member.name),
                          }}>{member.name.charAt(0).toUpperCase()}</div>
                          <span style={{ fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {isAvulso ? '⭐ ' : ''}{member.name}
                          </span>
                          <span style={{ color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0, fontSize: 9 }}>{s.start_time}</span>
                        </div>
                      );
                    });
                  })}
                </div>
              )}
              {special && !daySchedule && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>Sem escala</div>}

              {/* Dias úteis: indicador clicável de expediente */}
              {!special && (
                workingCount > 0 ? (
                  <div style={{
                    marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 7px', borderRadius: 7,
                    background: '#E11D4815', border: '1px solid #E11D4830',
                    fontSize: 10, color: 'var(--accent)', fontWeight: 600, cursor: 'pointer',
                  }}>
                    👤 {workingCount} em expediente
                  </div>
                ) : (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>Expediente normal</div>
                )
              )}
            </div>
          );
        })}
      </div>
      </div>
      )}
    </div>
  );
}
