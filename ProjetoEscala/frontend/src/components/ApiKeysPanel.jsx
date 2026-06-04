import { useState, useEffect } from 'react';
import api from '../api';

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch (_) { return false; }
}

export default function ApiKeysPanel() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [revealKey, setRevealKey] = useState(null); // chave recém criada exibida uma única vez
  const [copied, setCopied] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.getApiKeys();
      setKeys(data);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!newName.trim()) { setError('Informe um nome para a chave'); return; }
    setCreating(true); setError('');
    try {
      const created = await api.createApiKey(newName.trim());
      setRevealKey({ name: created.name, key: created.key });
      setNewName('');
      await load();
    } catch (err) { setError(err.message); }
    finally { setCreating(false); }
  };

  const handleToggle = async (k) => {
    try {
      await api.updateApiKey(k.id, { active: !k.active });
      await load();
    } catch (err) { setError(err.message); }
  };

  const handleDelete = async (k) => {
    if (!window.confirm(`Revogar a chave "${k.name}"? Quem estiver usando perderá acesso imediatamente.`)) return;
    try {
      await api.deleteApiKey(k.id);
      await load();
    } catch (err) { setError(err.message); }
  };

  const copyKey = async () => {
    const ok = await copyToClipboard(revealKey.key);
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  return (
    <div style={{ marginTop: 16, padding: '16px 18px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <strong style={{ fontSize: 14, color: 'var(--text)' }}>Chaves de API</strong>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Use para integrações externas (webhooks reversos, automações, scripts). Envie a chave no header <code style={{ background: 'var(--cell-bg)', padding: '1px 6px', borderRadius: 4 }}>X-Api-Key: SUA_CHAVE</code> em qualquer requisição à API. Chaves têm privilégios equivalentes a administrador.
      </p>

      {error && (
        <div style={{ padding: '8px 12px', borderRadius: 8, background: '#ef444420', color: '#ef4444', fontSize: 13, marginBottom: 10 }}>{error}</div>
      )}

      {/* Reveal modal in-panel */}
      {revealKey && (
        <div style={{ padding: '14px 16px', borderRadius: 10, background: '#22c55e15', border: '1px solid #22c55e40', marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#22c55e', marginBottom: 6 }}>
            ✓ Chave "{revealKey.name}" criada — copie agora, não será exibida de novo:
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <code style={{
              flex: 1, padding: '10px 12px', borderRadius: 8, background: 'var(--cell-bg)',
              border: '1px solid var(--border)', fontSize: 13, color: 'var(--text)',
              fontFamily: 'ui-monospace, Menlo, monospace', wordBreak: 'break-all',
            }}>{revealKey.key}</code>
            <button onClick={copyKey} style={{
              padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)',
              background: 'var(--input-bg)', color: 'var(--text)', cursor: 'pointer', fontSize: 12, fontWeight: 600,
            }}>{copied ? '✓ Copiado' : '📋 Copiar'}</button>
          </div>
          <button onClick={() => setRevealKey(null)} style={{
            marginTop: 10, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12,
          }}>Fechar</button>
        </div>
      )}

      {/* Criar nova */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          placeholder="Nome da chave (ex: Integração n8n)"
          style={{
            flex: 1, padding: '9px 12px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'var(--input-bg)',
            color: 'var(--text)', fontSize: 13, outline: 'none',
          }}
        />
        <button onClick={handleCreate} disabled={creating} style={{
          padding: '9px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
          fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: '#fff',
        }}>{creating ? '...' : '+ Criar chave'}</button>
      </div>

      {/* Lista */}
      {loading ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Carregando...</p>
      ) : keys.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', padding: 16 }}>Nenhuma chave criada</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {keys.map(k => (
            <div key={k.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
              borderRadius: 8, background: 'var(--row-bg)', border: '1px solid var(--border)',
            }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: k.active ? '#22c55e' : '#94a3b8' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{k.name}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  Criada: {k.created_at?.slice(0, 16).replace('T', ' ')}
                  {k.last_used && ` · Último uso: ${k.last_used.slice(0, 16).replace('T', ' ')}`}
                </div>
              </div>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 6,
                background: k.active ? '#22c55e20' : '#94a3b820',
                color: k.active ? '#22c55e' : '#94a3b8' }}>
                {k.active ? 'ATIVA' : 'REVOGADA'}
              </span>
              <button onClick={() => handleToggle(k)} style={{
                padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)',
                background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11,
              }}>{k.active ? 'Desativar' : 'Ativar'}</button>
              <button onClick={() => handleDelete(k)} style={{
                padding: '4px 8px', borderRadius: 6, border: '1px solid #ef444440',
                background: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 11,
              }}>✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
