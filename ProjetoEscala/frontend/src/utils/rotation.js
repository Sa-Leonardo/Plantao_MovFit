export function dStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseDateStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isSunday(dateStr) {
  return parseDateStr(dateStr).getDay() === 0;
}

export function isHoliday(dateStr, holidays) {
  return holidays.some(h => h.date === dateStr);
}

export function isSpecialDay(dateStr, holidays) {
  return isSunday(dateStr) || isHoliday(dateStr, holidays);
}

/**
 * Retorna a data string do dia anterior (YYYY-MM-DD).
 */
export function prevDayStr(dateStr) {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() - 1);
  return dStr(d);
}

/**
 * Normaliza o valor de um override para array de member IDs.
 * Suporta formato legado (string) e novo formato (array).
 */
export function normalizeOverrideMembers(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') return [value];
  return [];
}

/**
 * Algoritmo de rotação com:
 *  - Fairness separado para DOMINGOS e FERIADOS (contadores independentes)
 *  - Slots configuráveis por turno
 *  - Suporte a ausências e overrides manuais
 *  - Imutabilidade do passado via snapshots persistidos
 *  - Regra opcional de folga compensatória: quem trabalhou no domingo não pode
 *    ser escalado no feriado da segunda-feira imediatamente seguinte
 *
 * Parâmetros:
 *   - year, month, team, holidays, shifts
 *   - overrides: objeto { date: { shift_id: [member_ids] } }
 *   - absences: array
 *   - opts.snapshots: { date: { shift_id: [member_ids] } } — escala persistida (passado)
 *   - opts.cutoffDate: string "YYYY-MM-DD" — datas < cutoff são imutáveis (lidas do snapshot se disponível)
 *   - opts.settings: { compensatory_monday_rest: boolean, ... }
 *
 * Retorna: { schedule, sundayCounts, holidayCounts }
 */
