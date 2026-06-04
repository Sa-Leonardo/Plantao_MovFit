import { useState, useEffect } from 'react';
import Badge from './Badge';
import Modal from './Modal';
import api from '../api';

// Gerador de senha aleatória (12 chars, letras+números+símbolos sem ambíguos)
function generatePassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
  const arr = new Uint32Array(length);
  (window.crypto || window.msCrypto).getRandomValues(arr);
  let out = '';
  for (let i = 0; i < length; i++) out += chars[arr[i] % chars.length];
  return out;
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch (_) {
    return false;
  }
}

const inputStyle = {
  width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)',
  background: 'var(--input-bg)', color: 'var(--text)', fontSize: 14, outline: 'none', marginBottom: 10,
};

// Formulário de usuário — declarado FORA do componente pai para não remontar a cada render
function UserForm({ form, setForm, onSave, saving, error, isEdit, onGeneratePassword, showPlainPassword }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Nome completo</label>
      <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
        placeholder="Nome de exibição" style={inputStyle}
        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
        onBlur={e => e.target.style.borderColor = 'var(--border)'}
      />
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Usuário</label>
      <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
        placeholder="nome.usuario" style={inputStyle}
        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
        onBlur={e => e.target.style.borderColor = 'var(--border)'}
      />
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
        Senha {isEdit && <span style={{ color: 'var(--text-muted)' }}>(deixe em branco para não alterar)</span>}
      </label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <input
          type={showPlainPassword ? 'text' : 'password'}
          value={form.password}
          onChange={e => setForm({ ...form, password: e.target.value })}
          placeholder={isEdit ? '(manter atual)' : 'Mínimo 8 caracteres'}
          style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
          onFocus={e => e.target.style.borderColor = 'var(--accent)'}
          onBlur={e => e.target.style.borderColor = 'var(--border)'}
        />
        <button type="button" onClick={onGeneratePassword} title="Gerar senha aleatória" style={{
          padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)',
          background: 'var(--input-bg)', color: 'var(--text)', cursor: 'pointer',
          fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
        }}>🎲 Gerar</button>
      </div>
      {form.password && !isEdit && (
        <div style={{ padding: '8px 12px', borderRadius: 8, background: '#E11D4815', border: '1px solid #E11D4830', fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
          💡 A senha será <strong style={{ color: 'var(--text)' }}>copiada automaticamente</strong> para a área de transferência ao salvar.
        </div>
      )}
      <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Nível de acesso</label>
      <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}
        style={{ ...inputStyle, cursor: 'pointer' }}>
        <option value="user">Usuário (somente visualização)</option>
        <option value="admin">Admin (acesso total)</option>
      </select>

      {error && (
        <div style={{ padding: '8px 12px', borderRadius: 8, background: '#ef444420', color: '#ef4444', fontSize: 13, marginBottom: 10 }}>{error}</div>
      )}

      <button onClick={onSave} disabled={saving} style={{
        width: '100%', padding: '12px', borderRadius: 10, border: 'none', cursor: 'pointer',
        fontWeight: 700, fontSize: 14, background: 'var(--accent)', color: '#fff'
      }}>{saving ? 'Salvando...' : (isEdit ? 'Salvar alterações' : 'Criar usuário')}</button>
    </div>
  );
}

