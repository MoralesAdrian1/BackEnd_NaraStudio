import { computeStreak, rankDense, type StreakPeriod } from './streak.js';

// Octubre de 2026: el lunes 5 empieza la semana
const weekdays: StreakPeriod = { from: '2026-10-01', to: '2026-10-31', trainingDays: [1, 2, 3, 4, 5], disciplineIds: [1] };
const classesOn = (dates: string[], discipline = 1) => new Map(dates.map((d) => [d, new Set([discipline])]));
const allWeek = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
};
const sessions = classesOn(allWeek('2026-10-01', '2026-10-31'));

describe('computeStreak', () => {
  it('cuenta días seguidos y se brinca el fin de semana', () => {
    const attended = new Set(['2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13']); // jue, vie, lun, mar
    expect(computeStreak({ attended, periods: [weekdays], sessionDays: sessions, today: '2026-10-13' })).toEqual({
      current: 4,
      best: 4,
      lastAttendedOn: '2026-10-13',
    });
  });

  it('se rompe si falta un día de entrenamiento', () => {
    const attended = new Set(['2026-10-05', '2026-10-06', '2026-10-08']); // falta el miércoles 7
    expect(computeStreak({ attended, periods: [weekdays], sessionDays: sessions, today: '2026-10-08' })).toMatchObject({ current: 1, best: 2 });
  });

  it('hoy todavía no la rompe; ayer sí', () => {
    const attended = new Set(['2026-10-05', '2026-10-06']);
    expect(computeStreak({ attended, periods: [weekdays], sessionDays: sessions, today: '2026-10-07' }).current).toBe(2);
    expect(computeStreak({ attended, periods: [weekdays], sessionDays: sessions, today: '2026-10-08' }).current).toBe(0);
  });

  it('perdona los días sin clases (festivo o todo cancelado)', () => {
    const noClassOn7 = classesOn(allWeek('2026-10-01', '2026-10-31').filter((d) => d !== '2026-10-07'));
    const attended = new Set(['2026-10-05', '2026-10-06', '2026-10-08']);
    expect(computeStreak({ attended, periods: [weekdays], sessionDays: noClassOn7, today: '2026-10-08' }).current).toBe(3);
  });

  it('con un plan que incluye sábado solo perdona el domingo', () => {
    const withSaturday = { ...weekdays, trainingDays: [1, 2, 3, 4, 5, 6] };
    const attended = new Set(['2026-10-09', '2026-10-12']); // vie y lun, falta el sábado 10
    expect(computeStreak({ attended, periods: [withSaturday], sessionDays: sessions, today: '2026-10-12' }).current).toBe(1);
  });

  it('solo pide los días de las disciplinas de su plan', () => {
    const otherDiscipline = classesOn(allWeek('2026-10-01', '2026-10-31'), 2);
    const attended = new Set(['2026-10-05']);
    expect(computeStreak({ attended, periods: [weekdays], sessionDays: otherDiscipline, today: '2026-10-09' }).current).toBe(1);
  });

  it('sin membresía vigente no se rompe', () => {
    const shortPlan = { ...weekdays, to: '2026-10-06' };
    const attended = new Set(['2026-10-05', '2026-10-06']);
    expect(computeStreak({ attended, periods: [shortPlan], sessionDays: sessions, today: '2026-10-09' }).current).toBe(2);
  });

  it('sin asistencias es cero', () => {
    expect(computeStreak({ attended: new Set(), periods: [weekdays], sessionDays: sessions, today: '2026-10-09' })).toEqual({
      current: 0,
      best: 0,
      lastAttendedOn: null,
    });
  });
});

describe('rankDense', () => {
  it('los empates comparten lugar y el siguiente no se brinca', () => {
    const ranked = rankDense([
      { id: 'a', days: 3 },
      { id: 'b', days: 5 },
      { id: 'c', days: 5 },
      { id: 'd', days: 1 },
    ]);
    expect(ranked.map((r) => [r.id, r.position])).toEqual([
      ['b', 1],
      ['c', 1],
      ['a', 2],
      ['d', 3],
    ]);
  });
});
