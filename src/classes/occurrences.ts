import { addDays, studioDateTime, weekdayOf } from '../common/studio-time.js';

export interface ScheduleRule {
  scheduleId: number;
  classId: number;
  coachId: number;
  capacity: number;
  durationMin: number;
  weekday: number;
  startTime: string; // HH:MM, hora del estudio
  validFrom: string; // AAAA-MM-DD
  validUntil: string | null;
}

export interface Occurrence {
  scheduleId: number;
  classId: number;
  coachId: number;
  capacity: number;
  startsAt: Date;
  endsAt: Date;
}

/**
 * Las sesiones que tocan entre dos fechas (incluidas) según los horarios recurrentes.
 * Se saltan los días cerrados y lo que ya empezó.
 */
export function occurrences(
  rules: ScheduleRule[],
  from: string,
  to: string,
  closed: Set<string>,
  now: Date,
): Occurrence[] {
  const out: Occurrence[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (closed.has(date)) continue;
    const weekday = weekdayOf(date);
    for (const r of rules) {
      if (r.weekday !== weekday || date < r.validFrom || (r.validUntil && date > r.validUntil)) continue;
      const startsAt = studioDateTime(date, r.startTime);
      if (startsAt <= now) continue;
      out.push({
        scheduleId: r.scheduleId,
        classId: r.classId,
        coachId: r.coachId,
        capacity: r.capacity,
        startsAt,
        endsAt: new Date(startsAt.getTime() + r.durationMin * 60_000),
      });
    }
  }
  return out;
}
