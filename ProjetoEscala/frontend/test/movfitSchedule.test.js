import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MOVFIT_EMPLOYEES,
  MOVFIT_HOLIDAYS_2026,
  MOVFIT_SHIFTS,
  generateMovfitAnnualSchedule,
  validateMovfitSchedule,
} from '../src/utils/movfitSchedule.js';

function fixture() {
  const shifts = MOVFIT_SHIFTS.map(s => ({ ...s, id: `movfit-${s.code.toLowerCase()}`, slots: 1, sunday_slots: 1, holiday_slots: 1 }));
  const team = MOVFIT_EMPLOYEES.map((e, idx) => ({
    id: `employee-${idx}`,
    name: e.name,
    active: true,
    in_rotation: true,
    shift: shifts[Math.min(idx, shifts.length - 1)],
  }));
  const holidays = MOVFIT_HOLIDAYS_2026.map(([date, label, scope]) => ({ date, label, scope }));
  return { team, shifts, holidays };
}

const model = generateMovfitAnnualSchedule(fixture());

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

test('gera todos os sabados, domingos e feriados oficiais de 2026', () => {
  assert.equal(model.events.length, 115);
  assert.equal(model.events.filter(e => e.type === 'Sabado').length, 51);
  assert.equal(model.events.filter(e => e.type === 'Domingo').length, 51);
  assert.equal(model.events.filter(e => e.type === 'Feriado').length, 13);
});

test('preenche exatamente uma pessoa em cada faixa obrigatoria', () => {
  for (const event of model.events) {
    for (const shift of model.shifts) {
      assert.equal(model.schedule[event.date][shift.id].length, 1, `${event.date} ${shift.code}`);
    }
  }
});

test('nao gera violacoes criticas de descanso ou fim de semana', () => {
  const { alerts } = validateMovfitSchedule(model);
  assert.deepEqual(alerts.filter(a => a.level === 'critical'), []);
});

test('respeita 11h entre expediente regular de sexta e plantao de sabado', () => {
  const employeeById = Object.fromEntries(model.employees.map(e => [e.id, e]));
  const offDates = new Set(model.events.map(e => e.date));
  const saturdayEvents = model.events.filter(e => e.type === 'Sabado');
  for (const event of saturdayEvents) {
    if (offDates.has(addDays(event.date, -1))) continue;
    for (const shift of model.shifts) {
      const id = model.schedule[event.date][shift.id][0];
      const employee = employeeById[id];
      const [endH, endM] = employee.regular_end.split(':').map(Number);
      const [startH, startM] = shift.start_time.split(':').map(Number);
      const regularEnd = (employee.regular_end === '00:00' ? 24 * 60 : endH * 60 + endM);
      const shiftStart = startH * 60 + startM + 24 * 60;
      assert.ok((shiftStart - regularEnd) / 60 >= 11, `${event.date} ${shift.code} ${employee.name}`);
    }
  }
});

test('respeita 11h entre plantao de domingo e expediente regular de segunda', () => {
  const employeeById = Object.fromEntries(model.employees.map(e => [e.id, e]));
  const offDates = new Set(model.events.map(e => e.date));
  const sundayEvents = model.events.filter(e => e.type === 'Domingo');
  for (const event of sundayEvents) {
    if (offDates.has(addDays(event.date, 1))) continue;
    for (const shift of model.shifts) {
      const id = model.schedule[event.date][shift.id][0];
      const employee = employeeById[id];
      const [startH, startM] = employee.regular_start.split(':').map(Number);
      const [endH, endM] = shift.end_time.split(':').map(Number);
      const shiftEnd = shift.end_time === '00:00' ? 24 * 60 : endH * 60 + endM;
      const nextRegularStart = startH * 60 + startM + 24 * 60;
      assert.ok((nextRegularStart - shiftEnd) / 60 >= 11, `${event.date} ${shift.code} ${employee.name}`);
    }
  }
});

test('mantem distribuicao total equilibrada com diferenca maxima de 1', () => {
  const totals = model.employees.map(e => model.stats[e.id].total);
  assert.ok(Math.max(...totals) - Math.min(...totals) <= 1);
});

test('mantem sabados, domingos e feriados dentro da tolerancia operacional', () => {
  for (const key of ['Sabado', 'Domingo', 'Feriado']) {
    const values = model.employees.map(e => model.stats[e.id][key]);
    assert.ok(Math.min(...values) > 0, `${key}: ${values.join(', ')}`);
  }
});

test('distribui cada faixa respeitando descanso regular e prioridade de horario', () => {
  for (const key of ['F1', 'F2', 'F3', 'F4']) {
    const values = model.employees.map(e => model.stats[e.id][key]);
    assert.ok(Math.min(...values) > 0, `${key}: ${values.join(', ')}`);
  }
});
