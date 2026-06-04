import { useState, useEffect, useMemo, useRef } from 'react';
import api, { getToken, setToken } from './api';
import Login from './components/Login';
import Calendar from './components/Calendar';
import TeamPanel from './components/TeamPanel';
import ColaboradoresPanel from './components/ColaboradoresPanel';
import HolidayPanel from './components/HolidayPanel';
import ShiftPanel from './components/ShiftPanel';
import SummaryTable from './components/SummaryTable';
import UsersPanel from './components/UsersPanel';
import AbsencePanel from './components/AbsencePanel';
import WebhookPanel from './components/WebhookPanel';
import SettingsPanel from './components/SettingsPanel';
import ChangePasswordModal from './components/ChangePasswordModal';
import Icon from './components/Icon';
import { generateRotation, dStr, isSunday } from './utils/rotation';
import { generateMovfitAnnualSchedule, validateMovfitSchedule, MOVFIT_YEAR } from './utils/movfitSchedule';
import MovfitDashboard from './components/MovfitDashboard';

const MONTHS_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const THEMES = {
  dark: {
    '--bg': '#09090B', '--surface': '#141416', '--sidebar': '#09090B', '--cell-bg': '#141416',
    '--row-bg': '#ffffff06', '--border': '#27272A', '--text': '#f8fafc',
    '--text-muted': '#a1a1aa', '--accent': '#E11D48', '--accent-2': '#BE123C',
    '--brand': '#E11D48', '--brand-hover': '#BE123C',
    '--sunday': '#f472b6', '--holiday-text': '#fbbf24', '--success': '#34d399',
    '--special-bg': '#202024', '--special-border': '#E11D4840',
    '--hover': '#202024', '--input-bg': '#202024', '--row-inactive': '#101014',
    '--card-border': '#27272A',
  },
  light: {
    '--bg': '#f5f7fb', '--surface': '#ffffff', '--sidebar': '#ffffff', '--cell-bg': '#ffffff',
    '--row-bg': '#00000005', '--border': '#e2e6f0', '--text': '#111827',
    '--text-muted': '#6b7280', '--accent': '#E11D48', '--accent-2': '#BE123C',
    '--brand': '#E11D48', '--brand-hover': '#BE123C',
    '--sunday': '#db2777', '--holiday-text': '#b45309', '--success': '#16a34a',
    '--special-bg': '#f3efff', '--special-border': '#E11D4840',
    '--hover': '#f0f2f7', '--input-bg': '#f8fafc', '--row-inactive': '#f5f7fb',
    '--card-border': '#e2e6f0',
  },
};

