import { dStr, parseDateStr, normalizeOverrideMembers } from './rotation.js';

export const MOVFIT_YEAR = 2026;

export const MOVFIT_SHIFTS = [
  { code: 'F1', label: 'F1', start_time: '05:00', end_time: '11:15' },
  { code: 'F2', label: 'F2', start_time: '09:00', end_time: '15:15' },
  { code: 'F3', label: 'F3', start_time: '13:00', end_time: '19:15' },
  { code: 'F4', label: 'F4', start_time: '17:45', end_time: '00:00' },
];

export const MOVFIT_HOLIDAYS_2026 = [
  ['2026-01-01', 'Confraternizacao Universal', 'national'],
  ['2026-04-03', 'Sexta-feira Santa', 'national'],
  ['2026-04-21', 'Tiradentes', 'national'],
  ['2026-05-01', 'Dia do Trabalho', 'national'],
  ['2026-06-22', 'Feriado Municipal de Santarem', 'municipal'],
  ['2026-08-15', 'Adesao do Para', 'state'],
  ['2026-09-07', 'Independencia do Brasil', 'national'],
  ['2026-10-12', 'Nossa Senhora Aparecida', 'national'],
  ['2026-11-02', 'Finados', 'national'],
  ['2026-11-15', 'Proclamacao da Republica', 'national'],
  ['2026-11-20', 'Dia da Consciencia Negra', 'national'],
  ['2026-12-08', 'Nossa Senhora da Conceicao', 'municipal'],
  ['2026-12-25', 'Natal', 'national'],
];

export const MOVFIT_EMPLOYEES = [
  { name: 'Lucas', regular_start: '05:00', regular_end: '11:15' },
  { name: 'Luana', regular_start: '07:00', regular_end: '13:15' },
  { name: 'Alohana', regular_start: '09:30', regular_end: '15:45' },
  { name: 'Maria', regular_start: '10:00', regular_end: '16:15' },
  { name: 'Lara', regular_start: '11:00', regular_end: '17:15' },
  { name: 'Pablo', regular_start: '14:00', regular_end: '00:00' },
  { name: 'Celline', regular_start: '15:45', regular_end: '22:00' },
  { name: 'Raissa', regular_start: '17:00', regular_end: '23:15' },
];

const INITIAL_HISTORY = [
  ['2026-05-09', 'F1', 'Raissa'],
  ['2026-05-09', 'F2', 'Pablo'],
  ['2026-05-09', 'F3', 'Lucas'],
  ['2026-05-09', 'F4', 'Alohana'],
  ['2026-05-10', 'F2', 'Lara'],
  ['2026-05-10', 'F3', 'Luana'],
  ['2026-05-10', 'F4', 'Maria'],
];

function minutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function absoluteMinutes(dateStr, time, isEnd = false) {
  const base = parseDateStr(dateStr).getTime() / 60000;
  let mins = minutes(time);
  if (isEnd && time === '00:00') mins += 24 * 60;
  return base + mins;
}

function dateType(dateStr, holidayMap) {
  const dow = parseDateStr(dateStr).getDay();
  if (holidayMap.has(dateStr)) return 'Feriado';
  if (dow === 6) return 'Sabado';
  if (dow === 0) return 'Domingo';
  return null;
}

