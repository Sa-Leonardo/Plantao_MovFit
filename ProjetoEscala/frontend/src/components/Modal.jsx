import { useEffect } from 'react';

export default function Modal({ open, onClose, title, children }) {
  // Fecha com Esc e marca presença para o gerenciador de atalhos globais
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div data-modal-open="true" role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} />
      <div onClick={e => e.stopPropagation()} style={{
        position: 'relative', background: 'var(--surface)', borderRadius: 16, padding: '28px 32px',
        minWidth: 360, maxWidth: 520, width: '90%', boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
        border: '1px solid var(--border)', maxHeight: '85vh', overflow: 'auto'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{title}</h3>
          <button onClick={onClose} title="Fechar (Esc)" style={{
            background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)',
            width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8
          }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
