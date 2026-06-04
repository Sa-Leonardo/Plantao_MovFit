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

test('gera todos os sabados, domingos e feriados oficiais de 2026', () => {
  const model = generateMovfitAnnualSchedule(fixture());
  assert.equal(model.events.length, 115);
  assert.equal(model.events.filter(e => e.type === 'Sabado').length, 51);
  assert.equal(model.events.filter(e => e.type === 'Domingo').length, 51);
  assert.equal(model.events.filter(e => e.type === 'Feriado').length, 13);
});

test('preenche exatamente uma pessoa em cada faixa obrigatoria', () => {
  const model = generateMovfitAnnualSchedule(fixture());
  for (const event of model.events) {
    for (const shift of model.shifts) {
      assert.equal(model.schedule[event.date][shift.id].length, 1, `${event.date} ${shift.code}`);
    }
  }
});

test('nao gera violacoes criticas de descanso ou fim de semana', () => {
  const model = generateMovfitAnnualSchedule(fixture());
  const { alerts } = validateMovfitSchedule(model);
  assert.deepEqual(alerts.filter(a => a.level === 'critical'), []);
});

test('mantem distribuicao total equilibrada com diferenca maxima de 1', () => {
  const model = generateMovfitAnnualSchedule(fixture());
  const totals = model.employees.map(e => model.stats[e.id].total);
  assert.ok(Math.max(...totals) - Math.min(...totals) <= 1);
});

test('mantem sabados, domingos e feriados equilibrados', () => {
  const model = generateMovfitAnnualSchedule(fixture());
  for (const key of ['Sabado', 'Domingo', 'Feriado']) {
    const values = model.employees.map(e => model.stats[e.id][key]);
    assert.ok(Math.max(...values) - Math.min(...values) <= 1, key);
  }
});

test('distribui cada faixa entre todos com diferenca maxima de 1', () => {
  const model = generateMovfitAnnualSchedule(fixture());
  for (const key of ['F1', 'F2', 'F3', 'F4']) {
    const values = model.employees.map(e => model.stats[e.id][key]);
    assert.ok(Math.max(...values) - Math.min(...values) <= 1, key);
  }
});