export default function App() {
  const [authState, setAuthState] = useState('loading');
  const [user, setUser] = useState(null);

  const [team, setTeam] = useState([]);
  const [colaboradores, setColaboradores] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [overrides, setOverrides] = useState({});
  const [absences, setAbsences] = useState([]);
  const [users, setUsers] = useState([]);
  const [webhooks, setWebhooks] = useState([]);
  const [settings, setSettings] = useState({});
  const [snapshots, setSnapshots] = useState({});
  const [initialCounts, setInitialCounts] = useState({ sundayCounts: {}, holidayCounts: {} });
  const [prevMonthSnapshots, setPrevMonthSnapshots] = useState({});
  const [dataLoaded, setDataLoaded] = useState(false);

  const [tab, setTab] = useState('calendar');
  const [showPwModal, setShowPwModal] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('escala_theme') || 'dark');
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 900);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncedFlash, setSyncedFlash] = useState(false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const CSS_VARS = THEMES[theme] || THEMES.dark;
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    localStorage.setItem('escala_theme', next);
  };
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    const token = getToken();
    if (!token) { setAuthState('unauthenticated'); return; }
    api.me().then(data => {
      setUser(data.user);
      setAuthState('authenticated');
    }).catch(() => {
      setToken(null);
      setAuthState('unauthenticated');
    });
  }, []);

  useEffect(() => {
    if (authState !== 'authenticated') return;
    (async () => {
      const settle = async (label, promise, fallback) => {
        try { return await promise; }
        catch (err) {
          console.error(`Erro ao carregar ${label}:`, err);
          return fallback;
        }
      };

      const [t, c, h, s, o, a, st] = await Promise.all([
        settle('equipe', api.getTeam(), []),
        settle('colaboradores', api.getColaboradores(), []),
        settle('feriados', api.getHolidays(), []),
        settle('turnos', api.getShifts(), []),
        settle('ajustes manuais', api.getOverrides(), {}),
        settle('ausencias', api.getAbsences(), []),
        settle('configuracoes', api.getSettings(), {}),
      ]);
      setTeam(t); setColaboradores(c); setHolidays(h); setShifts(s); setOverrides(o); setAbsences(a);
      setSettings(st || {});
      if (isAdmin) {
        const [u, wh] = await Promise.all([
          settle('usuarios', api.getUsers(), []),
          settle('webhooks', api.getWebhooks(), []),
        ]);
        setUsers(u); setWebhooks(wh);
      }
      setDataLoaded(true);
    })();
  }, [authState, isAdmin]);

  const handleLogout = () => {
    setToken(null); setUser(null); setAuthState('unauthenticated'); setDataLoaded(false);
    setTeam([]); setColaboradores([]); setHolidays([]); setShifts([]); setOverrides({});
    setAbsences([]); setUsers([]); setWebhooks([]);
    setSettings({}); setSnapshots({});
  };

  // Ref que acompanha o mês atualmente visualizado. Usado para descartar
  // respostas de API tardias (race condition) quando o user navega rápido.
  const currentMonthKeyRef = useRef(`${viewYear}-${viewMonth}`);
  useEffect(() => { currentMonthKeyRef.current = `${viewYear}-${viewMonth}`; }, [viewYear, viewMonth]);

  // Busca snapshots do mês visualizado e também do mês anterior
  // (necessário p/ regra de folga compensatória quando o 1º dia do mês é feriado na segunda).
  useEffect(() => {
    if (!dataLoaded) return;
    const effectKey = `${viewYear}-${viewMonth}`;
    api.getScheduleSnapshots(viewYear, viewMonth + 1)
      .then(snaps => {
        if (currentMonthKeyRef.current !== effectKey) return; // usuário já navegou
        setSnapshots(snaps || {});
      })
      .catch(err => {
        if (currentMonthKeyRef.current !== effectKey) return;
        console.error('Erro ao buscar snapshots:', err); setSnapshots({});
      });
    const prevY = viewMonth === 0 ? viewYear - 1 : viewYear;
    const prevM = viewMonth === 0 ? 12 : viewMonth;
    api.getScheduleSnapshots(prevY, prevM)
      .then(snaps => {
        if (currentMonthKeyRef.current !== effectKey) return;
        setPrevMonthSnapshots(snaps || {});
      })
      .catch(() => {
        if (currentMonthKeyRef.current !== effectKey) return;
        setPrevMonthSnapshots({});
      });
  }, [viewYear, viewMonth, dataLoaded]);

  // Busca contadores históricos ANTES do mês visualizado — semente da fairness.
  // NÃO depende de `snapshots` porque /counts usa `before=firstOfMonth` e por
  // isso o snapshot do mês atual não afeta o resultado (evita churn).
  useEffect(() => {
    if (!dataLoaded) return;
    const effectKey = `${viewYear}-${viewMonth}`;
    const firstOfMonth = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-01`;
    api.getHistoricalCounts(firstOfMonth)
      .then(data => {
        if (currentMonthKeyRef.current !== effectKey) return;
        setInitialCounts(data || { sundayCounts: {}, holidayCounts: {} });
      })
      .catch(err => { console.error('Erro ao buscar counts históricos:', err); });
  }, [viewYear, viewMonth, dataLoaded, overrides]);

  // Cutoff = hoje (datas anteriores são imutáveis). Mantido em state e
  // rechecado a cada minuto para que o rollover de meia-noite seja detectado
  // enquanto o app fica aberto.
  const [cutoffDate, setCutoffDate] = useState(() => dStr(new Date()));
  useEffect(() => {
    const tick = () => {
      const today = dStr(new Date());
      setCutoffDate(prev => prev === today ? prev : today);
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  // Gera escala com fairness (contadores separados), ausências, snapshots e settings
  const legacyRotation = useMemo(
    () => generateRotation(viewYear, viewMonth, team, holidays, shifts, overrides, absences, {
      snapshots: { ...prevMonthSnapshots, ...snapshots }, // inclui mês anterior p/ folga compensatória
      cutoffDate, settings,
      initialSundayCounts: initialCounts.sundayCounts,
      initialHolidayCounts: initialCounts.holidayCounts,
    }),
    [viewYear, viewMonth, team, holidays, shifts, overrides, absences, snapshots, prevMonthSnapshots, cutoffDate, settings, initialCounts]
  );

  const movfitModel = useMemo(
    () => generateMovfitAnnualSchedule({ year: MOVFIT_YEAR, team, shifts, holidays, overrides }),
    [team, shifts, holidays, overrides]
  );
  const movfitValidation = useMemo(
    () => validateMovfitSchedule(movfitModel),
    [movfitModel]
  );
  const useMovfitSchedule = viewYear === MOVFIT_YEAR && movfitModel.employees.length >= 8 && movfitModel.shifts.length === 4;
  const schedule = useMovfitSchedule
    ? Object.fromEntries(Object.entries(movfitModel.schedule).filter(([ds]) => ds.startsWith(`${viewYear}-${String(viewMonth + 1).padStart(2, '0')}`)))
    : legacyRotation.schedule;
  const sundayCounts = legacyRotation.sundayCounts;
  const holidayCounts = legacyRotation.holidayCounts;
  const calendarShifts = useMovfitSchedule ? movfitModel.shifts : shifts;

  // Persiste snapshots DOS DIAS PASSADOS conforme o schedule é recalculado.
  // Passado (< cutoff) vai com overwrite=false (imutável uma vez salvo).
  // Futuro NÃO entra aqui para evitar loop de rerender — é salvo no mount
  // e nas navegações de mês via `saveCurrentMonthSnapshot`.
  useEffect(() => {
    if (!dataLoaded || !isAdmin) return;
    if (!schedule || Object.keys(schedule).length === 0) return;

    const historyStart = settings?.schedule_start_date || null;
    const pastDays = {};
    let hasPast = false;

    for (const [ds, day] of Object.entries(schedule)) {
      if (historyStart && ds < historyStart) continue;
      if (ds >= cutoffDate) continue;
      // Filtragem POR TURNO: persiste apenas turnos que ainda não estão em
      // snapshot (imutabilidade do passado) e que NÃO são override (esses
      // vivem na tabela overrides e o /counts resolve a precedência por
      // (date, shift_id) ao ler ambos). Sem este per-shift filter, um dia
      // com override parcial deixaria os turnos auto-gerados de fora do
      // snapshot, causando undercount de fairness no mês seguinte.
      const existingForDay = snapshots[ds] || {};
      const ovForDay = overrides[ds] || {};
      const newShifts = {};
      for (const [shiftId, memberIds] of Object.entries(day)) {
        if (Object.prototype.hasOwnProperty.call(ovForDay, shiftId)) continue;
        if (existingForDay[shiftId]) continue;
        newShifts[shiftId] = memberIds;
      }
      if (Object.keys(newShifts).length > 0) {
        pastDays[ds] = newShifts; hasPast = true;
      }
    }

    if (hasPast) {
      const effectKey = `${viewYear}-${viewMonth}`;
      api.saveScheduleSnapshot(pastDays, false)
        .then(({ saved }) => {
          // Descarta o refetch se o user já navegou para outro mês —
          // evita sobrescrever o state de snapshots com dados errados.
          if (saved > 0 && currentMonthKeyRef.current === effectKey) {
            api.getScheduleSnapshots(viewYear, viewMonth + 1)
              .then(snaps => {
                if (currentMonthKeyRef.current !== effectKey) return;
                setSnapshots(snaps || {});
              })
              .catch(() => {});
          }
        })
        .catch(err => console.error('Erro ao persistir snapshot:', err));
    }
  }, [schedule, snapshots, overrides, cutoffDate, dataLoaded, isAdmin, viewYear, viewMonth]);

  // Salva o schedule do mês atual nos snapshots ANTES de navegar,
  // garantindo que o endpoint /counts tenha dados completos para o mês seguinte.
  // Persistência POR TURNO: turnos cobertos pelo override vivem na tabela
  // overrides (o /counts já resolve precedência); os demais (auto-gerados)
  // precisam estar no snapshot para que contribuam à fairness do próximo mês.
  // Sem esta granularidade, dias com override parcial perderiam os turnos
  // auto-gerados no cálculo de counts, causando drift na distribuição.
  const saveCurrentMonthSnapshot = async (currentSchedule) => {
    if (!isAdmin || !currentSchedule || Object.keys(currentSchedule).length === 0) return;
    const historyStart = settings?.schedule_start_date || null;
    const toSave = {};
    for (const [ds, day] of Object.entries(currentSchedule)) {
      if (historyStart && ds < historyStart) continue;
      const ovForDay = overrides[ds] || {};
      const nonOverrideShifts = {};
      for (const [shiftId, memberIds] of Object.entries(day)) {
        if (Object.prototype.hasOwnProperty.call(ovForDay, shiftId)) continue;
        nonOverrideShifts[shiftId] = memberIds;
      }
      if (Object.keys(nonOverrideShifts).length > 0) {
        toSave[ds] = nonOverrideShifts;
      }
    }
    if (Object.keys(toSave).length > 0) {
      await api.saveScheduleSnapshot(toSave, true).catch(() => {}); // overwrite=true — persiste plano completo
    }
  };

  // Salva o schedule do mês atual como snapshot, sempre que estabilizar.
  // Debounce de 800ms impede thrashing durante renders sucessivos (seed, overrides, etc).
  // IMPORTANTE: NÃO usa ref de "já salvou" — se o user edita um override, o schedule
  // recalcula (rebalanceamento dos dias auto-gerados) e PRECISA ser re-salvo para
  // que o /counts do próximo mês tenha o seed correto.
  // Cada chamada é idempotente no backend (overwrite=true), então re-saves são baratos.
  useEffect(() => {
    if (!dataLoaded || !isAdmin) return;
    if (!schedule || Object.keys(schedule).length === 0) return;
    const handle = setTimeout(() => { saveCurrentMonthSnapshot(schedule); }, 800);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoaded, viewYear, viewMonth, schedule]);

  const prevMonth = async () => {
    await saveCurrentMonthSnapshot(schedule);
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = async () => {
    await saveCurrentMonthSnapshot(schedule);
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  // Sincronização manual: força o flush do debounce de save e recarrega tudo
  // do banco. Útil quando outro admin editou em paralelo, quando o user fecha
  // o tab antes dos 800ms do debounce, ou quando algum estado parece estranho.
  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncedFlash(false);
    try {
      // 1) Flush: garante que o schedule atual está persistido antes de refetch
      await saveCurrentMonthSnapshot(schedule);

      // 2) Recarrega tudo do banco (em paralelo para minimizar latência)
      const tasks = [
        api.getTeam(), api.getColaboradores(), api.getHolidays(), api.getShifts(),
        api.getOverrides(), api.getAbsences(), api.getSettings().catch(() => ({})),
        api.getScheduleSnapshots(viewYear, viewMonth + 1),
        api.getHistoricalCounts(`${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-01`),
      ];
      const prevY = viewMonth === 0 ? viewYear - 1 : viewYear;
      const prevM = viewMonth === 0 ? 12 : viewMonth;
      tasks.push(api.getScheduleSnapshots(prevY, prevM).catch(() => ({})));
      if (isAdmin) {
        tasks.push(api.getUsers());
        tasks.push(api.getWebhooks());
      }
      const results = await Promise.all(tasks);
      const [t, c, h, s, o, a, st, snaps, counts, prevSnaps, u, wh] = results;
      setTeam(t); setColaboradores(c); setHolidays(h); setShifts(s); setOverrides(o);
      setAbsences(a); setSettings(st || {});
      setSnapshots(snaps || {});
      setInitialCounts(counts || { sundayCounts: {}, holidayCounts: {} });
      setPrevMonthSnapshots(prevSnaps || {});
      if (isAdmin) { setUsers(u); setWebhooks(wh); }

      // Flash de feedback "✓ Atualizado" por 1.5s
      setSyncedFlash(true);
      setTimeout(() => setSyncedFlash(false), 1500);
    } catch (err) {
      console.error('Erro ao sincronizar:', err);
      alert('Erro ao sincronizar: ' + err.message);
    } finally {
      setSyncing(false);
    }
  };

  // Atalhos de teclado globais: ← / → navegam mês no calendário (apenas na aba calendar)
  useEffect(() => {
    if (authState !== 'authenticated') return;
    const onKey = (e) => {
      // Ignora se o foco está em campos de entrada
      const tag = (e.target?.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag) || e.target?.isContentEditable) return;
      // Ignora se algum modal está aberto (detecta via elementos com role="dialog")
      if (document.querySelector('[data-modal-open="true"]')) return;
      if (tab !== 'calendar') return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); prevMonth(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nextMonth(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [authState, tab, viewMonth, viewYear]);

  if (authState === 'loading') {
    return (
      <div style={{ ...CSS_VARS, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)', fontFamily: 'Segoe UI, system-ui, sans-serif' }}>
        <div style={{ textAlign: 'center', color: 'var(--text)' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⏳</div>
          <p style={{ color: 'var(--text-muted)' }}>Carregando...</p>
        </div>
      </div>
    );
  }

  if (authState === 'unauthenticated') {
    return <div style={CSS_VARS}><Login onLogin={(u) => { setUser(u); setAuthState('authenticated'); }} /></div>;
  }

  if (!dataLoaded) {
    return (
      <div style={{ ...CSS_VARS, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)', fontFamily: 'Segoe UI, system-ui, sans-serif' }}>
        <div style={{ textAlign: 'center', color: 'var(--text)' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>📅</div>
          <p style={{ color: 'var(--text-muted)' }}>Carregando dados...</p>
        </div>
      </div>
    );
  }

  // Usuários não-admin só veem o calendário; admin vê tudo
  const tabs = isAdmin ? [
    { id: 'calendar', label: 'Escala 2026', icon: 'calendar' },
    { id: 'colaboradores', label: 'Colaboradores', icon: 'briefcase' },
    { id: 'team', label: 'Equipe de Plantão', icon: 'users' },
    { id: 'absences', label: 'Ausências', icon: 'stethoscope' },
    { id: 'holidays', label: 'Feriados', icon: 'gift' },
    { id: 'shifts', label: 'Turnos', icon: 'clock' },
    { id: 'webhooks', label: 'Webhooks', icon: 'link' },
    { id: 'users', label: 'Usuários', icon: 'shield' },
    { id: 'settings', label: 'Configurações', icon: 'settings' },
  ] : [
    { id: 'calendar', label: 'Escala 2026', icon: 'calendar' },
  ];

  // Se o usuário não-admin está em uma aba restrita (dados obsoletos), força calendário
  if (!isAdmin && tab !== 'calendar') {
    setTimeout(() => setTab('calendar'), 0);
  }

  // Estatísticas calculadas para os cards superiores do Dashboard
  const todayStr = dStr(new Date());
  const activeTeamCount = colaboradores.filter(c => c.active).length;
  const activeAbsencesCount = absences.filter(a => {
    const start = a.date, end = a.end_date || a.date;
    return start <= todayStr && end >= todayStr;
  }).length;
  const nextSpecialDate = (() => {
    const futureDates = Object.keys(schedule).filter(ds => ds >= todayStr).sort();
    return futureDates[0] || null;
  })();
  const pendingRequests = (users && users.filter ? 0 : 0); // populado via webhook separado — placeholder

  const pageTitle = ({
    calendar: 'Escala MovFit 2026',
    colaboradores: 'Colaboradores',
    team: 'Equipe de Plantão',
    absences: 'Ausências & Atestados',
    holidays: 'Feriados',
    shifts: 'Turnos de Plantão',
    webhooks: 'Webhooks & Notificações',
    users: 'Gerenciar Usuários',
    settings: 'Configurações',
  })[tab] || 'Escala de Suporte';

  const navBtn = (isActive) => ({
    display: 'flex', alignItems: 'center', gap: 12, width: '100%',
    padding: '10px 14px', borderRadius: 8, border: '1px solid transparent', cursor: 'pointer',
    fontSize: 13, fontWeight: 600, textAlign: 'left',
    background: isActive ? '#141416' : 'transparent',
    color: isActive ? '#fff' : 'var(--text-muted)',
    borderLeft: isActive ? '4px solid var(--brand)' : '4px solid transparent',
    boxShadow: isActive ? 'inset 0 0 0 1px #27272A' : 'none',
    transition: 'all 0.15s',
  });

  const iconBtn = {
    width: 34, height: 34, borderRadius: 10, border: '1px solid var(--border)',
    background: 'var(--surface)', color: 'var(--text-muted)', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15,
    transition: 'all 0.15s',
  };

  const StatCard = ({ title, value, subtitle, icon, accent }) => (
    <div style={{
      position: 'relative', padding: '18px 22px', borderRadius: 16,
      background: 'var(--surface)', border: '1px solid var(--card-border)',
      overflow: 'hidden', flex: 1, minWidth: 200,
    }}>
      <div style={{
        position: 'absolute', top: 0, left: 0, width: 3, height: '100%',
        background: accent, borderRadius: '3px 0 0 3px',
      }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
          {title}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 32, height: 32, borderRadius: 10, color: accent,
          background: `color-mix(in srgb, ${accent} 15%, transparent)`,
        }}>{icon}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 32, fontWeight: 800, color: 'var(--text)', lineHeight: 1, letterSpacing: -1 }}>
          {value}
        </span>
        {subtitle && (
          <span style={{ fontSize: 12, color: accent, fontWeight: 600 }}>{subtitle}</span>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ ...CSS_VARS, fontFamily: 'Inter, Segoe UI, system-ui, sans-serif', background: 'var(--bg)', color: 'var(--text)', minHeight: '100vh', display: 'flex' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      {/* Backdrop (mobile) */}
      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 998,
          backdropFilter: 'blur(2px)',
        }} />
      )}

      {/* ===== SIDEBAR ===== */}
      <aside style={{
        width: 240, flexShrink: 0,
        background: 'var(--sidebar)', borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', padding: '20px 14px',
        ...(isMobile ? {
          position: 'fixed', top: 0, left: 0, bottom: 0, height: '100vh',
          zIndex: 999, transform: sidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.25s ease', boxShadow: sidebarOpen ? '8px 0 32px rgba(0,0,0,0.4)' : 'none',
        } : {
          position: 'sticky', top: 0, alignSelf: 'flex-start', height: '100vh', overflowY: 'auto',
        }),
      }}>
        {/* Logo / título */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '4px 6px 22px' }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12, flexShrink: 0,
            background: 'linear-gradient(135deg, #E11D48, #BE123C)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', boxShadow: '0 8px 24px #E11D4850',
          }}><Icon name="calendar" size={20} strokeWidth={2.5} /></div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)', lineHeight: 1.1 }}>
              Escala de Suporte
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, letterSpacing: 0.5 }}>
              Plantão & Rotação
            </div>
          </div>
        </div>

        {/* Navegação */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); if (isMobile) setSidebarOpen(false); }} style={navBtn(tab === t.id)}>
              <Icon name={t.icon} size={17} strokeWidth={tab === t.id ? 2.2 : 1.8} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>

        <div style={{ flex: 1 }} />

        {/* Bloco inferior — usuário e ações */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, marginTop: 14 }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
            borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)',
            marginBottom: 10,
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 13, color: '#fff',
              background: isAdmin ? 'linear-gradient(135deg, #E11D48, #BE123C)' : 'linear-gradient(135deg, #E11D48, #BE123C)',
            }}>{(user.username).charAt(0).toUpperCase()}</div>
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.username}
              </div>
              <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>
                {isAdmin ? '👑 Admin' : '👤 Leitor'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, justifyContent: 'space-between' }}>
            <button onClick={toggleTheme} title={theme === 'dark' ? 'Tema claro' : 'Tema escuro'}
              style={{ ...iconBtn, flex: 1 }}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
            </button>
            <button onClick={() => setShowPwModal(true)} title="Alterar minha senha"
              style={{ ...iconBtn, flex: 1 }}>
              <Icon name="key" size={16} />
            </button>
            <button onClick={handleLogout} title="Sair"
              style={{ ...iconBtn, flex: 1, color: '#ef4444', borderColor: '#ef444440' }}>
              <Icon name="logout" size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* ===== MAIN ===== */}
      <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {/* Top bar */}
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
          padding: isMobile ? '14px 18px' : '22px 32px', borderBottom: '1px solid var(--border)',
          background: 'var(--bg)', position: 'sticky', top: 0, zIndex: 50,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            {isMobile && (
              <button onClick={() => setSidebarOpen(v => !v)} style={{
                ...iconBtn, flexShrink: 0,
              }} title="Menu">
                <Icon name="menu" size={18} />
              </button>
            )}
            <div style={{ minWidth: 0 }}>
              <h1 style={{ margin: 0, fontSize: isMobile ? 18 : 22, fontWeight: 800, letterSpacing: -0.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {pageTitle}
              </h1>
              {tab === 'calendar' && !isMobile && (
                <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                  {MONTHS_PT[viewMonth]} {viewYear} · Distribuição inteligente de plantões
                </p>
              )}
            </div>
          </div>

          {tab === 'calendar' && !isMobile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {isAdmin && (
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  title={syncing ? 'Sincronizando...' : 'Sincronizar: salva edições pendentes e recarrega dados do banco'}
                  style={{
                    ...iconBtn,
                    width: 'auto', padding: '0 14px', gap: 8,
                    color: syncedFlash ? 'var(--success)' : 'var(--text-muted)',
                    borderColor: syncedFlash ? 'var(--success)' : 'var(--border)',
                    cursor: syncing ? 'wait' : 'pointer',
                    opacity: syncing ? 0.6 : 1,
                  }}
                >
                  <span style={{
                    display: 'inline-flex', alignItems: 'center',
                    animation: syncing ? 'spin 0.9s linear infinite' : 'none',
                  }}>
                    <Icon name={syncedFlash ? 'check' : 'refresh'} size={15} />
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>
                    {syncing ? 'Sincronizando' : syncedFlash ? 'Atualizado' : 'Sincronizar'}
                  </span>
                </button>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--surface)', borderRadius: 12, padding: 4, border: '1px solid var(--border)' }}>
                <button onClick={prevMonth} title="Mês anterior (←)" style={{ ...iconBtn, background: 'transparent', border: 'none' }}>
                  <Icon name="chevronLeft" size={16} />
                </button>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', padding: '0 14px', minWidth: 120, textAlign: 'center' }}>
                  {MONTHS_PT[viewMonth]} {viewYear}
                </div>
                <button onClick={nextMonth} title="Mês seguinte (→)" style={{ ...iconBtn, background: 'transparent', border: 'none' }}>
                  <Icon name="chevronRight" size={16} />
                </button>
              </div>
            </div>
          )}

          {tab === 'calendar' && isMobile && isAdmin && (
            <button
              onClick={handleSync}
              disabled={syncing}
              title="Sincronizar"
              style={{
                ...iconBtn, flexShrink: 0,
                color: syncedFlash ? 'var(--success)' : 'var(--text-muted)',
                borderColor: syncedFlash ? 'var(--success)' : 'var(--border)',
                cursor: syncing ? 'wait' : 'pointer',
                opacity: syncing ? 0.6 : 1,
              }}
            >
              <span style={{
                display: 'inline-flex', alignItems: 'center',
                animation: syncing ? 'spin 0.9s linear infinite' : 'none',
              }}>
                <Icon name={syncedFlash ? 'check' : 'refresh'} size={16} />
              </span>
            </button>
          )}
        </header>

        {/* Conteúdo */}
        <div style={{ padding: isMobile ? '16px 14px' : '28px 32px', flex: 1 }}>

        {tab === 'calendar' && (
          <div>
            {useMovfitSchedule && (
              <MovfitDashboard
                model={movfitModel}
                alerts={movfitValidation.alerts}
                todayStr={todayStr}
              />
            )}
            {isAdmin && !isMobile && !useMovfitSchedule && (
              <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap' }}>
                <StatCard
                  title="Atendentes Ativos"
                  value={activeTeamCount}
                  subtitle={`${colaboradores.length} total`}
                  icon={<Icon name="users" size={18} />}
                  accent="var(--accent)"
                />
                <StatCard
                  title="Ausências Hoje"
                  value={activeAbsencesCount}
                  subtitle={activeAbsencesCount === 0 ? 'Nenhuma' : 'Ativas agora'}
                  icon={<Icon name="stethoscope" size={18} />}
                  accent={activeAbsencesCount > 0 ? '#f59e0b' : 'var(--success)'}
                />
                <StatCard
                  title="Próximo Plantão"
                  value={nextSpecialDate ? nextSpecialDate.slice(8, 10) + '/' + nextSpecialDate.slice(5, 7) : '—'}
                  subtitle={nextSpecialDate ? (isSunday(nextSpecialDate) ? 'Domingo' : 'Feriado') : 'Sem agendados'}
                  icon={<Icon name="clock" size={18} />}
                  accent="var(--success)"
                />
              </div>
            )}
            <Calendar
              year={viewYear} month={viewMonth}
              team={team} holidays={useMovfitSchedule ? movfitModel.holidays : holidays} shifts={calendarShifts}
              schedule={schedule} overrides={overrides} absences={absences}
              colaboradores={colaboradores}
              onOverrideUpdate={setOverrides}
              onLogsUpdate={() => {}}
              isAdmin={isAdmin}
              settings={settings}
              snapshots={snapshots}
              cutoffDate={cutoffDate}
              isMobile={isMobile}
              onMonthChange={(y, m) => { setViewYear(y); setViewMonth(m); }}
            />
            {isAdmin && !useMovfitSchedule && team.filter(m => m.active).length > 0 && (
              <SummaryTable
                team={team}
                schedule={schedule}
                shifts={calendarShifts}
                sundayCounts={sundayCounts}
                holidayCounts={holidayCounts}
                holidays={useMovfitSchedule ? movfitModel.holidays : holidays}
              />
            )}
          </div>
        )}

        {tab === 'colaboradores' && (
          <div>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)' }}>
              Cadastro geral de funcionários com seus horários de trabalho durante a semana
              {!isAdmin && <span style={{ marginLeft: 8 }}>· somente leitura</span>}
            </p>
            <ColaboradoresPanel colaboradores={colaboradores} onUpdate={setColaboradores} isAdmin={isAdmin} />
          </div>
        )}

        {tab === 'team' && (
          <div>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)' }}>
              Quem faz plantão nos domingos e feriados, e em qual turno
              {!isAdmin && <span style={{ marginLeft: 8 }}>· somente leitura</span>}
            </p>
            <TeamPanel team={team} shifts={shifts} colaboradores={colaboradores} onUpdate={setTeam} isAdmin={isAdmin} />
          </div>
        )}

        {tab === 'absences' && (
          <div>
            <AbsencePanel
              absences={absences} team={team} onUpdate={setAbsences} isAdmin={isAdmin}
              schedule={schedule} shifts={shifts} overrides={overrides} onOverridesUpdate={setOverrides}
              sundayCounts={sundayCounts} holidayCounts={holidayCounts} holidays={holidays}
            />
          </div>
        )}

        {tab === 'holidays' && (
          <div>
            <HolidayPanel holidays={holidays} onUpdate={setHolidays} isAdmin={isAdmin} />
          </div>
        )}

        {tab === 'shifts' && (
          <div>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)' }}>
              Horários disponíveis para os plantões de domingos e feriados
              {!isAdmin && <span style={{ marginLeft: 8 }}>· somente leitura</span>}
            </p>
            <ShiftPanel shifts={shifts} onUpdate={setShifts} isAdmin={isAdmin} />
          </div>
        )}

        {tab === 'webhooks' && isAdmin && (
          <div>
            <WebhookPanel webhooks={webhooks} onUpdate={setWebhooks} />
          </div>
        )}

        {tab === 'settings' && isAdmin && (
          <div>
            <SettingsPanel settings={settings} onUpdate={setSettings} isAdmin={isAdmin} />
          </div>
        )}

        {tab === 'users' && isAdmin && (
          <div>
            <UsersPanel users={users} onUpdate={setUsers} currentUserId={user.id} />
          </div>
        )}
        </div>
      </main>

      <ChangePasswordModal open={showPwModal} onClose={() => setShowPwModal(false)} />
    </div>
  );
}
