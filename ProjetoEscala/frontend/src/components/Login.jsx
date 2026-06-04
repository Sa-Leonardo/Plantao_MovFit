import { useState, useEffect } from 'react';
import api, { setToken } from '../api';

export default function Login({ onLogin }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [usernameCheck, setUsernameCheck] = useState({ state: 'idle', msg: '' });

  const reset = () => {
    setUsername(''); setPassword(''); setName(''); setConfirm('');
    setError(''); setSuccess(''); setUsernameCheck({ state: 'idle', msg: '' });
  };

  // Validação em tempo real do username (apenas no modo registro)
  useEffect(() => {
    if (mode !== 'register') { setUsernameCheck({ state: 'idle', msg: '' }); return; }
    const u = username.trim().toLowerCase();
    if (!u) { setUsernameCheck({ state: 'idle', msg: '' }); return; }
    setUsernameCheck({ state: 'checking', msg: 'Verificando...' });
    const timer = setTimeout(async () => {
      try {
        const result = await api.checkUsername(u);
        if (result.available) {
          setUsernameCheck({ state: 'ok', msg: '✓ Disponível' });
        } else {
          setUsernameCheck({ state: 'error', msg: result.reason || 'Indisponível' });
        }
      } catch (err) {
        setUsernameCheck({ state: 'error', msg: err.message || 'Erro ao verificar' });
      }
    }, 400); // debounce
    return () => clearTimeout(timer);
  }, [username, mode]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    if (!username.trim() || !password) { setError('Preencha usuário e senha'); return; }
    setLoading(true);
    try {
      const data = await api.login(username.trim(), password);
      setToken(data.token);
      onLogin(data.user);
    } catch (err) {
      setError(err.message || 'Erro ao fazer login');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    if (!name.trim() || !username.trim() || !password) { setError('Preencha todos os campos'); return; }
    if (password.length < 8) { setError('A senha precisa ter pelo menos 8 caracteres'); return; }
    if (password !== confirm) { setError('As senhas não coincidem'); return; }
    if (usernameCheck.state !== 'ok') {
      setError(usernameCheck.msg && usernameCheck.state === 'error' ? usernameCheck.msg : 'Verifique se o nome de usuário está disponível');
      return;
    }
    setLoading(true);
    try {
      await api.requestRegister({ name: name.trim(), username: username.trim(), password });
      setSuccess('Solicitação enviada! Aguarde a aprovação do administrador.');
      setTimeout(() => { setMode('login'); reset(); }, 2500);
    } catch (err) {
      setError(err.message || 'Erro ao solicitar cadastro');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: '100%', padding: '12px 16px', borderRadius: 10,
    border: '1px solid var(--border)', background: 'var(--input-bg)',
    color: 'var(--text)', fontSize: 15, outline: 'none',
    transition: 'border 0.2s',
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: 'var(--bg)', padding: 24
    }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 20, padding: '40px 36px', width: '100%', maxWidth: 400,
        boxShadow: '0 24px 80px rgba(0,0,0,0.4)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: 'linear-gradient(135deg, #E11D48, #BE123C)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28, margin: '0 auto 16px'
          }}>📅</div>
          <h1 style={{
            margin: 0, fontSize: 22, fontWeight: 800,
            background: 'linear-gradient(135deg, #e8ecf4, #E11D48)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent'
          }}>Escala de Suporte</h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            {mode === 'login' ? 'Faça login para continuar' : 'Solicite uma conta de leitura'}
          </p>
        </div>

        {mode === 'login' ? (
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Usuário</label>
              <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                placeholder="seu.usuario" autoComplete="username" style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Senha</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" autoComplete="current-password" style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>

            {error && (
              <div style={{ padding: '10px 14px', borderRadius: 10, background: '#ef444420', border: '1px solid #ef444440', color: '#ef4444', fontSize: 13, fontWeight: 500 }}>{error}</div>
            )}

            <button type="submit" disabled={loading} style={{
              padding: '13px 24px', borderRadius: 10, border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 15,
              background: loading ? 'var(--border)' : 'linear-gradient(135deg, #E11D48, #BE123C)',
              color: '#fff', marginTop: 4, transition: 'all 0.2s', opacity: loading ? 0.7 : 1,
            }}>{loading ? 'Entrando...' : 'Entrar'}</button>

            <div style={{ textAlign: 'center', marginTop: 10, fontSize: 13, color: 'var(--text-muted)' }}>
              Não tem conta?{' '}
              <button type="button" onClick={() => { setMode('register'); reset(); }} style={{
                background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer',
                fontSize: 13, fontWeight: 700, padding: 0, textDecoration: 'underline',
              }}>Cadastre-se</button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Nome completo</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="Seu nome" style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Usuário</label>
              <input type="text" value={username}
                onChange={e => setUsername(e.target.value.toLowerCase())}
                placeholder="seu.usuario" autoComplete="username"
                style={{
                  ...inputStyle,
                  borderColor: usernameCheck.state === 'ok' ? '#22c55e'
                    : usernameCheck.state === 'error' ? '#ef4444'
                    : 'var(--border)',
                }}
                onFocus={e => {
                  if (usernameCheck.state === 'idle') e.target.style.borderColor = 'var(--accent)';
                }}
              />
              {usernameCheck.state !== 'idle' && (
                <div style={{
                  marginTop: 6, fontSize: 11, fontWeight: 600,
                  color: usernameCheck.state === 'ok' ? '#22c55e'
                    : usernameCheck.state === 'error' ? '#ef4444'
                    : 'var(--text-muted)',
                }}>{usernameCheck.msg}</div>
              )}
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Senha</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="Mínimo 8 caracteres" autoComplete="new-password" style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Confirmar senha</label>
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                placeholder="••••••••" autoComplete="new-password" style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
            </div>

            <div style={{ padding: '10px 14px', borderRadius: 10, background: '#E11D4815', border: '1px solid #E11D4830', fontSize: 12, color: 'var(--text-muted)' }}>
              ℹ️ Um administrador precisa aprovar antes do primeiro acesso.
            </div>

            {error && <div style={{ padding: '10px 14px', borderRadius: 10, background: '#ef444420', border: '1px solid #ef444440', color: '#ef4444', fontSize: 13, fontWeight: 500 }}>{error}</div>}
            {success && <div style={{ padding: '10px 14px', borderRadius: 10, background: '#22c55e20', border: '1px solid #22c55e40', color: '#22c55e', fontSize: 13, fontWeight: 500 }}>{success}</div>}

            <button type="submit" disabled={loading} style={{
              padding: '13px 24px', borderRadius: 10, border: 'none',
              cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 15,
              background: loading ? 'var(--border)' : 'linear-gradient(135deg, #E11D48, #BE123C)',
              color: '#fff', marginTop: 4, transition: 'all 0.2s', opacity: loading ? 0.7 : 1,
            }}>{loading ? 'Enviando...' : 'Solicitar cadastro'}</button>

            <div style={{ textAlign: 'center', marginTop: 6, fontSize: 13, color: 'var(--text-muted)' }}>
              Já tem conta?{' '}
              <button type="button" onClick={() => { setMode('login'); reset(); }} style={{
                background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer',
                fontSize: 13, fontWeight: 700, padding: 0, textDecoration: 'underline',
              }}>Entrar</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
