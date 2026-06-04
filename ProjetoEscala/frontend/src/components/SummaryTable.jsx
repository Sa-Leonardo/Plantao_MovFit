import { parseDateStr, normalizeOverrideMembers, isSunday, isHoliday } from '../utils/rotation';

function memberColor(name) {
  return `hsl(${name.charCodeAt(0) * 7 % 360}, 55%, 50%)`;
}

export default function SummaryTable({ team, schedule, shifts, sundayCounts = {}, holidayCounts = {}, holidays = [] }) {
  const activeTeam = team.filter(m => m.active);
  if (activeTeam.length === 0) return null;

  return (
    <div style={{ marginTop: 20 }}>
      <h4 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
        Resumo do mês — Domingos &amp; Feriados
      </h4>
      <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--row-bg)' }}>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: 'var(--text)', borderBottom: '1px solid var(--border)' }}>Atendente</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: 'var(--text)', borderBottom: '1px solid var(--border)' }}>Turno</th>
              <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, color: 'var(--text)', borderBottom: '1px solid var(--border)' }} title="Domingos neste mês">Dom. mês</th>
              <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, color: 'var(--text)', borderBottom: '1px solid var(--border)' }} title="Feriados neste mês">Fer. mês</th>
              <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, color: 'var(--sunday)', borderBottom: '1px solid var(--border)' }} title="Total acumulado de domingos">Σ Domingos</th>
              <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, color: 'var(--holiday-text)', borderBottom: '1px solid var(--border)' }} title="Total acumulado de feriados">Σ Feriados</th>
              <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: 'var(--text)', borderBottom: '1px solid var(--border)' }}>Dias escalados</th>
            </tr>
          </thead>
          <tbody>
            {activeTeam.map(m => {
              const sundayDays = [];
              const holidayDays = [];
              Object.entries(schedule).forEach(([ds, day]) => {
                const allIds = Object.values(day).flatMap(v => normalizeOverrideMembers(v));
                if (!allIds.includes(m.id)) return;
                const dateNum = parseDateStr(ds).getDate();
                if (isSunday(ds)) sundayDays.push(dateNum);
                else if (isHoliday(ds, holidays)) holidayDays.push(dateNum);
              });
              const allDays = [...new Set([...sundayDays, ...holidayDays])].sort((a, b) => a - b);
              return (
                <tr key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{
                        width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700, color: '#fff', background: memberColor(m.name)
                      }}>{m.name.charAt(0).toUpperCase()}</div>
                      {m.name}
                    </div>
                  </td>
                  <td style={{ padding: '8px 14px', color: 'var(--text-muted)', fontSize: 12 }}>{m.shift?.label || '—'}</td>
                  <td style={{ padding: '8px 14px', textAlign: 'center', fontWeight: 700, color: 'var(--sunday)' }}>{sundayDays.length}</td>
                  <td style={{ padding: '8px 14px', textAlign: 'center', fontWeight: 700, color: 'var(--holiday-text)' }}>{holidayDays.length}</td>
                  <td style={{ padding: '8px 14px', textAlign: 'center', fontWeight: 600, color: 'var(--text-muted)' }}>{sundayCounts[m.id] ?? '—'}</td>
                  <td style={{ padding: '8px 14px', textAlign: 'center', fontWeight: 600, color: 'var(--text-muted)' }}>{holidayCounts[m.id] ?? '—'}</td>
                  <td style={{ padding: '8px 14px', color: 'var(--text-muted)' }}>{allDays.join(', ') || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
        * Σ Domingos / Σ Feriados = totais acumulados independentes usados para a fairness. Membros com menor total em cada categoria têm prioridade nos próximos plantões do respectivo tipo.
      </p>
    </div>
  );
}
