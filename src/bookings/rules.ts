import { addDays, studioDate, studioDateTime, weekStart } from '../common/studio-time.js';

export type BookingStatus = 'booked' | 'attended' | 'no_show' | 'cancelled_by_student' | 'cancelled_by_studio';

/** Ocupan lugar en la clase */
export const OCCUPYING: BookingStatus[] = ['booked', 'attended'];

/** Gastan crédito. Si se devuelve el crédito a quien falta, la falta no cuenta. */
export const consuming = (refundNoShow: boolean): BookingStatus[] =>
  refundNoShow ? ['booked', 'attended'] : ['booked', 'attended', 'no_show'];

export interface BookingOpens {
  weekday: number; // 0 = domingo … 6 = sábado
  time: string; // HH:MM
}

/**
 * Hasta qué fecha se puede reservar: la semana en curso (lunes a domingo) y, desde la apertura
 * (sábado 06:00 por defecto), también la semana siguiente.
 */
export function bookableUntil(now: Date, opens: BookingOpens): string {
  const monday = weekStart(studioDate(now));
  const sunday = addDays(monday, 6);
  const openAt = studioDateTime(addDays(monday, (opens.weekday + 6) % 7), opens.time);
  return now >= openAt ? addDays(sunday, 7) : sunday;
}

export interface MembershipForBooking {
  id: number;
  status: string;
  startsAt: Date | null;
  expiresAt: Date | null;
  creditsTotal: number | null;
  classSessionId: number | null;
  disciplineIds: number[];
  used: number;
}

export interface SessionForBooking {
  id: number;
  startsAt: Date;
  disciplineId: number;
}

/** Hasta cuándo se puede cobrar en efectivo una clase reservada sin pagar: 2 horas después de que termina. */
export const PAY_GRACE_MS = 2 * 3_600_000;
export const payDeadline = (endsAt: Date) => new Date(endsAt.getTime() + PAY_GRACE_MS);

/**
 * ¿Esta membresía sirve para esta sesión?
 * Una membresía pendiente de pago en efectivo da una sola reserva (la "ficha"): se paga al llegar
 * a esa clase y entonces se activan las demás.
 */
export function covers(m: MembershipForBooking, s: SessionForBooking): boolean {
  if (m.status !== 'active' && m.status !== 'pending_payment') return false;
  if (!m.disciplineIds.includes(s.disciplineId)) return false;
  if (m.classSessionId !== null) return m.classSessionId === s.id && m.used === 0; // clase individual: solo su sesión
  if (m.status === 'pending_payment') return m.used === 0;
  if (m.expiresAt && m.expiresAt <= s.startsAt) return false;
  if (m.startsAt && m.startsAt > s.startsAt) return false;
  return m.creditsTotal === null || m.used < m.creditsTotal;
}

/**
 * La membresía que se usa al reservar: la clase individual de esa sesión va antes que todo;
 * después, las pagadas antes que la ficha pendiente; entre esas, la que vence primero (así no
 * se pierden créditos).
 */
export function pickMembership(memberships: MembershipForBooking[], s: SessionForBooking) {
  const usable = memberships.filter((m) => covers(m, s));
  usable.sort((a, b) => {
    if ((a.classSessionId !== null) !== (b.classSessionId !== null)) return a.classSessionId !== null ? -1 : 1;
    if ((a.status === 'active') !== (b.status === 'active')) return a.status === 'active' ? -1 : 1;
    return (a.expiresAt?.getTime() ?? Infinity) - (b.expiresAt?.getTime() ?? Infinity);
  });
  return usable[0] ?? null;
}
