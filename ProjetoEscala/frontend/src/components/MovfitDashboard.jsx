import { normalizeOverrideMembers } from '../utils/rotation';
import { buildMovfitExports } from '../utils/movfitSchedule';

function memberColor(name) {
  return `hsl(${name.charCodeAt(0) * 7 % 360}, 55%, 50%)`;
}

function MiniCard({ title, value, tone = '#E11D48', sub }) {
  return (
    <div style={{
      background: '#141416', border: '1px solid var(--card-border)', borderRadius: 8,
      padding: '14px 16px', minWidth: 170,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
        <span style={{ fontSize: 11, textTransform: 'uppercase', fontWeight: 800, color: 'var(--text-muted)' }}>{title}</span>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: tone }} />
      </div>
      <div style={{ fontSize: 28, fontWeight: 850, color: 'var(--text)', marginTop: 8, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ color: tone, fontSize: 12, fontWeight: 700, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function imbalance(values) {
  if (!values.length) return false;
  return Math.max(...values) - Math.min(...values) > 1;
}

function StatusPill({ ok, label }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px',
      borderRadius: 999, fontSize: 11, fontWeight: 800,
      color: ok ? '#34d399' : '#f87171',
      background: ok ? '#34d39918' : '#ef444418',
      border: `1px solid ${ok ? '#34d39944' : '#ef444444'}`,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

function download(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportExcel(model) {
  const rows = buildMovfitExports(model);
  const htmlRows = rows.map(row => `<tr>${row.map(cell => `<td>${String(cell).replace(/[<>&]/g, s => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[s]))}</td>`).join('')}</tr>`).join('');
  download('escala-movfit-2026.xls', 'application/vnd.ms-excel;charset=utf-8', `<table>${htmlRows}</table>`);
}

function exportPdf(model) {
  const rows = buildMovfitExports(model).slice(1);
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`
    <html><head><title>Escala MovFit 2026</title>
    <style>
      body{font-family:Arial,sans-serif;color:#111;margin:24px}
      h1{font-size:20px;margin:0 0 16px}
      table{width:100%;border-collapse:collapse;font-size:10px}
      th,td{border:1px solid #ddd;padding:5px;text-align:left}
      th{background:#f3f4f6}
    </style></head><body>
    <h1>Escala MovFit 2026</h1>
    <table><thead><tr><th>Data</th><th>Tipo</th><th>Faixa</th><th>Horario</th><th>Colaborador</th><th>Status</th></tr></thead>
    <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>
    </body></html>
  `);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 300);
}

export default function MovfitDashboard({ model, alerts, todayStr }) {
  const { events, schedule, shifts, employees } = model;
  const criticalAlerts = alerts.filter(a => a.level === 'critical');
  const warningAlerts = alerts.filter(a => a.level !== 'critical');
  const completed = events.filter(e => e.date < todayStr);
  const next = events.find(e => e.date >= todayStr);
  const coverageOk = criticalAlerts.filter(a => /cobertura|sem cobertura/i.test(a.message)).length === 0;

  const rangeClasses = ['total', 'Sabado', 'Domingo', 'Feriado'];
  const slotClasses = ['F1', 'F2', 'F3', 'F4'];
  const hasRangeImbalance = rangeClasses.some(k => imbalance(employees.map(e => model.stats[e.id]?.[k] || 0)));
  const hasSlotImbalance = slotClasses.some(k => imbalance(employees.map(e => model.stats[e.id]?.[k] || 0)));

  const employeeById = Object.fromEntries(employees.map(e => [e.id, e]));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, color: 'var(--text)', fontSize: 18, fontWeight: 850 }}>Escala inteligente MovFit 2026</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 12 }}>
            Sabados, domingos e feriados oficiais com 4 faixas obrigatorias.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => exportExcel(model)} style={btnStyle}>Exportar Excel</button>
          <button onClick={() => exportPdf(model)} style={btnStyle}>Exportar PDF</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
        <MiniCard title="Plantões do ano" value={events.length} tone="#E11D48" sub={`${events.length * 4} posições`} />
        <MiniCard title="Próximo plantão" value={next ? next.date.slice(8, 10) + '/' + next.date.slice(5, 7) : '-'} tone="#34d399" sub={next?.type || 'Concluido'} />
        <MiniCard title="Realizados" value={completed.length} tone="#a78bfa" sub="ate hoje" />
        <MiniCard title="Feriados realizados" value={completed.filter(e => e.type === 'Feriado').length} tone="#facc15" />
        <MiniCard title="Sábados realizados" value={completed.filter(e => e.type === 'Sabado').length} tone="#E11D48" />
        <MiniCard title="Domingos realizados" value={completed.filter(e => e.type === 'Domingo').length} tone="#f472b6" />
        <MiniCard title="Cobertura" value={coverageOk ? '100%' : 'Atenção'} tone={coverageOk ? '#34d399' : '#ef4444'} />
        <MiniCard title="Conflitos" value={alerts.length} tone={criticalAlerts.length ? '#ef4444' : warningAlerts.length ? '#facc15' : '#34d399'} />
      </div>

      <section style={panelStyle}>
        <div style={sectionHeadStyle}>
          <strong>Equilibrio de plantões</strong>
          <StatusPill ok={!hasRangeImbalance} label={hasRangeImbalance ? 'Ajuste necessario' : 'Equilibrado'} />
        </div>
        <ResponsiveTable>
          <thead><tr>{['Colaborador', 'Total', 'Sábados', 'Domingos', 'Feriados'].map(h => <Th key={h}>{h}</Th>)}</tr></thead>
          <tbody>{employees.map(e => (
            <tr key={e.id}>
              <Td><Avatar employee={e} />{e.name}</Td>
              {rangeClasses.map(k => <MetricTd key={k} warn={imbalance(employees.map(x => model.stats[x.id]?.[k] || 0))}>{model.stats[e.id]?.[k] || 0}</MetricTd>)}
            </tr>
          ))}</tbody>
        </ResponsiveTable>
      </section>

      <section style={panelStyle}>
        <div style={sectionHeadStyle}>
          <strong>Distribuição das faixas</strong>
          <StatusPill ok={!hasSlotImbalance} label={hasSlotImbalance ? 'Rotacao desigual' : 'Faixas balanceadas'} />
        </div>
        <ResponsiveTable>
          <thead><tr>{['Colaborador', 'F1', 'F2', 'F3', 'F4'].map(h => <Th key={h}>{h}</Th>)}</tr></thead>
          <tbody>{employees.map(e => (
            <tr key={e.id}>
              <Td><Avatar employee={e} />{e.name}</Td>
              {slotClasses.map(k => <MetricTd key={k} warn={imbalance(employees.map(x => model.stats[x.id]?.[k] || 0))}>{model.stats[e.id]?.[k] || 0}</MetricTd>)}
            </tr>
          ))}</tbody>
        </ResponsiveTable>
      </section>

      <section style={panelStyle}>
        <div style={sectionHeadStyle}>
          <strong>Calendario anual</strong>
          <StatusPill ok={criticalAlerts.length === 0} label={criticalAlerts.length ? 'Conflitos criticos' : 'Sem violacoes criticas'} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10, maxHeight: 430, overflow: 'auto', paddingRight: 4 }}>
          {events.map(event => (
            <div key={event.date} style={{
              background: '#202024', border: '1px solid var(--border)', borderRadius: 8, padding: 12,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                <strong style={{ color: 'var(--text)', fontSize: 13 }}>{event.date.slice(8, 10)}/{event.date.slice(5, 7)}</strong>
                <span style={{ color: event.type === 'Feriado' ? '#facc15' : event.type === 'Domingo' ? '#f472b6' : '#E11D48', fontSize: 11, fontWeight: 800 }}>{event.type}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {shifts.map(shift => {
                  const ids = normalizeOverrideMembers(schedule[event.date]?.[shift.id]);
                  return (
                    <div key={shift.id} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11 }}>
                      <span style={{ width: 22, color: '#E11D48', fontWeight: 900 }}>{shift.code}</span>
                      <span style={{ color: 'var(--text-muted)', width: 70 }}>{shift.start_time}-{shift.end_time}</span>
                      <span style={{ color: ids.length === 1 ? 'var(--text)' : '#ef4444', fontWeight: 700 }}>
                        {ids.map(id => employeeById[id]?.name || id).join(', ') || 'Sem cobertura'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      {alerts.length > 0 && (
        <section style={panelStyle}>
          <div style={sectionHeadStyle}><strong>Alertas automaticos</strong></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {alerts.slice(0, 20).map((alert, idx) => (
              <div key={idx} style={{
                padding: '9px 11px', borderRadius: 8,
                border: `1px solid ${alert.level === 'critical' ? '#ef444455' : '#facc1555'}`,
                background: alert.level === 'critical' ? '#ef444414' : '#facc1514',
                color: alert.level === 'critical' ? '#f87171' : '#facc15',
                fontSize: 12, fontWeight: 700,
              }}>
                {alert.date ? `${alert.date} - ` : ''}{alert.employee ? `${alert.employee}: ` : ''}{alert.message}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const btnStyle = {
  padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)',
  background: '#202024', color: 'var(--text)', cursor: 'pointer', fontSize: 12, fontWeight: 800,
};

const panelStyle = {
  background: '#141416', border: '1px solid var(--card-border)', borderRadius: 8, padding: 14,
};

const sectionHeadStyle = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  marginBottom: 12, color: 'var(--text)', fontSize: 14,
};

function ResponsiveTable({ children }) {
  return <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>{children}</table></div>;
}

function Th({ children }) {
  return <th style={{ textAlign: 'left', padding: '9px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontWeight: 850 }}>{children}</th>;
}

function Td({ children }) {
  return <td style={{ padding: '9px 10px', borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>{children}</td>;
}

function MetricTd({ children, warn }) {
  return <td style={{ padding: '9px 10px', borderBottom: '1px solid var(--border)', color: warn ? '#facc15' : 'var(--text)', fontWeight: 850 }}>{children}</td>;
}

function Avatar({ employee }) {
  return (
    <span style={{
      display: 'inline-flex', width: 22, height: 22, borderRadius: '50%', marginRight: 8,
      alignItems: 'center', justifyContent: 'center', background: memberColor(employee.name),
      color: '#fff', fontSize: 10, fontWeight: 900,
    }}>{employee.name.charAt(0)}</span>
  );
}
