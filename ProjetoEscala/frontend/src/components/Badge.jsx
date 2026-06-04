export default function Badge({ color, children }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20,
      fontSize: 11, fontWeight: 600, letterSpacing: 0.3,
      background: `${color}18`, color: color, border: `1px solid ${color}30`
    }}>{children}</span>
  );
}
