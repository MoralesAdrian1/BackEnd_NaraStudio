import { addDays, studioDate, studioDateTime, weekdayOf, weekStart } from '../common/studio-time.js';
import { occurrences, type ScheduleRule } from './occurrences.js';

describe('hora del estudio', () => {
  it('convierte la hora de Ciudad de México a UTC (UTC−6)', () => {
    expect(studioDateTime('2026-11-02', '19:00').toISOString()).toBe('2026-11-03T01:00:00.000Z');
    expect(studioDateTime('2026-11-02', '06:50').toISOString()).toBe('2026-11-02T12:50:00.000Z');
  });

  it('obtiene la fecha local aunque en UTC ya sea otro día', () => {
    expect(studioDate(new Date('2026-11-03T01:00:00Z'))).toBe('2026-11-02');
  });

  it('calcula días de la semana y el lunes de cada semana', () => {
    expect(weekdayOf('2026-11-02')).toBe(1); // lunes
    expect(weekdayOf('2026-11-08')).toBe(0); // domingo
    expect(weekStart('2026-11-08')).toBe('2026-11-02');
    expect(weekStart('2026-11-02')).toBe('2026-11-02');
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
  });
});

describe('occurrences', () => {
  const rule = (over: Partial<ScheduleRule> = {}): ScheduleRule => ({
    scheduleId: 1,
    classId: 10,
    coachId: 5,
    capacity: 13,
    durationMin: 60,
    weekday: 1,
    startTime: '19:00',
    validFrom: '2026-01-01',
    validUntil: null,
    ...over,
  });
  const before = new Date('2026-11-01T00:00:00Z');

  it('repite el horario cada semana en su día', () => {
    const out = occurrences([rule()], '2026-11-02', '2026-11-15', new Set(), before);
    expect(out.map((o) => studioDate(o.startsAt))).toEqual(['2026-11-02', '2026-11-09']);
    expect(out[0].endsAt.getTime() - out[0].startsAt.getTime()).toBe(60 * 60_000);
    expect(out[0]).toMatchObject({ classId: 10, coachId: 5, capacity: 13, scheduleId: 1 });
  });

  it('se salta los días cerrados', () => {
    const out = occurrences([rule()], '2026-11-02', '2026-11-15', new Set(['2026-11-09']), before);
    expect(out).toHaveLength(1);
  });

  it('respeta las fechas de vigencia', () => {
    const out = occurrences(
      [rule({ validFrom: '2026-11-05', validUntil: '2026-11-20' })],
      '2026-11-01',
      '2026-11-30',
      new Set(),
      before,
    );
    expect(out.map((o) => studioDate(o.startsAt))).toEqual(['2026-11-09', '2026-11-16']);
  });

  it('no crea sesiones que ya empezaron', () => {
    const now = studioDateTime('2026-11-02', '19:30');
    const out = occurrences([rule()], '2026-11-02', '2026-11-09', new Set(), now);
    expect(out.map((o) => studioDate(o.startsAt))).toEqual(['2026-11-09']);
  });

  it('genera varios horarios de distintos días', () => {
    const out = occurrences(
      [rule({ weekday: 2, startTime: '06:50' }), rule({ scheduleId: 2, weekday: 3, startTime: '08:00' })],
      '2026-11-02',
      '2026-11-08',
      new Set(),
      before,
    );
    expect(out.map((o) => o.startsAt.toISOString())).toEqual([
      '2026-11-03T12:50:00.000Z',
      '2026-11-04T14:00:00.000Z',
    ]);
  });
});
