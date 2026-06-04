import { useState } from 'react';
import api from '../api';
import ApiKeysPanel from './ApiKeysPanel';
import BackupPanel from './BackupPanel';

export default function SettingsPanel({ settings, onUpdate, isAdmin }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearMsg, setClearMsg] = useState('');

  const updateSetting = async (key, value) => {
    if (!isAdmin) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      const updated = await api.updateSettings({ [key]: value });
      onUpdate(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const clearHistory = async () => {
    if (!window.confirm('Isso apagará todos os snapshots de escala já consolidados. Tem certeza?')) return;
    setClearing(true); setClearMsg(''); setError('');
    try {
      const { removed } = await api.clearAllSnapshots();
      setClearMsg(`${removed} registro(s) de histórico removidos. A página recarregará.`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setError(err.message);
    } finally {
      setClearing(false);
    }
  };

  const resetStartDate = async () => {
    if (!window.confirm('Isso redefine a data de início do histórico para hoje e apaga todos os snapshots anteriores. Continuar?')) return;
    setClearing(true); setClearMsg(''); setError('');
    try {
      const today = new Date();
      const ds = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      await api.clearSnapshotsBefore(ds);
      const updated = await api.updateSettings({ schedule_start_date: ds });
      onUpdate(updated);
      setClearMsg(`Início do histórico redefinido para ${ds}. Recarregando...`);
      setTimeout(() => window.location.reload(), 1200);
    } catch (err) {
      setError(err.message);
    } finally {
      setClearing(false);
    }
  };

  const compensatoryRest = !!settings?.compensatory_monday_rest;
  const historyStart = settings?.schedule_start_date || '(não definido)';

  return (
    <div>
      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)' }}>
        Configurações globais que afetam a geração da escala.
      </p>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: '#ef444420', color: '#ef4444', fontSize: 13, marginBottom: 14 }}>
          {error}
        </div>
      )}
      {saved && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: '#22c55e20', color: '#22c55e', fontSize: 13, marginBottom: 14 }}>
          ✓ Configuração atualizada
        </div>
      )}
      {clearMsg && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: '#22c55e20', color: '#22c55e', fontSize: 13, marginBottom: 14 }}>
          {clearMsg}
        </div>
      )}

      {/* Folga compensatória */}
      <div style={{
        padding: '16px 18px', borderRadius: 12,
        border: '1px solid var(--border)', background: 'var(--surface)',
        display: 'flex', alignItems: 'flex-start', gap: 14,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <strong style={{ fontSize: 14, color: 'var(--text)' }}>Folga compensatória após domingo</strong>
            {compensatoryRest && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: '#22c55e20', color: '#22c55e', border: '1px solid #22c55e40' }}>
                ATIVA
              </span>
            )}
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Quando ativada, atendentes que trabalharam em um <strong>plantão de domingo</strong> ficam
            automaticamente impossibilitados de trabalhar em um <strong>feriado que caia na segunda-feira</strong> imediatamente seguinte.
            Também afeta o modal de edição manual, indicando quando alguém deveria estar de folga.
          </p>
        </div>

        <label style={{ display: 'inline-flex', alignItems: 'center', cursor: isAdmin ? 'pointer' : 'not-allowed', flexShrink: 0 }}>
          <input
            type="checkbox"
            checked={compensatoryRest}
            disabled={!isAdmin || saving}
            onChange={(e) => updateSetting('compensatory_monday_rest', e.target.checked)}
            style={{ display: 'none' }}
          />
          <span style={{
            width: 44, height: 24, borderRadius: 12,
            background: compensatoryRest ? 'var(--accent)' : 'var(--border)',
            position: 'relative', transition: 'background 0.2s',
            opacity: !isAdmin ? 0.5 : 1,
          }}>
            <span style={{
              position: 'absolute', top: 2, left: compensatoryRest ? 22 : 2,
              width: 20, height: 20, borderRadius: '50%', background: '#fff',
              transition: 'left 0.2s',
            }} />
          </span>
        </label>
      </div>

      {/* Histórico / snapshots */}
      <div style={{
        marginTop: 16, padding: '16px 18px', borderRadius: 12,
        border: '1px solid var(--border)', background: 'var(--surface)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <strong style={{ fontSize: 14, color: 'var(--text)' }}>Histórico da escala</strong>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: '#E11D4820', color: 'var(--accent)', border: '1px solid #E11D4840' }}>
            Início: {historyStart}
          </span>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          O sistema só considera escalas a partir da <strong>data de início do histórico</strong>. Datas anteriores não são
          geradas nem persistidas — como se o sistema ainda não existisse. Conforme os dias passam, as escalas geradas
          são automaticamente consolidadas e viram imutáveis.
        </p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={resetStartDate} disabled={!isAdmin || clearing} style={{
            padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--input-bg)', color: 'var(--text)', fontSize: 12, fontWeight: 600,
            cursor: isAdmin && !clearing ? 'pointer' : 'not-allowed', opacity: !isAdmin ? 0.5 : 1,
          }}>
            🔄 Redefinir início para hoje
          </button>
          <button onClick={clearHistory} disabled={!isAdmin || clearing} style={{
            padding: '8px 14px', borderRadius: 8, border: '1px solid #ef444440',
            background: '#ef444415', color: '#ef4444', fontSize: 12, fontWeight: 600,
            cursor: isAdmin && !clearing ? 'pointer' : 'not-allowed', opacity: !isAdmin ? 0.5 : 1,
          }}>
            🗑️ Limpar TODO o histórico
          </button>
        </div>
      </div>

      {isAdmin && <ApiKeysPanel />}

      {isAdmin && <BackupPanel />}

      {!isAdmin && (
        <p style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          Somente administradores podem alterar configurações.
        </p>
      )}
    </div>
  );
}
