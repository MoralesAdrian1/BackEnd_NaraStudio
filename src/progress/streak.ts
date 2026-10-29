import { addDays, weekdayOf } from '../common/studio-time.js';

/** Un periodo de membresía que cuenta para la racha (fechas del estudio, 'AAAA-MM-DD', ambas incluidas). */
export interface StreakPeriod {
  from: string;
  to: string;
  trainingDays: number[]; // 0 = domingo … 6 = sábado
  disciplineIds: number[];
}

export interface StreakInput {
  /** Días en que asistió a alguna clase */
  attended: Set<string>;
  periods: StreakPeriod[];
  /** Por fecha, las disciplinas que tuvieron al menos una sesión no cancelada */
  sessionDays: Map<string, Set<number>>;
  today: string;
}

export type DayState = 'attended' | 'missed' | 'rest' | 'pending';

/**
 * ¿Ese día había que entrenar? Sí, si una membresía vigente lo marca como día de entrenamiento
 * y hubo clase de alguna de sus disciplinas. Así se perdonan los fines de semana, los festivos
 * y los días en que el estudio cancela todo.
 */
export function isRequired(date: string, periods: StreakPeriod[], sessionDays: Map<string, Set<number>>) {
  const held = sessionDays.get(date);
  if (!held) return false;
  const wd = weekdayOf(date);
  return periods.some(
    (p) => p.from <= date && date <= p.to && p.trainingDays.includes(wd) && p.disciplineIds.some((d) => held.has(d)),
  );
}

export function dayState(date: string, input: StreakInput): DayState {
  if (input.attended.has(date)) return 'attended';
  if (!isRequired(date, input.periods, input.sessionDays)) return 'rest';
  return date >= input.today ? 'pending' : 'missed';
}

/**
 * Racha: días seguidos con asistencia. Dos clases el mismo día cuentan como uno; solo la rompe
 * faltar un día de entrenamiento. Hoy todavía no la rompe aunque no haya ido.
 */
export function computeStreak(input: StreakInput) {
  const days = [...input.attended].sort();
  let current = 0;
  let best = 0;
  if (days.length) {
    for (let d = days[0]; d <= input.today; d = addDays(d, 1)) {
      const state = dayState(d, input);
      if (state === 'attended') best = Math.max(best, ++current);
      else if (state === 'missed') current = 0;
    }
  }
  return { current, best, lastAttendedOn: days.at(-1) ?? null };
}

/** Ranking con lugares compartidos en los empates: 1, 1, 2. */
export function rankDense<T extends { days: number }>(rows: T[]): (T & { position: number })[] {
  const sorted = [...rows].sort((a, b) => b.days - a.days);
  let position = 0;
  let last: number | null = null;
  return sorted.map((r) => {
    if (r.days !== last) {
      position++;
      last = r.days;
    }
    return { ...r, position };
  });
}
