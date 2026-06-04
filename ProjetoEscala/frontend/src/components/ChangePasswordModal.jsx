import { useState } from 'react';
import Modal from './Modal';
import api from '../api';

const inputStyle = {
  width: '100%', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)',
  background: 'var(--input-bg)', color: 'var(--text)', fontSize: 14, outline: 'none', marginBottom: 10,
};

export default function ChangePasswordModal({ open, onClose }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  const handleClose = () => {
    setForm({ currentPassword: '', newPassword: '', confirm: '' });
    setError(''); setSuccess('');
    onClose();
  };

  const handleSubmit = async () => {
    if (form.newPassword !== form.confirm) { setError('As senhas não coincidem'); return; }
    if (form.newPassword.length < 8) { setError('Mínimo 8 caracteres'); return; }
    setSaving(true); setError(''); setSuccess('');
    try {
      await api.changePassword(form.currentPassword, form.newPassword);
      setSuccess('Senha alterada com sucesso!');
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      setTimeout(() => handleClose(), 1500);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Alterar minha senha">
      <div>
        {[
          { key: 'currentPassword', label: 'Senha atual' },
          { key: 'newPassword', label: 'Nova senha' },
          { key: 'confirm', label: 'Confirmar nova senha' },
        ].map(({ key, label }) => (
          <div key={key}>
            <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
              {label}
            </label>
            <input type="password" value={form[key]}
              onChange={e => setForm({ ...form, [key]: e.target.value })}
              style={inputStyle}
              onFocus={e => e.target.style.borderColor = 'var(--accent)'}
              onBlur={e => e.target.style.borderColor = 'var(--border)'}
            />
          </div>
        ))}
        {error && <div style={{ padding: '8px 12px', borderRadius: 8, background: '#ef444420', color: '#ef4444', fontSize: 13, marginBottom: 10 }}>{error}</div>}
        {success && <div style={{ padding: '8px 12px', borderRadius: 8, background: '#22c55e20', color: '#22c55e', fontSize: 13, marginBottom: 10 }}>{success}</div>}
        <button onClick={handleSubmit} disabled={saving} style={{
          width: '100%', padding: '12px', borderRadius: 10, border: 'none', cursor: 'pointer',
          fontWeight: 700, fontSize: 14, background: 'var(--accent)', color: '#fff'
        }}>{saving ? 'Salvando...' : 'Alterar senha'}</button>
      </div>
    </Modal>
  );
}
