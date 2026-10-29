import { studioDateTime } from '../common/studio-time.js';
import { bookableUntil, consuming, covers, pickMembership, type MembershipForBooking } from './rules.js';

const OPENS = { weekday: 6, time: '06:00' };

describe('bookableUntil', () => {
  it('entre semana solo se reserva la semana en curso', () => {
    expect(bookableUntil(studioDateTime('2026-11-04', '10:00'), OPENS)).toBe('2026-11-08'); // miércoles → domingo
  });

  it('el sábado antes de las 6:00 todavía no abre la semana siguiente', () => {
    expect(bookableUntil(studioDateTime('2026-11-07', '05:59'), OPENS)).toBe('2026-11-08');
  });

  it('el sábado a las 6:00 se abre la semana siguiente', () => {
    expect(bookableUntil(studioDateTime('2026-11-07', '06:00'), OPENS)).toBe('2026-11-15');
    expect(bookableUntil(studioDateTime('2026-11-08', '20:00'), OPENS)).toBe('2026-11-15'); // domingo
  });

  it('el lunes vuelve a ser solo la semana en curso', () => {
    expect(bookableUntil(studioDateTime('2026-11-09', '07:00'), OPENS)).toBe('2026-11-15');
  });
});

describe('créditos', () => {
  it('si se devuelve el crédito al faltar, la falta no gasta', () => {
    expect(consuming(true)).not.toContain('no_show');
    expect(consuming(false)).toContain('no_show');
  });
});

describe('qué membresía se usa', () => {
  const barre = 1, jump = 2;
  const session = { id: 50, startsAt: studioDateTime('2026-11-05', '19:00'), disciplineId: barre };
  const m = (over: Partial<MembershipForBooking>): MembershipForBooking => ({
    id: 1,
    status: 'active',
    startsAt: new Date('2026-11-01T00:00:00Z'),
    expiresAt: new Date('2026-12-01T00:00:00Z'),
    creditsTotal: null,
    classSessionId: null,
    disciplineIds: [barre],
    used: 0,
    ...over,
  });

  it('sirve una membresía activa de la disciplina', () => {
    expect(covers(m({}), session)).toBe(true);
  });

  it('no sirve de otra disciplina, pendiente, vencida o sin créditos', () => {
    expect(covers(m({ disciplineIds: [jump] }), session)).toBe(false);
    expect(covers(m({ status: 'expired' }), session)).toBe(false);
    expect(covers(m({ expiresAt: studioDateTime('2026-11-05', '18:00') }), session)).toBe(false);
    expect(covers(m({ creditsTotal: 12, used: 12 }), session)).toBe(false);
    expect(covers(m({ creditsTotal: 12, used: 11 }), session)).toBe(true);
  });

  it('el ilimitado combinado sirve para las dos disciplinas', () => {
    expect(covers(m({ disciplineIds: [barre, jump] }), { ...session, disciplineId: jump })).toBe(true);
  });

  it('la clase individual solo sirve para su sesión', () => {
    expect(covers(m({ classSessionId: 50, creditsTotal: 1 }), session)).toBe(true);
    expect(covers(m({ classSessionId: 51, creditsTotal: 1 }), session)).toBe(false);
  });

  it('usa la que vence primero', () => {
    const later = m({ id: 1, expiresAt: new Date('2026-12-01T00:00:00Z') });
    const sooner = m({ id: 2, expiresAt: new Date('2026-11-10T00:00:00Z'), creditsTotal: 5 });
    expect(pickMembership([later, sooner], session)?.id).toBe(2);
  });

  it('la clase individual de esa sesión va antes que todo', () => {
    const single = m({ id: 3, classSessionId: 50, creditsTotal: 1, expiresAt: studioDateTime('2026-11-05', '20:00') });
    const pack = m({ id: 4, expiresAt: new Date('2026-11-06T00:00:00Z'), creditsTotal: 5 });
    expect(pickMembership([pack, single], session)?.id).toBe(3);
  });

  it('la membresía pendiente de pago da una sola reserva (se paga en esa clase)', () => {
    const pending = m({ status: 'pending_payment', startsAt: null, expiresAt: null, creditsTotal: 12 });
    expect(covers(pending, session)).toBe(true);
    expect(covers({ ...pending, used: 1 }, session)).toBe(false);
    expect(covers({ ...pending, disciplineIds: [jump] }, session)).toBe(false);
  });

  it('la clase individual pendiente sirve solo para su sesión y una vez', () => {
    const single = m({ status: 'pending_payment', classSessionId: 50, creditsTotal: 1 });
    expect(covers(single, session)).toBe(true);
    expect(covers({ ...single, used: 1 }, session)).toBe(false);
  });

  it('usa primero lo pagado y deja la ficha pendiente', () => {
    const pending = m({ id: 5, status: 'pending_payment', startsAt: null, expiresAt: null });
    const paid = m({ id: 6, expiresAt: new Date('2026-12-30T00:00:00Z'), creditsTotal: 4 });
    expect(pickMembership([pending, paid], session)?.id).toBe(6);
  });

  it('sin membresía que sirva devuelve null', () => {
    expect(pickMembership([m({ disciplineIds: [jump] })], session)).toBeNull();
  });
});
