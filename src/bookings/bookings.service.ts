import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { AuthUser } from '../auth/auth-user.js';
import { coachIdOf, isAdmin } from '../auth/permissions.js';
import { STUDIO_TZ, studioDate, studioDateTime, addDays } from '../common/studio-time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  bookableUntil,
  consuming,
  covers,
  OCCUPYING,
  payDeadline,
  pickMembership,
  type BookingOpens,
  type MembershipForBooking,
} from './rules.js';

type Tx = Prisma.TransactionClient;

const DAY_MS = 86_400_000;

/** Se puede pasar lista desde 2 horas antes de la clase. */
export const ATTENDANCE_OPENS_MS = 2 * 3_600_000;

const time = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: STUDIO_TZ, hour: '2-digit', minute: '2-digit' }).format(d);

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private policy() {
    return Promise.all([
      this.settings.get<boolean>('refund_credit_on_no_show', true),
      this.settings.get<BookingOpens>('booking_opens', { weekday: 6, time: '06:00' }),
    ]);
  }

  // ─── Alumna ─────────────────────────────────────────────────────────────

  /** Sesiones que se pueden reservar ahora, con su reserva y si alguna membresía la cubre. */
  async available(user: AuthUser) {
    const studentId = studentIdOf(user);
    const [refundNoShow, opens] = await this.policy();
    const now = new Date();
    const until = bookableUntil(now, opens);

    const [sessions, memberships] = await Promise.all([
      this.prisma.classSession.findMany({
        where: { startsAt: { gt: now, lt: studioDateTime(addDays(until, 1), '00:00') } },
        include: {
          class: { select: { name: true, disciplineId: true, discipline: { select: { name: true, slug: true } } } },
          coach: { select: { profile: { select: { fullName: true } } } },
          bookings: { where: { OR: [{ status: { in: OCCUPYING } }, { studentId }] }, select: { studentId: true, status: true, id: true } },
        },
        orderBy: { startsAt: 'asc' },
      }),
      this.membershipsFor(this.prisma, studentId, refundNoShow),
    ]);

    return {
      bookableUntil: until,
      sessions: sessions.map((s) => {
        const booked = s.bookings.filter((b) => OCCUPYING.includes(b.status)).length;
        const mine = s.bookings.find((b) => b.studentId === studentId) ?? null;
        const membership = pickMembership(memberships, { id: s.id, startsAt: s.startsAt, disciplineId: s.class.disciplineId });
        const covering = membership && memberships.find((m) => m.id === membership.id)!;
        return {
          id: s.id,
          startsAt: s.startsAt,
          date: studioDate(s.startsAt),
          time: time(s.startsAt),
          status: s.status,
          cancelReason: s.cancelReason,
          class: { name: s.class.name },
          discipline: s.class.discipline,
          coach: { name: s.coach.profile.fullName },
          capacity: s.capacity,
          spotsLeft: Math.max(0, s.capacity - booked),
          myBooking: mine && { id: mine.id, status: mine.status },
          coveredBy: covering?.planName ?? null,
          // Con la ficha de una membresía sin pagar: lo que se paga al llegar a la clase
          payAtClassCents: covering?.status === 'pending_payment' ? covering.priceCents : null,
        };
      }),
    };
  }

  /** Mis reservas: próximas y las últimas pasadas. */
  async mine(user: AuthUser) {
    const studentId = studentIdOf(user);
    const rows = await this.prisma.booking.findMany({
      where: { studentId },
      include: {
        session: { include: { class: { select: { name: true } }, coach: { select: { profile: { select: { fullName: true } } } } } },
        membership: { select: { status: true, pricePaidCents: true, plan: { select: { name: true } } } },
      },
      orderBy: { session: { startsAt: 'desc' } },
      take: 60,
    });
    return rows.map((b) => ({
      id: b.id,
      status: b.status,
      startsAt: b.session.startsAt,
      date: studioDate(b.session.startsAt),
      time: time(b.session.startsAt),
      sessionStatus: b.session.status,
      className: b.session.class.name,
      coachName: b.session.coach.profile.fullName,
      planName: b.membership.plan.name,
      // Reservada sin pagar: se paga en efectivo al llegar a la clase
      payAtClassCents: b.membership.status === 'pending_payment' ? b.membership.pricePaidCents : null,
    }));
  }

  /** Reservar: aparta lugar y gasta un crédito de la membresía que vence primero. */
  async book(user: AuthUser, sessionId: number) {
    const studentId = studentIdOf(user);
    const [refundNoShow, opens] = await this.policy();
    const now = new Date();

    return this.prisma.$transaction(
      async (tx) => {
        const session = await this.lockSession(tx, sessionId);
        if (session.status !== 'scheduled' || session.startsAt <= now) throw new BadRequestException('Esa clase ya no se puede reservar');
        if (studioDate(session.startsAt) > bookableUntil(now, opens)) {
          throw new BadRequestException('Esa semana todavía no abre reservas (abre el sábado a las 6:00 a.m.)');
        }
        const booking = await this.reserve(tx, session, studentId, refundNoShow, 'booked', null);
        return { id: booking.id, status: booking.status };
      },
      { timeout: 20_000 },
    );
  }

  /**
   * Cancelar mi reserva antes de la clase: recupero el crédito. Si no estaba pagada, la clase
   * individual se cancela y la ficha de la membresía queda libre para otra clase.
   */
  async cancel(user: AuthUser, bookingId: number) {
    const studentId = studentIdOf(user);
    const b = await this.prisma.booking.findUnique({ where: { id: bookingId }, include: { session: true, membership: true } });
    if (!b || b.studentId !== studentId) throw new NotFoundException('Esa reserva no existe');
    if (b.status !== 'booked') throw new BadRequestException('Esa reserva ya no está activa');
    if (b.session.startsAt <= new Date()) throw new BadRequestException('La clase ya empezó');
    const now = new Date();
    const unpaid = b.membership.status === 'pending_payment';
    const days = unpaid ? await this.settings.get('cash_request_days', 3) : 0;
    await this.prisma.$transaction([
      this.prisma.booking.update({ where: { id: bookingId }, data: { status: 'cancelled_by_student', cancelledAt: now } }),
      ...(unpaid
        ? [
            this.prisma.membership.update({
              where: { id: b.membershipId },
              data: b.membership.classSessionId
                ? { status: 'cancelled' }
                : { requestExpiresAt: new Date(now.getTime() + days * DAY_MS) },
            }),
          ]
        : []),
    ]);
    return { id: bookingId, status: 'cancelled_by_student' };
  }

  // ─── Coach ──────────────────────────────────────────────────────────────

  /** Lista de la clase para pasar asistencia. */
  async roster(user: AuthUser, sessionId: number) {
    const session = await this.prisma.classSession.findUnique({
      where: { id: sessionId },
      include: {
        class: { select: { name: true, coachId: true } },
        bookings: {
          include: {
            student: {
              select: { id: true, fullName: true, phone: true, profileId: true, photoPath: true, health: { select: { specialConditions: true } } },
            },
            membership: { select: { id: true, status: true, pricePaidCents: true, plan: { select: { name: true, kind: true } } } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!session) throw new NotFoundException('La sesión no existe');
    assertTeaches(user, session);
    const booked = session.bookings.filter((b) => OCCUPYING.includes(b.status)).length;
    return {
      id: session.id,
      className: session.class.name,
      startsAt: session.startsAt,
      status: session.status,
      capacity: session.capacity,
      spotsLeft: Math.max(0, session.capacity - booked),
      canMark: Date.now() >= session.startsAt.getTime() - ATTENDANCE_OPENS_MS,
      bookings: session.bookings.map((b) => ({
        id: b.id,
        status: b.status,
        student: {
          id: b.student.id,
          fullName: b.student.fullName,
          phone: b.student.phone,
          usesApp: b.student.profileId !== null,
          photoPath: b.student.photoPath,
          specialConditions: b.student.health?.specialConditions ?? null,
        },
        planName: b.membership.plan.name,
        // Paga en efectivo al llegar: qué se cobra y cuánto
        payment:
          b.membership.status === 'pending_payment'
            ? { planName: b.membership.plan.name, kind: b.membership.plan.kind, amountCents: b.membership.pricePaidCents }
            : null,
      })),
    };
  }

  /**
   * Alumnas que se pueden agregar a la lista: activas, sin lugar en esta sesión y con una
   * membresía que cubre la clase (las que no usan la app llegan sin reservar). Las que pidieron
   * su plan en efectivo y no han pagado aparecen para cobrarles al llegar.
   */
  async candidates(user: AuthUser, sessionId: number) {
    const session = await this.prisma.classSession.findUnique({
      where: { id: sessionId },
      include: { class: { select: { coachId: true, disciplineId: true } }, bookings: { select: { studentId: true, status: true } } },
    });
    if (!session) throw new NotFoundException('La sesión no existe');
    assertTeaches(user, session);
    const [refundNoShow] = await this.policy();
    const taken = new Set(session.bookings.filter((b) => OCCUPYING.includes(b.status)).map((b) => b.studentId));
    const rows = await this.prisma.membership.findMany({
      where: {
        OR: [{ status: 'active' }, { status: 'pending_payment', requestExpiresAt: { gt: new Date() } }],
        student: { isActive: true },
        plan: { revenueShares: { some: { disciplineId: session.class.disciplineId } } },
        AND: [{ OR: [{ classSessionId: null }, { classSessionId: session.id }] }],
      },
      include: {
        student: { select: { id: true, fullName: true, phone: true, profileId: true, photoPath: true } },
        plan: { select: { name: true, revenueShares: { select: { disciplineId: true } } } },
        _count: { select: { bookings: { where: { status: { in: consuming(refundNoShow) } } } } },
      },
    });
    const target = { id: session.id, startsAt: session.startsAt, disciplineId: session.class.disciplineId };
    type Candidate = { id: number; fullName: string; phone: string | null; usesApp: boolean; photoPath: string | null; planName: string; paysToday: boolean };
    const byStudent = new Map<number, Candidate>();
    // Primero las pagadas: si tiene las dos, se usa la pagada
    rows.sort((a, b) => Number(a.status !== 'active') - Number(b.status !== 'active'));
    for (const m of rows) {
      if (taken.has(m.studentId) || byStudent.has(m.studentId)) continue;
      const fits = covers(
        {
          id: m.id,
          status: m.status,
          startsAt: m.startsAt,
          expiresAt: m.expiresAt,
          creditsTotal: m.creditsTotal,
          classSessionId: m.classSessionId,
          disciplineIds: m.plan.revenueShares.map((s) => s.disciplineId),
          used: m._count.bookings,
        },
        target,
      );
      if (!fits) continue;
      byStudent.set(m.studentId, {
        id: m.student.id,
        fullName: m.student.fullName,
        phone: m.student.phone,
        usesApp: m.student.profileId !== null,
        photoPath: m.student.photoPath,
        planName: m.plan.name,
        paysToday: m.status === 'pending_payment',
      });
    }
    return [...byStudent.values()].sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));
  }

  /** Pasar lista: asistió, faltó o volver a "reservada". */
  async mark(user: AuthUser, bookingId: number, status: 'attended' | 'no_show' | 'booked') {
    const b = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { session: { include: { class: true } }, membership: { select: { status: true } } },
    });
    if (!b) throw new NotFoundException('Esa reserva no existe');
    assertTeaches(user, b.session);
    if (status === 'attended' && b.membership.status === 'pending_payment') {
      throw new BadRequestException('Esta alumna paga hoy en efectivo: usa “Asistencia y pago”');
    }
    if (b.status === 'cancelled_by_student' || b.status === 'cancelled_by_studio') {
      throw new BadRequestException('Esa reserva está cancelada');
    }
    if (b.session.status === 'cancelled') throw new BadRequestException('La sesión está cancelada');
    if (Date.now() < b.session.startsAt.getTime() - ATTENDANCE_OPENS_MS) {
      throw new BadRequestException('La lista se pasa a partir de 2 horas antes de la clase');
    }
    const marked = status === 'booked' ? { markedById: null, markedAt: null } : { markedById: coachIdOf(user), markedAt: new Date() };
    await this.prisma.booking.update({ where: { id: bookingId }, data: { status, ...marked } });
    return { id: bookingId, status };
  }

  /** Alumna que llegó sin reservar (o sin app): se agrega con asistencia y gasta su crédito. */
  async walkIn(user: AuthUser, sessionId: number, studentId: number) {
    const [refundNoShow] = await this.policy();
    return this.prisma.$transaction(
      async (tx) => {
        const session = await this.lockSession(tx, sessionId);
        assertTeaches(user, session);
        if (session.status === 'cancelled') throw new BadRequestException('La sesión está cancelada');
        if (Date.now() < session.startsAt.getTime() - ATTENDANCE_OPENS_MS) {
          throw new BadRequestException('La lista se pasa a partir de 2 horas antes de la clase');
        }
        const student = await tx.student.findUnique({ where: { id: studentId } });
        if (!student?.isActive) throw new NotFoundException('La alumna no existe');
        const booking = await this.reserve(tx, session, studentId, refundNoShow, 'attended', coachIdOf(user));
        // 'booked' = paga hoy en efectivo: se le cobra con "Asistencia y pago"
        return { id: booking.id, status: booking.status };
      },
      { timeout: 20_000 },
    );
  }

  // ─── Compartido ─────────────────────────────────────────────────────────

  /**
   * Aparta el lugar y elige la membresía. Bloquea la sesión y las membresías de la alumna
   * para que dos reservas simultáneas no pasen el cupo ni gasten el mismo crédito.
   */
  async reserve(
    tx: Tx,
    session: LockedSession,
    studentId: number,
    refundNoShow: boolean,
    status: 'booked' | 'attended',
    markedById: number | null,
  ) {
    const existing = await tx.booking.findUnique({ where: { sessionId_studentId: { sessionId: session.id, studentId } } });
    // La alumna reserva ('booked'); la coach agrega a quien llegó ('attended')
    const self = status === 'booked';
    if (existing && OCCUPYING.includes(existing.status)) {
      throw new ConflictException(self ? 'Ya tienes lugar en esta clase' : 'Esa alumna ya tiene lugar en esta clase');
    }

    const taken = await tx.booking.count({ where: { sessionId: session.id, status: { in: OCCUPYING } } });
    if (taken >= session.capacity) throw new ConflictException('La clase está llena');

    await tx.$queryRaw`SELECT id FROM memberships WHERE student_id = ${studentId} AND status IN ('active', 'pending_payment') FOR UPDATE`;
    const memberships = await this.membershipsFor(tx, studentId, refundNoShow);
    const membership = pickMembership(memberships, { id: session.id, startsAt: session.startsAt, disciplineId: session.disciplineId });
    if (!membership) {
      throw new BadRequestException(
        self
          ? 'No tienes una membresía activa con créditos para esta clase'
          : 'Esa alumna no tiene una membresía activa con créditos para esta clase. Véndele un plan en “Alumnas”.',
      );
    }

    // La ficha de una membresía sin pagar: se paga al llegar, y si no, se cancela al terminar la clase.
    // Si la coach la agrega a la lista, queda reservada para cobrarle con "Asistencia y pago".
    const unpaid = membership.status === 'pending_payment';
    if (unpaid) {
      await tx.membership.update({ where: { id: membership.id }, data: { requestExpiresAt: payDeadline(session.endsAt) } });
    }
    const marked = unpaid ? null : markedById;
    const data = {
      status: unpaid ? ('booked' as const) : status,
      membershipId: membership.id,
      cancelledAt: null,
      markedById: marked,
      markedAt: marked ? new Date() : null,
    };
    return existing
      ? tx.booking.update({ where: { id: existing.id }, data })
      : tx.booking.create({ data: { ...data, sessionId: session.id, studentId } });
  }

  /** Bloquea la fila de la sesión hasta el final de la transacción. */
  async lockSession(tx: Tx, sessionId: number): Promise<LockedSession> {
    const [row] = await tx.$queryRaw<LockedSession[]>`
      SELECT s.id, s.starts_at AS "startsAt", s.ends_at AS "endsAt", s.capacity, s.status::text AS status, s.coach_id AS "coachId",
             c.coach_id AS "classCoachId", c.discipline_id AS "disciplineId"
      FROM class_sessions s JOIN classes c ON c.id = s.class_id
      WHERE s.id = ${sessionId}
      FOR UPDATE OF s`;
    if (!row) throw new NotFoundException('La sesión no existe');
    return row;
  }

  /** Membresías activas (y pendientes de pago en efectivo, vigentes) con los créditos que ya gastó. */
  private async membershipsFor(db: Tx | PrismaService, studentId: number, refundNoShow: boolean) {
    const rows = await db.membership.findMany({
      where: {
        studentId,
        OR: [{ status: 'active' }, { status: 'pending_payment', requestExpiresAt: { gt: new Date() } }],
      },
      include: {
        plan: { select: { name: true, revenueShares: { select: { disciplineId: true } } } },
        _count: { select: { bookings: { where: { status: { in: consuming(refundNoShow) } } } } },
      },
    });
    return rows.map(
      (m): MembershipForBooking & { planName: string; priceCents: number } => ({
        id: m.id,
        status: m.status,
        startsAt: m.startsAt,
        expiresAt: m.expiresAt,
        creditsTotal: m.creditsTotal,
        classSessionId: m.classSessionId,
        disciplineIds: m.plan.revenueShares.map((s) => s.disciplineId),
        used: m._count.bookings,
        planName: m.plan.name,
        priceCents: m.pricePaidCents,
      }),
    );
  }
}

export interface LockedSession {
  id: number;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  status: string;
  coachId: number;
  classCoachId: number;
  disciplineId: number;
}

function studentIdOf(user: AuthUser) {
  const id = user.profile?.student?.id;
  if (!id) throw new ForbiddenException('Solo las alumnas reservan desde la app');
  return id;
}

/**
 * Pasa lista quien da la sesión (o la dueña de la clase) y el admin. Así, en el plan
 * combinado, cada coach registra la asistencia de las alumnas que van a su clase.
 */
export function assertTeaches(user: AuthUser, s: { coachId: number; classCoachId?: number; class?: { coachId: number } }) {
  if (isAdmin(user)) return;
  const me = coachIdOf(user);
  if (s.coachId !== me && (s.classCoachId ?? s.class?.coachId) !== me) {
    throw new ForbiddenException('Solo la coach de esta clase puede pasar lista');
  }
}
