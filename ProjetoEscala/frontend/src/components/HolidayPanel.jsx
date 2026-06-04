import { useState } from 'react';
import Badge from './Badge';
import Modal from './Modal';
import api from '../api';

const DAYS_FULL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const SCOPE_LABELS = { national: '🇧🇷 Nacional', state: '🏛️ Estadual', municipal: '🏙️ Municipal', optional: '📅 Facultativo' };
const SCOPE_COLORS = { national: '#E11D48', state: '#f59e0b', municipal: '#22c55e', optional: '#94a3b8' };

function ScopeBadge({ scope }) {
  const color = SCOPE_COLORS[scope] || '#94a3b8';
  const label = SCOPE_LABELS[scope] || scope;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 20,
      fontSize: 10, fontWeight: 600, background: `${color}20`, color, border: `1px solid ${color}40`,
      whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

function parseDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export default function HolidayPanel({ holidays, onUpdate, isAdmin }) {
  const [form, setForm] = useState({ date: '', label: '', is_fixed: false, scope: 'national', state: '', city: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  // Modal BrasilAPI
  const [showImport, setShowImport] = useState(false);
  const [importYear, setImportYear] = useState(new Date().getFullYear().toString());
  const [brasilList, setBrasilList] = useState([]);
  const [selectedDates, setSelectedDates] = useState(new Set());
  const [loadingBrasil, setLoadingBrasil] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState('');

  // Um feriado não-fixo é considerado "arquivado" se o ano já passou, pois no próximo
  // ano a data muda. Fixos sempre aparecem (mesmo cadastrados em anos antigos —
  // a data DD/MM vale para todo ano).
  const currentYear = new Date().getFullYear();
  const isArchived = (h) => {
    if (h.is_fixed) return false;
    const y = Number(h.date.slice(0, 4));
    return y < currentYear;
  };
  const all = [...holidays].sort((a, b) => a.date.localeCompare(b.date));
  const archivedCount = all.filter(isArchived).length;
  const sorted = showArchived ? all : all.filter(h => !isArchived(h));

  const handleAdd = async () => {
    if (!form.date) { setError('Selecione uma data'); return; }
    setSaving(true); setError('');
    try {
      const created = await api.createHoliday({
        date: form.date, label: form.label || 'Feriado',
        is_fixed: form.is_fixed, scope: form.scope,
        state: form.scope === 'state' ? form.state : null,
        city: form.scope === 'municipal' ? form.city : null,
      });
      onUpdate([...holidays, { ...created, is_fixed: !!created.is_fixed }]);
      setForm({ date: '', label: '', is_fixed: false, scope: 'national', state: '', city: '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (holiday) => {
    if (!window.confirm(`Remover o feriado "${holiday.label}" (${holiday.date})?`)) return;
    try {
      await api.deleteHoliday(holiday.date);
      onUpdate(holidays.filter(h => h.date !== holiday.date));
    } catch (err) {
      setError(err.message);
    }
  };

  // BrasilAPI
  const fetchBrasil = async () => {
    setLoadingBrasil(true); setBrasilList([]); setSelectedDates(new Set()); setImportResult('');
    try {
      const data = await api.fetchBrasilAPI(importYear);
      setBrasilList(data);
      // Pré-seleciona os que ainda não foram importados
      setSelectedDates(new Set(data.filter(h => !h.already_imported).map(h => h.date)));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingBrasil(false);
    }
  };

  const toggleSelectAll = () => {
    const avail = brasilList.filter(h => !h.already_imported).map(h => h.date);
    if (selectedDates.size === avail.length) setSelectedDates(new Set());
    else setSelectedDates(new Set(avail));
  };

  const handleImport = async () => {
    if (selectedDates.size === 0) { setImportResult('Nenhum feriado selecionado.'); return; }
    setImporting(true);
    try {
      const toImport = brasilList.filter(h => selectedDates.has(h.date));
      const result = await api.importHolidays(toImport.map(h => ({
        date: h.date, label: h.label, is_fixed: h.is_fixed, scope: 'national',
      })));
      setImportResult(`✅ ${result.imported} feriado(s) importado(s) com sucesso!`);
      const fresh = await api.getHolidays();
      onUpdate(fresh);
      setSelectedDates(new Set());
    } catch (err) {
      setImportResult(`❌ Erro: ${err.message}`);
    } finally {
      setImporting(false);
    }
  };

  const inputStyle = {
    padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)',
    background: 'var(--input-bg)', color: 'var(--text)', fontSize: 14, outline: 'none',
  };

  return (
    <div>
      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#ef444420', border: '1px solid #ef444440', color: '#ef4444', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      {isAdmin && (
        <>
          {/* Importar BrasilAPI */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button onClick={() => { setShowImport(true); setBrasilList([]); setImportResult(''); }} style={{
              padding: '8px 14px', borderRadius: 8, border: '1px solid var(--accent)',
              background: '#E11D4815', cursor: 'pointer', color: 'var(--accent)', fontSize: 13, fontWeight: 600
            }}>🇧🇷 Importar BrasilAPI</button>
          </div>

          {/* Formulário manual */}
          <div style={{ padding: '16px 20px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', marginBottom: 20 }}>
            <h4 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Adicionar feriado manualmente</h4>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Data *</label>
                <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })}
                  style={inputStyle}
                  onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                  onBlur={e => e.target.style.borderColor = 'var(--border)'}
                />
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Descrição</label>
                <input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })}
                  placeholder="Ex: Feriado Municipal"
                  style={{ ...inputStyle, width: '100%' }}
                  onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                  onBlur={e => e.target.style.borderColor = 'var(--border)'}
                  onKeyDown={e => e.key === 'Enter' && handleAdd()}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Âmbito</label>
                <select value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value })}
                  style={{ ...inputStyle, cursor: 'pointer' }}>
                  <option value="national">Nacional</option>
                  <option value="state">Estadual</option>
                  <option value="municipal">Municipal</option>
                  <option value="optional">Facultativo</option>
                </select>
              </div>
              {form.scope === 'state' && (
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Estado (UF)</label>
                  <input value={form.state} onChange={e => setForm({ ...form, state: e.target.value.toUpperCase() })}
                    placeholder="SP" maxLength={2} style={{ ...inputStyle, width: 70 }} />
                </div>
              )}
              {form.scope === 'municipal' && (
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Cidade</label>
                  <input value={form.city} onChange={e => setForm({ ...form, city: e.target.value })}
                    placeholder="São Paulo" style={{ ...inputStyle, width: 140 }} />
                </div>
              )}
              <div style={{ alignSelf: 'flex-end' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)', padding: '10px 0' }}>
                  <input type="checkbox" checked={form.is_fixed} onChange={e => setForm({ ...form, is_fixed: e.target.checked })} />
                  Data fixa
                </label>
              </div>
              <button onClick={handleAdd} disabled={saving || !form.date} style={{
                padding: '10px 20px', borderRadius: 10, border: 'none', cursor: 'pointer',
                fontWeight: 600, fontSize: 14, background: 'var(--accent)', color: '#fff',
                opacity: !form.date ? 0.5 : 1, whiteSpace: 'nowrap', alignSelf: 'flex-end',
              }}>+ Feriado</button>
            </div>
          </div>
        </>
      )}

      {/* Toggle de arquivados */}
      {archivedCount > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <button onClick={() => setShowArchived(v => !v)} style={{
            padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)',
            background: showArchived ? '#E11D4820' : 'var(--input-bg)',
            color: showArchived ? 'var(--accent)' : 'var(--text-muted)',
            cursor: 'pointer', fontSize: 12, fontWeight: 600,
          }}>
            {showArchived ? `Ocultar ${archivedCount} arquivado(s)` : `📦 Mostrar ${archivedCount} arquivado(s)`}
          </button>
        </div>
      )}

      {/* Lista */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {sorted.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: 20 }}>Nenhum feriado cadastrado</p>
        )}
        {sorted.map(h => {
          const d = parseDateStr(h.date);
          const archived = isArchived(h);
          // Feriados NÃO fixos mostram o ano; fixos só DD/MM (se repetem todo ano)
          const dateLabel = h.is_fixed
            ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
            : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
          return (
            <div key={h.date} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10,
              background: archived ? 'var(--row-inactive)' : 'var(--row-bg)',
              border: '1px solid var(--border)',
              opacity: archived ? 0.6 : 1,
            }}>
              <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent)', minWidth: h.is_fixed ? 50 : 80 }}>
                {dateLabel}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 500 }}>
                  {h.label}
                  {archived && <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 5, background: '#94a3b820', color: '#94a3b8', border: '1px solid #94a3b840' }}>📦 ARQUIVADO</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {DAYS_FULL[d.getDay()]}
                  {h.state && ` · ${h.state}`}
                  {h.city && ` · ${h.city}`}
                </div>
              </div>
              <Badge color={SCOPE_COLORS[h.scope] || '#94a3b8'}>{SCOPE_LABELS[h.scope]}</Badge>
              {h.is_fixed && <Badge color="#22c55e">📌 Fixo</Badge>}
              {isAdmin && (
                <button onClick={() => handleRemove(h)} style={{
                  background: 'none', border: '1px solid #ef444440', borderRadius: 8,
                  cursor: 'pointer', padding: '5px 10px', fontSize: 12, color: '#ef4444'
                }}>✕</button>
              )}
            </div>
          );
        })}
      </div>

      {/* Modal BrasilAPI */}
      <Modal open={showImport} onClose={() => setShowImport(false)} title="Importar feriados — BrasilAPI">
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Ano</label>
              <input value={importYear} onChange={e => setImportYear(e.target.value)}
                type="number" min="2020" max="2030"
                style={{ ...inputStyle, width: '100%' }}
              />
            </div>
            <button onClick={fetchBrasil} disabled={loadingBrasil} style={{
              padding: '10px 18px', borderRadius: 10, border: 'none', cursor: 'pointer',
              fontWeight: 600, fontSize: 14, background: 'var(--accent)', color: '#fff', whiteSpace: 'nowrap'
            }}>{loadingBrasil ? 'Buscando...' : 'Buscar'}</button>
          </div>

          {brasilList.length > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  {selectedDates.size} de {brasilList.filter(h => !h.already_imported).length} disponíveis selecionados
                </span>
                <button onClick={toggleSelectAll} style={{
                  background: 'none', border: '1px solid var(--border)', borderRadius: 8,
                  cursor: 'pointer', padding: '4px 10px', fontSize: 12, color: 'var(--text-muted)'
                }}>Selecionar tudo</button>
              </div>
              <div style={{ maxHeight: 340, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
                {brasilList.map(h => {
                  const disabled = h.already_imported;
                  const selected = selectedDates.has(h.date);
                  return (
                    <label key={h.date} style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8,
                      cursor: disabled ? 'default' : 'pointer',
                      background: disabled ? 'transparent' : selected ? '#E11D4815' : 'transparent',
                      border: `1px solid ${selected && !disabled ? '#E11D4840' : 'var(--border)'}`,
                      opacity: disabled ? 0.5 : 1,
                    }}>
                      <input type="checkbox" disabled={disabled}
                        checked={disabled ? false : selected}
                        onChange={() => {
                          if (disabled) return;
                          const next = new Set(selectedDates);
                          if (next.has(h.date)) next.delete(h.date);
                          else next.add(h.date);
                          setSelectedDates(next);
                        }}
                      />
                      <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--accent)', minWidth: 36 }}>
                        {h.date.slice(5).split('-').reverse().join('/')}
                      </span>
                      <span style={{ flex: 1, fontSize: 13, color: 'var(--text)' }}>{h.label}</span>
                      {h.weekday && (
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{h.weekday}</span>
                      )}
                      <ScopeBadge scope={h.scope} />
                      {h.is_fixed && (
                        <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 600, whiteSpace: 'nowrap' }}>📌 Fixo</span>
                      )}
                      {disabled && (
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>já importado</span>
                      )}
                    </label>
                  );
                })}
              </div>
              {importResult && (
                <div style={{ padding: '8px 12px', borderRadius: 8, background: '#E11D4815', color: 'var(--text)', fontSize: 13, marginBottom: 10 }}>
                  {importResult}
                </div>
              )}
              <button onClick={handleImport} disabled={importing || selectedDates.size === 0} style={{
                width: '100%', padding: '12px', borderRadius: 10, border: 'none', cursor: 'pointer',
                fontWeight: 700, fontSize: 14, background: 'var(--accent)', color: '#fff',
                opacity: selectedDates.size === 0 ? 0.5 : 1,
              }}>{importing ? 'Importando...' : `Importar ${selectedDates.size} feriado(s)`}</button>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
}
