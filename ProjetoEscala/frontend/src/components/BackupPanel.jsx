import { useState, useEffect, useRef } from 'react';
import api from '../api';

async function downloadWithAuth(url, fallbackFilename) {
  const token = localStorage.getItem('escala_token');
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try { const data = await res.json(); if (data.error) msg = data.error; } catch (_) {}
    throw new Error(msg);
  }
  const cd = res.headers.get('content-disposition') || '';
  const match = /filename="?([^"]+)"?/.exec(cd);
  const filename = match ? match[1] : fallbackFilename;
  const blob = await res.blob();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 100);
}

async function postBinary(url, buf) {
  const token = localStorage.getItem('escala_token');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
    },
    body: buf,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

function fmtSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR');
}

export default function BackupPanel() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [autoBackups, setAutoBackups] = useState([]);
  const [preview, setPreview] = useState(null); // { meta, buffer }
  const [fileName, setFileName] = useState('');
  const fileRef = useRef(null);

  const loadAutoBackups = async () => {
    try {
      const list = await api.listAutoBackups();
      setAutoBackups(list);
    } catch (err) {
      // silencioso
    }
  };

  useEffect(() => { loadAutoBackups(); }, []);

  const handleDownload = async () => {
    setBusy(true); setError(''); setMsg('');
    try {
      await downloadWithAuth('/api/backup', 'escala-backup.db');
      setMsg('✓ Backup baixado com sucesso');
      setTimeout(() => setMsg(''), 4000);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) { setPreview(null); setFileName(''); return; }
    if (!file.name.toLowerCase().endsWith('.db')) {
      setError('O arquivo deve ter extensão .db');
      return;
    }
    setBusy(true); setError(''); setMsg(''); setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const meta = await postBinary('/api/backup/preview', buf);
      setPreview({ meta, buffer: buf });
    } catch (err) {
      setError(err.message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!preview) return;
    if (!window.confirm(`Restaurar o backup "${fileName}"? Isso SUBSTITUI todo o banco atual. Confirma?`)) return;
    setBusy(true); setError('');
    try {
      const data = await postBinary('/api/backup/restore', preview.buffer);
      setMsg((data.message || 'Restauração iniciada.') + ' Recarregando em 6s...');
      setTimeout(() => window.location.reload(), 6000);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const clearPreview = () => {
    setPreview(null); setFileName('');
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div style={{
      marginTop: 16, padding: '16px 18px', borderRadius: 12,
      border: '1px solid var(--border)', background: 'var(--surface)',
    }}>
      <strong style={{ fontSize: 14, color: 'var(--text)' }}>Backup & Restauração</strong>
      <p style={{ margin: '4px 0 12px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Exporte o estado do sistema em um arquivo único para migração ou preservação histórica.
      </p>

      {error && <div style={{ padding: '8px 12px', borderRadius: 8, background: '#ef444420', color: '#ef4444', fontSize: 13, marginBottom: 10 }}>{error}</div>}
      {msg && <div style={{ padding: '8px 12px', borderRadius: 8, background: '#22c55e20', color: '#22c55e', fontSize: 13, marginBottom: 10 }}>{msg}</div>}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <button onClick={handleDownload} disabled={busy} style={{
          padding: '9px 16px', borderRadius: 8, border: '1px solid var(--border)',
          background: 'var(--accent)', color: '#fff', cursor: 'pointer',
          fontSize: 13, fontWeight: 600,
        }}>
          {busy ? '...' : '⬇️ Baixar backup agora'}
        </button>

        <div style={{ height: 28, width: 1, background: 'var(--border)' }} />

        <input ref={fileRef} type="file" accept=".db" onChange={handleFileChange}
          style={{ fontSize: 12, color: 'var(--text-muted)' }} />
      </div>

      {/* Preview / confirmação */}
      {preview && (
        <div style={{
          padding: '14px 16px', borderRadius: 10,
          background: '#E11D4810', border: '1px solid #E11D4830', marginBottom: 12,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 4 }}>
                📦 Conteúdo do backup
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                {fileName} · {fmtSize(preview.meta.file_size_bytes)}
              </div>
            </div>
            <button onClick={clearPreview} style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 6,
              cursor: 'pointer', padding: '4px 10px', fontSize: 11, color: 'var(--text-muted)',
            }}>Cancelar</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6, marginBottom: 10 }}>
            {[
              ['Usuários', preview.meta.users, '#E11D48'],
              ['Equipe de plantão', preview.meta.team_members, '#22c55e'],
              ['Colaboradores', preview.meta.colaboradores, '#22c55e'],
              ['Turnos', preview.meta.shifts, '#f59e0b'],
              ['Feriados', preview.meta.holidays, '#f59e0b'],
              ['Overrides', preview.meta.overrides, '#E11D48'],
              ['Ausências', preview.meta.absences, '#ef4444'],
              ['Snapshots', preview.meta.snapshots, '#94a3b8'],
              ['Webhooks', preview.meta.webhooks, '#BE123C'],
              ['API Keys', preview.meta.api_keys, '#BE123C'],
            ].map(([label, count, color]) => (
              <div key={label} style={{ padding: '6px 10px', borderRadius: 6, background: 'var(--row-bg)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color }}>{count}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{label}</div>
              </div>
            ))}
          </div>

          {preview.meta.admin_usernames?.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              <strong style={{ color: 'var(--text)' }}>Admins no backup:</strong>{' '}
              {preview.meta.admin_usernames.map(u => <code key={u} style={{ background: 'var(--cell-bg)', padding: '1px 6px', borderRadius: 3, marginRight: 4 }}>{u}</code>)}
            </div>
          )}
          {preview.meta.schedule_range && (preview.meta.schedule_range.from || preview.meta.schedule_range.to) && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              <strong style={{ color: 'var(--text)' }}>Histórico salvo:</strong>{' '}
              {preview.meta.schedule_range.from} → {preview.meta.schedule_range.to}
            </div>
          )}

          <button onClick={handleConfirmRestore} disabled={busy} style={{
            width: '100%', padding: '11px', borderRadius: 8, border: '1px solid #ef444440',
            background: '#ef444420', color: '#ef4444', cursor: 'pointer', fontSize: 13, fontWeight: 700,
          }}>
            {busy ? '...' : '⚠️ Substituir banco atual por este backup'}
          </button>
        </div>
      )}

      <div style={{ padding: '10px 12px', borderRadius: 8, background: '#f59e0b15', border: '1px solid #f59e0b30', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 12 }}>
        💡 <strong style={{ color: 'var(--text)' }}>Migrar de servidor:</strong> baixe o backup, instale o app limpo no novo servidor, faça login como admin e use "Restaurar". O servidor reinicia automaticamente.
      </div>

      {/* Backups automáticos */}
      <div style={{ paddingTop: 10, borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <strong style={{ fontSize: 13, color: 'var(--text)' }}>Backups automáticos (últimos 7)</strong>
          <button onClick={loadAutoBackups} style={{
            padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)',
            background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11,
          }}>🔄</button>
        </div>
        <p style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--text-muted)' }}>
          Gerados diariamente às 03:15 (fuso local). Salvos no servidor em <code>data/backups/</code>.
        </p>
        {autoBackups.length === 0 ? (
          <div style={{ padding: 12, textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', background: 'var(--row-bg)', borderRadius: 8 }}>
            Ainda não há backups automáticos — o primeiro rodará em breve.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflow: 'auto' }}>
            {autoBackups.map(b => (
              <div key={b.name} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px',
                borderRadius: 6, background: 'var(--row-bg)', border: '1px solid var(--border)', fontSize: 12,
              }}>
                <span style={{ fontFamily: 'monospace', color: 'var(--text)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.name}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{fmtDate(b.mtime)}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11, minWidth: 60, textAlign: 'right' }}>{fmtSize(b.size)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