export default function UsersPanel({ users, onUpdate, currentUserId }) {
  const [showCreate, setShowCreate] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [form, setForm] = useState({ name: '', username: '', password: '', role: 'user' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPlainPassword, setShowPlainPassword] = useState(false);
  const [copiedMsg, setCopiedMsg] = useState('');

  const [requests, setRequests] = useState([]);
  const [reqLoading, setReqLoading] = useState(false);
  const [reqActionId, setReqActionId] = useState(null);

  const [pwModal, setPwModal] = useState(false);
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');

  const loadRequests = async () => {
    setReqLoading(true);
    try {
      const data = await api.getUserRequests('pending');
      setRequests(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setReqLoading(false);
    }
  };

  useEffect(() => { loadRequests(); }, []);

  const handleApprove = async (req) => {
    setReqActionId(req.id); setError('');
    try {
      const { user: newUser } = await api.approveUserRequest(req.id);
      // Recarrega lista de usuários (parent controla) — chama onUpdate adicionando o novo
      onUpdate([...users, { ...newUser, created_at: new Date().toISOString() }]);
      setRequests(requests.filter(r => r.id !== req.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setReqActionId(null);
    }
  };

  const handleReject = async (req) => {
    if (!window.confirm(`Recusar a solicitação de "${req.name}" (${req.username})?`)) return;
    setReqActionId(req.id); setError('');
    try {
      await api.rejectUserRequest(req.id);
      setRequests(requests.filter(r => r.id !== req.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setReqActionId(null);
    }
  };

  const openCreate = () => {
    setForm({ name: '', username: '', password: '', role: 'user' });
    setError(''); setShowPlainPassword(false);
    setShowCreate(true);
  };

  const openEdit = (user) => {
    setForm({ name: user.name || '', username: user.username, password: '', role: user.role });
    setError(''); setShowPlainPassword(false);
    setEditUser(user);
  };

  const handleGenerate = () => {
    const pw = generatePassword(12);
    setForm(prev => ({ ...prev, password: pw }));
    setShowPlainPassword(true);
  };

  const flashCopied = () => {
    setCopiedMsg('✓ Senha copiada para a área de transferência');
    setTimeout(() => setCopiedMsg(''), 4000);
  };

  const handleCreate = async () => {
    if (!form.username || !form.password) { setError('Usuário e senha obrigatórios'); return; }
    setSaving(true); setError('');
    try {
      const plain = form.password;
      const created = await api.createUser(form);
      onUpdate([...users, created]);
      setShowCreate(false);
      // Copia senha ao salvar com sucesso
      const ok = await copyToClipboard(plain);
      if (ok) flashCopied();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    setSaving(true); setError('');
    const payload = { username: form.username, role: form.role, name: form.name || null };
    if (form.password) payload.password = form.password;
    try {
      const plain = form.password;
      const updated = await api.updateUser(editUser.id, payload);
      onUpdate(users.map(u => u.id === editUser.id ? { ...u, ...updated } : u));
      setEditUser(null);
      // Copia a nova senha, se alterada
      if (plain) {
        const ok = await copyToClipboard(plain);
        if (ok) flashCopied();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remover este usuário?')) return;
    try {
      await api.deleteUser(id);
      onUpdate(users.filter(u => u.id !== id));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleChangePassword = async () => {
    if (pwForm.newPassword !== pwForm.confirm) { setPwError('As senhas não coincidem'); return; }
    if (pwForm.newPassword.length < 8) { setPwError('Mínimo 8 caracteres'); return; }
    setSaving(true); setPwError(''); setPwSuccess('');
    try {
      await api.changePassword(pwForm.currentPassword, pwForm.newPassword);
      setPwSuccess('Senha alterada com sucesso!');
      setPwForm({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (err) {
      setPwError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {copiedMsg && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 2000,
          padding: '12px 18px', borderRadius: 10, background: '#22c55e', color: '#fff',
          fontSize: 13, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
        }}>{copiedMsg}</div>
      )}

      {/* Alterar minha senha */}
      <div style={{ marginBottom: 24, padding: '16px 20px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>Minha senha</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Altere sua senha de acesso</div>
          </div>
          <button onClick={() => { setPwModal(true); setPwError(''); setPwSuccess(''); }} style={{
            padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'none', cursor: 'pointer', color: 'var(--text)', fontSize: 13
          }}>Alterar senha</button>
        </div>
      </div>

      {/* Solicitações pendentes de cadastro */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
            Solicitações de cadastro
            {requests.length > 0 && (
              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: '#f59e0b20', color: '#f59e0b', border: '1px solid #f59e0b40' }}>
                {requests.length} pendente{requests.length > 1 ? 's' : ''}
              </span>
            )}
          </h3>
          <button onClick={loadRequests} disabled={reqLoading} style={{
            padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12,
          }}>{reqLoading ? '...' : '🔄 Atualizar'}</button>
        </div>

        <p style={{ margin: '0 0 10px', fontSize: 11, color: 'var(--text-muted)' }}>
          ⏳ Solicitações não aprovadas são descartadas automaticamente após 24 horas.
        </p>

        {requests.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', padding: 14, background: 'var(--row-bg)', border: '1px dashed var(--border)', borderRadius: 10 }}>
            Nenhuma solicitação pendente
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {requests.map(r => (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                borderRadius: 10, background: '#f59e0b10', border: '1px solid #f59e0b30',
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 15, color: '#fff',
                  background: `hsl(${r.username.charCodeAt(0) * 11 % 360}, 55%, 45%)`
                }}>{r.name.charAt(0).toUpperCase()}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{r.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                    usuário: <strong style={{ color: 'var(--text)' }}>{r.username}</strong>
                    {r.created_at && ` · solicitado em ${r.created_at.slice(0, 16).replace('T', ' ')}`}
                  </div>
                </div>
                <button onClick={() => handleApprove(r)} disabled={reqActionId === r.id} style={{
                  padding: '6px 12px', borderRadius: 8, border: '1px solid #22c55e40',
                  background: '#22c55e20', color: '#22c55e', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                }}>{reqActionId === r.id ? '...' : '✓ Aprovar'}</button>
                <button onClick={() => handleReject(r)} disabled={reqActionId === r.id} style={{
                  padding: '6px 12px', borderRadius: 8, border: '1px solid #ef444440',
                  background: '#ef444420', color: '#ef4444', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                }}>✕ Recusar</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lista de usuários */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Usuários do sistema</h3>
        <button onClick={openCreate} style={{
          padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer',
          fontWeight: 600, fontSize: 13, background: 'var(--accent)', color: '#fff'
        }}>+ Novo usuário</button>
      </div>

      {error && !showCreate && !editUser && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: '#ef444420', border: '1px solid #ef444440', color: '#ef4444', fontSize: 13, marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {users.map(u => (
          <div key={u.id} style={{
            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
            borderRadius: 10, background: 'var(--row-bg)', border: '1px solid var(--border)'
          }}>
            <div style={{
              width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 15, color: '#fff',
              background: `hsl(${u.username.charCodeAt(0) * 11 % 360}, 55%, 45%)`
            }}>{(u.name || u.username).charAt(0).toUpperCase()}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
                {u.name || u.username}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1, display: 'flex', gap: 6, alignItems: 'center' }}>
                {u.name && <span style={{ fontFamily: 'ui-monospace, monospace' }}>@{u.username}</span>}
                {u.id === currentUserId && <span style={{ color: 'var(--accent)' }}>● você</span>}
              </div>
            </div>
            <Badge color={u.role === 'admin' ? '#f59e0b' : '#E11D48'}>
              {u.role === 'admin' ? '👑 Admin' : '👤 Usuário'}
            </Badge>
            <button onClick={() => openEdit(u)} style={{
              background: 'none', border: '1px solid var(--border)', borderRadius: 8,
              cursor: 'pointer', padding: '5px 10px', fontSize: 12, color: 'var(--text-muted)'
            }}>✏️</button>
            {u.id !== currentUserId && (
              <button onClick={() => handleDelete(u.id)} style={{
                background: 'none', border: '1px solid #ef444440', borderRadius: 8,
                cursor: 'pointer', padding: '5px 10px', fontSize: 12, color: '#ef4444'
              }}>✕</button>
            )}
          </div>
        ))}
      </div>

      {/* Modal criar usuário */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Novo usuário">
        <UserForm
          form={form} setForm={setForm}
          onSave={handleCreate} saving={saving} error={error} isEdit={false}
          onGeneratePassword={handleGenerate}
          showPlainPassword={showPlainPassword}
        />
      </Modal>

      {/* Modal editar usuário */}
      <Modal open={!!editUser} onClose={() => setEditUser(null)} title="Editar usuário">
        <UserForm
          form={form} setForm={setForm}
          onSave={handleEdit} saving={saving} error={error} isEdit={true}
          onGeneratePassword={handleGenerate}
          showPlainPassword={showPlainPassword}
        />
      </Modal>

      {/* Modal alterar senha */}
      <Modal open={pwModal} onClose={() => setPwModal(false)} title="Alterar minha senha">
        <div>
          {['currentPassword', 'newPassword', 'confirm'].map((field, i) => (
            <div key={field}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                {i === 0 ? 'Senha atual' : i === 1 ? 'Nova senha' : 'Confirmar nova senha'}
              </label>
              <input type="password" value={pwForm[field]}
                onChange={e => setPwForm({ ...pwForm, [field]: e.target.value })}
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>
          ))}
          {pwError && <div style={{ padding: '8px 12px', borderRadius: 8, background: '#ef444420', color: '#ef4444', fontSize: 13, marginBottom: 10 }}>{pwError}</div>}
          {pwSuccess && <div style={{ padding: '8px 12px', borderRadius: 8, background: '#22c55e20', color: '#22c55e', fontSize: 13, marginBottom: 10 }}>{pwSuccess}</div>}
          <button onClick={handleChangePassword} disabled={saving} style={{
            width: '100%', padding: '12px', borderRadius: 10, border: 'none', cursor: 'pointer',
            fontWeight: 700, fontSize: 14, background: 'var(--accent)', color: '#fff'
          }}>{saving ? 'Salvando...' : 'Alterar senha'}</button>
        </div>
      </Modal>
    </div>
  );
}