export function getMovfitEvents(year = MOVFIT_YEAR, holidays = MOVFIT_HOLIDAYS_2026.map(([date, label, scope]) => ({ date, label, scope }))) {
  const holidayMap = new Map(holidays.filter(h => String(h.date).startsWith(`${year}-`)).map(h => [h.date, h]));
  const events = [];
  const cur = new Date(year, 0, 1);
  while (cur.getFullYear() === year) {
    const ds = dStr(cur);
    const type = dateType(ds, holidayMap);
    if (type) {
      events.push({
        date: ds,
        type,
        label: holidayMap.get(ds)?.label || type,
      });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

function buildMovfitContext(team = [], shifts = [], holidays = []) {
  const shiftByCode = new Map();
  for (const official of MOVFIT_SHIFTS) {
    const found = shifts.find(s => s.label === official.code || s.label?.startsWith(official.code));
    if (found) shiftByCode.set(official.code, found);
  }

  const teamByName = new Map(team.filter(m => m.active && m.in_rotation !== false).map(m => [m.name.toLowerCase(), m]));
  const employees = MOVFIT_EMPLOYEES
    .map(official => {
      const member = teamByName.get(official.name.toLowerCase());
      return member ? { ...official, id: member.id, member } : null;
    })
    .filter(Boolean);

  const dbHolidayMap = new Map(holidays.filter(h => h.date?.startsWith('2026-')).map(h => [h.date, h]));
  for (const [date, label, scope] of MOVFIT_HOLIDAYS_2026) {
    if (!dbHolidayMap.has(date)) dbHolidayMap.set(date, { date, label, scope });
  }

  return {
    shifts: MOVFIT_SHIFTS.map(s => ({ ...s, id: shiftByCode.get(s.code)?.id || s.code })),
    employees,
    holidays: Array.from(dbHolidayMap.values()),
  };
}

function initStats(employees) {
  const stats = {};
  for (const employee of employees) {
    stats[employee.id] = {
      total: 0, Sabado: 0, Domingo: 0, Feriado: 0,
      F1: 0, F2: 0, F3: 0, F4: 0,
      lastAssignment: null,
    };
  }
  return stats;
}

function seedInitialHistory(stats, nameToId) {
  for (const [date, slot, name] of INITIAL_HISTORY) {
    const id = nameToId.get(name.toLowerCase());
    if (!id || !stats[id]) continue;
    const dow = parseDateStr(date).getDay();
    const type = dow === 6 ? 'Sabado' : dow === 0 ? 'Domingo' : 'Feriado';
    stats[id].total += 1;
    stats[id][type] += 1;
    stats[id][slot] += 1;
  }
}

function affinityPenalty(employee, shift) {
  const regular = minutes(employee.regular_start);
  const slot = minutes(shift.start_time);
  return Math.abs(regular - slot) / 60;
}

function isRestValid(employeeId, dateStr, shift, stats, dayAssignedIds) {
  if (dayAssignedIds.has(employeeId)) return false;
  const last = stats[employeeId].lastAssignment;
  if (!last) return true;
  if (last.date === dateStr) return false;
  const start = absoluteMinutes(dateStr, shift.start_time);
  const restHours = (start - last.endAbs) / 60;
  if (restHours < 11) return false;
  if (last.slot === 'F4' && shift.code === 'F1') return false;
  return true;
}

export function generateMovfitAnnualSchedule({ year = MOVFIT_YEAR, team = [], shifts = [], holidays = [], overrides = {} } = {}) {
  const ctx = buildMovfitContext(team, shifts, holidays);
  const schedule = {};
  const events = getMovfitEvents(year, ctx.holidays);
  const stats = initStats(ctx.employees);
  const nameToId = new Map(ctx.employees.map(e => [e.name.toLowerCase(), e.id]));
  seedInitialHistory(stats, nameToId);

  const assignmentsByDate = new Map();

  for (const event of events) {
    const previousDay = dStr(new Date(parseDateStr(event.date).setDate(parseDateStr(event.date).getDate() - 1)));
    const prevIds = new Set(assignmentsByDate.get(previousDay) || []);
    const isSundayEvent = parseDateStr(event.date).getDay() === 0;
    const eventPool = ctx.employees
      .filter(e => !isSundayEvent || !prevIds.has(e.id))
      .sort((a, b) => {
        const as = stats[a.id];
        const bs = stats[b.id];
        return (as[event.type] - bs[event.type]) ||
          (as.total - bs.total) ||
          a.name.localeCompare(b.name);
      })
      .slice(0, 4);
    const dayAssignedIds = new Set();
    const day = {};

    for (const shift of ctx.shifts) {
      const overrideIds = normalizeOverrideMembers(overrides[event.date]?.[shift.id]);
      const chosen = overrideIds[0] || (() => {
        const pool = eventPool.length === 4 ? eventPool : ctx.employees;
        let candidates = pool
          .filter(e => isRestValid(e.id, event.date, shift, stats, dayAssignedIds))
          .map(e => ({
            employee: e,
            affinity: affinityPenalty(e, shift),
          }));
        if (candidates.length === 0) {
          candidates = ctx.employees
            .filter(e => !isSundayEvent || !prevIds.has(e.id))
            .filter(e => isRestValid(e.id, event.date, shift, stats, dayAssignedIds))
            .map(e => ({ employee: e, affinity: affinityPenalty(e, shift) }));
        }
        candidates.sort((a, b) => {
          const as = stats[a.employee.id];
          const bs = stats[b.employee.id];
          return (as[shift.code] - bs[shift.code]) ||
            (as[event.type] - bs[event.type]) ||
            (as.total - bs.total) ||
            (a.affinity - b.affinity) ||
            a.employee.name.localeCompare(b.employee.name);
        });
        return candidates[0]?.employee.id || null;
      })();

      day[shift.id] = chosen ? [chosen] : [];
      if (chosen && stats[chosen]) {
        const endAbs = absoluteMinutes(event.date, shift.end_time, true);
        stats[chosen].total += 1;
        stats[chosen][event.type] += 1;
        stats[chosen][shift.code] += 1;
        stats[chosen].lastAssignment = { date: event.date, slot: shift.code, endAbs };
        dayAssignedIds.add(chosen);
      }
    }

    assignmentsByDate.set(event.date, Array.from(dayAssignedIds));
    schedule[event.date] = day;
  }

  repairSlotBalance(schedule, events, ctx.shifts, ctx.employees);
  const displayStats = recomputeScheduleStats(schedule, events, ctx.shifts, ctx.employees);
  return { schedule, events, stats: displayStats, shifts: ctx.shifts, employees: ctx.employees, holidays: ctx.holidays };
}

function recomputeScheduleStats(schedule, events, shifts, employees) {
  const totals = initStats(employees);
  const eventByDate = Object.fromEntries(events.map(e => [e.date, e]));
  for (const [date, day] of Object.entries(schedule)) {
    const event = eventByDate[date];
    if (!event) continue;
    for (const shift of shifts) {
      for (const id of normalizeOverrideMembers(day[shift.id])) {
        if (!totals[id]) continue;
        totals[id].total += 1;
        totals[id][event.type] += 1;
        totals[id][shift.code] += 1;
      }
    }
  }
  return totals;
}

function repairSlotBalance(schedule, events, shifts, employees) {
  const employeeIds = employees.map(e => e.id);
  for (let attempt = 0; attempt < 200; attempt++) {
    const totals = recomputeScheduleStats(schedule, events, shifts, employees);
    const slot = ['F1', 'F2', 'F3', 'F4'].find(code => {
      const values = employeeIds.map(id => totals[id][code]);
      return Math.max(...values) - Math.min(...values) > 1;
    });
    if (!slot) return;

    const values = employeeIds.map(id => [id, totals[id][slot]]).sort((a, b) => a[1] - b[1]);
    const lowId = values[0][0];
    const highId = values[values.length - 1][0];
    const targetShift = shifts.find(s => s.code === slot);
    let swapped = false;

    for (const event of events) {
      const day = schedule[event.date];
      const highInTarget = normalizeOverrideMembers(day?.[targetShift.id]).includes(highId);
      if (!highInTarget) continue;
      const otherShift = shifts.find(s => s.id !== targetShift.id && normalizeOverrideMembers(day[s.id]).includes(lowId));
      if (!otherShift) continue;

      day[targetShift.id] = [lowId];
      day[otherShift.id] = [highId];
      const critical = validateMovfitSchedule({ schedule, events, shifts, employees }).alerts.some(a => a.level === 'critical');
      if (!critical) {
        swapped = true;
        break;
      }
      day[targetShift.id] = [highId];
      day[otherShift.id] = [lowId];
    }

    if (!swapped) return;
  }
}

export function validateMovfitSchedule({ schedule, events, shifts, employees }) {
  const alerts = [];
  const shiftById = Object.fromEntries(shifts.map(s => [s.id, s]));
  const byEmployee = {};
  const totals = initStats(employees);

  for (const event of events) {
    const day = schedule[event.date] || {};
    const assignedToday = new Set();
    for (const shift of shifts) {
      const ids = normalizeOverrideMembers(day[shift.id]);
      if (ids.length !== 1) {
        alerts.push({ level: 'critical', date: event.date, message: `${shift.code} sem cobertura obrigatoria` });
      }
      for (const id of ids) {
        if (assignedToday.has(id)) alerts.push({ level: 'critical', date: event.date, message: 'Colaborador duplicado no mesmo plantao' });
        assignedToday.add(id);
        byEmployee[id] = byEmployee[id] || [];
        byEmployee[id].push({ date: event.date, shift: shiftById[shift.id] });
        if (totals[id]) {
          totals[id].total += 1;
          totals[id][event.type] += 1;
          totals[id][shift.code] += 1;
        }
      }
    }
  }

  for (const employee of employees) {
    const list = (byEmployee[employee.id] || []).sort((a, b) => a.date.localeCompare(b.date) || a.shift.start_time.localeCompare(b.shift.start_time));
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const curr = list[i];
      const rest = (absoluteMinutes(curr.date, curr.shift.start_time) - absoluteMinutes(prev.date, prev.shift.end_time, true)) / 60;
      if (rest < 11) alerts.push({ level: 'critical', date: curr.date, employee: employee.name, message: `Descanso inferior a 11h (${rest.toFixed(1)}h)` });
      if (prev.shift.code === 'F4' && curr.shift.code === 'F1') alerts.push({ level: 'critical', date: curr.date, employee: employee.name, message: 'F4 seguido de F1 no plantao seguinte' });
      const prevDate = parseDateStr(prev.date);
      const currDate = parseDateStr(curr.date);
      const diffDays = Math.round((currDate - prevDate) / 86400000);
      if (diffDays === 1 && prevDate.getDay() === 6 && currDate.getDay() === 0) {
        alerts.push({ level: 'critical', date: curr.date, employee: employee.name, message: 'Sabado e domingo consecutivos' });
      }
    }
  }

  const fields = ['total', 'Sabado', 'Domingo', 'Feriado', 'F1', 'F2', 'F3', 'F4'];
  for (const field of fields) {
    const values = employees.map(e => totals[e.id]?.[field] || 0);
    if (values.length && Math.max(...values) - Math.min(...values) > 1) {
      alerts.push({ level: 'warning', message: `Distribuicao desigual em ${field}` });
    }
  }

  return { alerts, totals };
}

export function buildMovfitExports({ events, schedule, shifts, employees }) {
  const employeeById = Object.fromEntries(employees.map(e => [e.id, e]));
  const rows = [['Data', 'Tipo', 'Faixa', 'Horario', 'Colaborador', 'Status']];
  for (const event of events) {
    for (const shift of shifts) {
      const ids = normalizeOverrideMembers(schedule[event.date]?.[shift.id]);
      rows.push([
        event.date,
        event.type,
        shift.code,
        `${shift.start_time}-${shift.end_time}`,
        ids.map(id => employeeById[id]?.name || id).join(', '),
        ids.length === 1 ? 'Coberto' : 'Alerta',
      ]);
    }
  }
  return rows;
}