export function generateRotation(year, month, team, holidays, shifts, overrides, absences = [], opts = {}) {
  const { snapshots = {}, cutoffDate = null, settings = {}, initialSundayCounts = {}, initialHolidayCounts = {} } = opts;
  const compensatoryMondayRest = !!settings.compensatory_monday_rest;
  // Data a partir da qual o sistema considera histórico (antes disso, não existe escala)
  const historyStart = settings.schedule_start_date || null;

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const schedule = {};

  // Mapa de ausências: "YYYY-MM-DD" -> Set de member_ids
  // Expande o intervalo [date ... end_date] para todos os dias do período
  const absenceMap = {};
  for (const a of absences) {
    const start = parseDateStr(a.date);
    const end = a.end_date ? parseDateStr(a.end_date) : start;
    const cursor = new Date(start);
    while (cursor <= end) {
      const ds = dStr(cursor);
      if (!absenceMap[ds]) absenceMap[ds] = new Set();
      absenceMap[ds].add(a.member_id);
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  // Pool de membros por turno (ativos E participantes da rotação)
  const poolByShift = {};
  for (const shift of shifts) {
    poolByShift[shift.id] = team.filter(m => m.active && m.in_rotation !== false && m.shift && m.shift.id === shift.id);
  }

  // Contadores SEPARADOS para domingos e feriados — começam do acumulado histórico
  // (passado consolidado) para que a fairness seja CONTÍNUA entre meses.
  const sundayCounts = {};
  const holidayCounts = {};
  // Contadores do mês atual (para respeitar limite mensal por membro)
  const monthSundayCounts = {};
  const monthHolidayCounts = {};
  for (const m of team) {
    sundayCounts[m.id] = initialSundayCounts[m.id] || 0;
    holidayCounts[m.id] = initialHolidayCounts[m.id] || 0;
    monthSundayCounts[m.id] = 0; monthHolidayCounts[m.id] = 0;
  }

  const bumpCount = (memberId, isSun) => {
    if (isSun) {
      if (sundayCounts[memberId] !== undefined) sundayCounts[memberId]++;
      if (monthSundayCounts[memberId] !== undefined) monthSundayCounts[memberId]++;
    } else {
      if (holidayCounts[memberId] !== undefined) holidayCounts[memberId]++;
      if (monthHolidayCounts[memberId] !== undefined) monthHolidayCounts[memberId]++;
    }
  };

  // Verifica se um membro já atingiu seu limite mensal
  const teamById = Object.fromEntries(team.map(m => [m.id, m]));
  const exceededLimit = (memberId, isSun) => {
    const m = teamById[memberId];
    if (!m) return false;
    if (isSun) {
      const lim = m.monthly_sunday_limit;
      return lim != null && monthSundayCounts[memberId] >= lim;
    }
    const lim = m.monthly_holiday_limit;
    return lim != null && monthHolidayCounts[memberId] >= lim;
  };

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const ds = dStr(date);
    if (!isSpecialDay(ds, holidays)) continue;
    // Antes do início do histórico: sistema não existia, não gera nem lê nada
    if (historyStart && ds < historyStart) continue;

    const sun = isSunday(ds);
    const hol = isHoliday(ds, holidays);
    // Se o dia é domingo E feriado, tratamos como domingo (prioriza contador de domingo)
    const useSunday = sun;

    // 1) PASSADO (imutável): snapshot E/OU override. Override ganha prioridade
    // por turno; bump dos contadores é feito UMA VEZ com as atribuições finais.
    const isPast = cutoffDate && ds < cutoffDate;
    if (isPast && (snapshots[ds] || overrides[ds])) {
      const snap = snapshots[ds] || {};
      const ov = overrides[ds] || {};
      const dayAssignments = {};
      const shiftIds = new Set([...Object.keys(snap), ...Object.keys(ov)]);
      for (const shiftId of shiftIds) {
        // Override explícito do turno substitui o snapshot daquele turno
        const source = Object.prototype.hasOwnProperty.call(ov, shiftId) ? ov[shiftId] : snap[shiftId];
        const memberIds = normalizeOverrideMembers(source);
        dayAssignments[shiftId] = memberIds;
        for (const memberId of memberIds) bumpCount(memberId, useSunday);
      }
      schedule[ds] = dayAssignments;
      continue;
    }

    // 2) Override manual tem prioridade POR TURNO (não por dia). Turnos
    //    explicitamente cobertos pelo override são aplicados ANTES do auto-gen,
    //    para que os contadores sejam incrementados antes da fairness sort.
    //    Turnos NÃO cobertos pelo override caem no auto-gen normal logo abaixo —
    //    essencial para o caso em que um novo turno é adicionado DEPOIS do
    //    override existir (ou quando só parte dos turnos do dia foi manualmente
    //    editada). Sem isto, esses turnos ficariam eternamente sem escala.
    const dayAssignments = {};
    const dayOverride = overrides[ds] || null;
    if (dayOverride) {
      for (const [shiftId, rawValue] of Object.entries(dayOverride)) {
        const memberIds = normalizeOverrideMembers(rawValue);
        dayAssignments[shiftId] = memberIds;
        for (const memberId of memberIds) {
          if (memberId) bumpCount(memberId, useSunday);
        }
      }
    }

    const absentToday = absenceMap[ds] || new Set();

    // 3) Folga compensatória: se é feriado na segunda-feira e a regra está ativa,
    //    exclui do pool quem trabalhou no domingo anterior. Busca em:
    //    schedule (mês atual) → overrides → snapshots (pode ser mês anterior).
    const restIds = new Set();
    if (compensatoryMondayRest && hol && date.getDay() === 1) {
      const prevDs = prevDayStr(ds);
      let prevAssign = schedule[prevDs] || overrides[prevDs] || snapshots[prevDs] || null;
      if (prevAssign) {
        for (const memberIds of Object.values(prevAssign)) {
          for (const mid of normalizeOverrideMembers(memberIds)) restIds.add(mid);
        }
      }
    }

    const counts = useSunday ? sundayCounts : holidayCounts;

    for (const shift of shifts) {
      // Turno já definido pelo override acima — não re-processa (nem sobrescreve)
      if (Object.prototype.hasOwnProperty.call(dayAssignments, shift.id)) continue;
      const legacy = Math.max(1, shift.slots || 1);
      // Vaga específica para o tipo do dia (domingo vs feriado) com fallback ao legado
      const slotsForDay = useSunday
        ? (shift.sunday_slots != null ? shift.sunday_slots : legacy)
        : (shift.holiday_slots != null ? shift.holiday_slots : legacy);
      const slots = Math.max(1, slotsForDay);
      const pool = (poolByShift[shift.id] || []).filter(m =>
        !absentToday.has(m.id) &&
        !restIds.has(m.id) &&
        !exceededLimit(m.id, useSunday)
      );
      if (pool.length === 0) {
        dayAssignments[shift.id] = [];
        continue;
      }

      // Seleciona os `slots` membros com menor contagem no contador apropriado.
      // Tiebreak: nome, depois ID — o ID garante ordem determinística mesmo quando
      // dois membros compartilham o mesmo nome (Array.sort não é estável em todas
      // as engines antigas, e nomes duplicados poderiam produzir escalas diferentes
      // entre execuções, quebrando a idempotência que o /counts presume).
      const sorted = [...pool].sort((a, b) => {
        const diff = (counts[a.id] || 0) - (counts[b.id] || 0);
        if (diff !== 0) return diff;
        const byName = a.name.localeCompare(b.name);
        if (byName !== 0) return byName;
        return a.id.localeCompare(b.id);
      });

      const assigned = sorted.slice(0, slots);
      dayAssignments[shift.id] = assigned.map(m => m.id);
      for (const m of assigned) bumpCount(m.id, useSunday);
    }

    schedule[ds] = dayAssignments;
  }

  return { schedule, sundayCounts, holidayCounts };
}
