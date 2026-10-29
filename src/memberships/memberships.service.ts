import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '../generated/prisma/client.js';
import type { AuthUser } from '../auth/auth-user.js';
import { coachIdOf, isAdmin } from '../auth/permissions.js';
import { STUDIO_TZ, studioDate } from '../common/studio-time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { CashRequestDto, SellDto } from './memberships.dto.js';
import { assertTeaches, ATTENDANCE_OPENS_MS, BookingsService } from '../bookings/bookings.service.js';
import { consuming, payDeadline } from '../bookings/rules.js';
import { PurchaseMails } from './purchase-mails.js';
import { splitAmount } from './split.js';

const DAY_MS = 86_400_000;
/** Reservas que gastan crédito */
const OCCUPYING = ['booked', 'attended'] as const;

export const MEMBERSHIP_INCLUDE = {
  plan: {
    include: {
      revenueShares: { include: { discipline: { select: { id: true, name: true, slug: true } } }, orderBy: { id: 'asc' } },
    },
  },
  student: { select: { id: true, fullName: true, phone: true, email: true } },
  classSession: { include: { class: { select: { name: true } } } },
  bookings: { select: { status: true, session: { select: { startsAt: true, class: { select: { name: true } } } } } },
} satisfies Prisma.MembershipInclude;

type MembershipRow = Prisma.MembershipGetPayload<{ include: typeof MEMBERSHIP_INCLUDE }>;

@Injectable()
export class MembershipsService {
  private readonly logger = new Logger(MembershipsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly bookings: BookingsService,
    private readonly mails: PurchaseMails,
  ) {}

  /** Presenta membresías contando créditos según la política de faltas. */
  private async view() {
    const refundNoShow = await this.settings.get('refund_credit_on_no_show', true);
    return (m: MembershipRow) => present(m, refundNoShow);
  }

  /** Las membresías de la alumna que pregunta (la más nueva primero). */
  async mine(user: AuthUser) {
    const studentId = this.studentIdOf(user);
    const rows = await this.prisma.membership.findMany({
      where: { studentId },
      include: MEMBERSHIP_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(await this.view());
  }

  /** La alumna pide un plan y paga en efectivo el día que asiste: queda pendiente hasta que una coach cobre. */
  async requestCash(user: AuthUser, dto: CashRequestDto) {
    const studentId = this.studentIdOf(user);
    const { plan, session } = await this.checkPurchase(dto);

    const duplicate = await this.prisma.membership.findFirst({
      where: {
        studentId,
        planId: plan.id,
        status: 'pending_payment',
        requestExpiresAt: { gt: new Date() },
        classSessionId: dto.classSessionId ?? null,
      },
    });
    if (duplicate) throw new ConflictException('Ya tienes una solicitud pendiente de este plan');

    let id: number;
    if (session) {
      // Clase individual: se aparta el lugar ya y se paga al llegar a la clase
      const refundNoShow = await this.settings.get('refund_credit_on_no_show', true);
      id = await this.prisma.$transaction(
        async (tx) => {
          const locked = await this.bookings.lockSession(tx, session.id);
          if (locked.status !== 'scheduled' || locked.startsAt <= new Date()) {
            throw new BadRequestException('Esa clase ya no está disponible');
          }
          const m = await tx.membership.create({
            data: { ...snapshot(plan, session.id), studentId, status: 'pending_payment', requestExpiresAt: payDeadline(locked.endsAt) },
          });
          await this.bookings.reserve(tx, locked, studentId, refundNoShow, 'booked', null);
          return m.id;
        },
        { timeout: 20_000 },
      );
    } else {
      // Membresía: da una ficha para reservar una clase; se paga ese día y se activan las demás
      const days = await this.settings.get('cash_request_days', 3);
      const m = await this.prisma.membership.create({
        data: { ...snapshot(plan), studentId, status: 'pending_payment', requestExpiresAt: new Date(Date.now() + days * DAY_MS) },
      });
      id = m.id;
    }
    this.mails.requested(id);
    return (await this.view())(await this.prisma.membership.findUniqueOrThrow({ where: { id }, include: MEMBERSHIP_INCLUDE }));
  }

  /** La alumna retira su solicitud pendiente. */
  async cancelRequest(user: AuthUser, id: number) {
    const m = await this.find(id);
    if (m.studentId !== this.studentIdOf(user)) throw new ForbiddenException();
    if (m.status !== 'pending_payment') throw new BadRequestException('Solo se pueden retirar solicitudes pendientes');
    return this.cancelPending(id);
  }

  /** Cancela la solicitud y libera el lugar de la clase que había reservado sin pagar. */
  private async cancelPending(id: number) {
    const [updated] = await this.prisma.$transaction([
      this.prisma.membership.update({ where: { id }, data: { status: 'cancelled' }, include: MEMBERSHIP_INCLUDE }),
      this.prisma.booking.updateMany({
        where: { membershipId: id, status: 'booked' },
        data: { status: 'cancelled_by_studio', cancelledAt: new Date() },
      }),
    ]);
    return (await this.view())(updated);
  }

  /** Solicitudes en efectivo que esa coach puede confirmar. */
  async requests(user: AuthUser) {
    const rows = await this.prisma.membership.findMany({
      where: {
        status: 'pending_payment',
        requestExpiresAt: { gt: new Date() },
        ...(isAdmin(user) ? {} : { plan: { revenueShares: { some: { coachId: coachIdOf(user) } } } }),
      },
      include: MEMBERSHIP_INCLUDE,
      orderBy: { requestExpiresAt: 'asc' },
    });
    return rows.map(await this.view());
  }

  /** La coach recibió el efectivo: se activa la membresía y se registra el pago repartido. */
  async approve(user: AuthUser, id: number) {
    const m = await this.find(id);
    await this.assertSells(user, m.planId);
    if (m.status !== 'pending_payment') throw new BadRequestException('La solicitud ya no está pendiente');
    if (m.requestExpiresAt && m.requestExpiresAt <= new Date()) {
      throw new BadRequestException('La solicitud venció; la alumna debe pedirla de nuevo');
    }
    return this.activateWithCash(user, m.id);
  }

  async reject(user: AuthUser, id: number) {
    const m = await this.find(id);
    await this.assertSells(user, m.planId);
    if (m.status !== 'pending_payment') throw new BadRequestException('La solicitud ya no está pendiente');
    return this.cancelPending(id);
  }

  /**
   * Pase de lista con cobro: la alumna llegó a la clase que reservó sin pagar y paga en efectivo.
   * Se marca la asistencia, se activa su plan y se registra el pago, todo junto.
   */
  async collect(user: AuthUser, bookingId: number) {
    const b = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { membership: true, session: { include: { class: true } } },
    });
    if (!b) throw new NotFoundException('Esa reserva no existe');
    assertTeaches(user, b.session);
    if (b.membership.status !== 'pending_payment') throw new BadRequestException('Esta reserva ya está pagada');
    if (b.status !== 'booked' && b.status !== 'attended') throw new BadRequestException('Esa reserva está cancelada');
    if (b.session.status === 'cancelled') throw new BadRequestException('La sesión está cancelada');
    if (Date.now() < b.session.startsAt.getTime() - ATTENDANCE_OPENS_MS) {
      throw new BadRequestException('La lista se pasa a partir de 2 horas antes de la clase');
    }
    return this.activateWithCash(user, b.membershipId, b.id);
  }

  /** Venta en persona: la coach registra el plan de una alumna y el pago en efectivo. */
  async sell(user: AuthUser, dto: SellDto) {
    await this.assertSells(user, dto.planId);
    const student = await this.prisma.student.findUnique({ where: { id: dto.studentId } });
    if (!student?.isActive) throw new NotFoundException('La alumna no existe');
    const { plan, session } = await this.checkPurchase(dto);

    const created = await this.prisma.membership.create({
      data: { ...snapshot(plan, session?.id), studentId: student.id, status: 'pending_payment' },
    });
    return this.activateWithCash(user, created.id);
  }

  /**
   * Activa la membresía, crea el pago en efectivo y su reparto, todo junto. Con attendBookingId
   * (cobro al pasar lista) también marca la asistencia a esa clase.
   */
  private async activateWithCash(user: AuthUser, id: number, attendBookingId?: number) {
    const coachId = coachIdOf(user);
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      // Bloquea la membresía: dos cobros a la vez (o el vencimiento) no la procesan dos veces
      await tx.$queryRaw`SELECT id FROM memberships WHERE id = ${id} FOR UPDATE`;
      const m = await tx.membership.findUniqueOrThrow({
        where: { id },
        include: {
          plan: { include: { revenueShares: { orderBy: { id: 'asc' } } } },
          classSession: true,
          bookings: { where: { status: { in: [...OCCUPYING] } }, include: { session: true } },
        },
      });
      if (m.status !== 'pending_payment') throw new BadRequestException('Esta solicitud ya no está pendiente');
      // Si ya está en la clase de su ficha, la vigencia cuenta desde esa clase
      const first = m.bookings[0]?.session.startsAt;
      const startsAt = first && first < now ? first : now;
      const expiresAt = m.classSession
        ? m.classSession.endsAt
        : new Date(startsAt.getTime() + m.plan.durationDays * DAY_MS);

      await tx.membership.update({
        where: { id },
        data: { status: 'active', startsAt, expiresAt, requestExpiresAt: null, approvedById: coachId, approvedAt: now },
      });

      if (attendBookingId) {
        await tx.booking.update({ where: { id: attendBookingId }, data: { status: 'attended', markedById: coachId, markedAt: now } });
      } else if (m.classSessionId && !m.bookings.length) {
        // Venta en persona de la clase individual: todavía no tiene lugar
        const refundNoShow = await this.settings.get('refund_credit_on_no_show', true);
        const session = await this.bookings.lockSession(tx, m.classSessionId);
        if (session.status !== 'scheduled' || session.startsAt <= now) {
          throw new BadRequestException('Esa clase ya no está disponible');
        }
        await this.bookings.reserve(tx, session, m.studentId, refundNoShow, 'booked', null);
      }

      const allocations = splitAmount(m.pricePaidCents, m.plan.revenueShares);
      await tx.payment.create({
        data: {
          studentId: m.studentId,
          membershipId: m.id,
          method: 'cash',
          status: 'succeeded',
          grossCents: m.pricePaidCents,
          netCents: m.pricePaidCents,
          currency: m.currency,
          receivedById: coachId,
          paidAt: now,
          allocations: {
            create: allocations.map((a) => ({
              coachId: a.coachId,
              disciplineId: a.disciplineId,
              basisPoints: a.basisPoints,
              amountCents: a.amountCents,
            })),
          },
        },
      });
    });

    this.mails.paid(id, coachId);
    return (await this.view())(await this.prisma.membership.findUniqueOrThrow({ where: { id }, include: MEMBERSHIP_INCLUDE }));
  }

  /**
   * Cada hora: vencen las membresías y se cancelan las solicitudes en efectivo sin pagar, con su
   * reserva. La de una clase reservada vence 2 horas después de que termina la clase.
   */
  @Cron('10 * * * *', { timeZone: STUDIO_TZ })
  async expire() {
    const now = new Date();
    const [expired, lapsed] = await this.prisma.$transaction(async (tx) => {
      const done = await tx.membership.updateMany({ where: { status: 'active', expiresAt: { lte: now } }, data: { status: 'expired' } });
      const ids = (
        await tx.$queryRaw<{ id: number }[]>`
          SELECT id FROM memberships
          WHERE status = 'pending_payment' AND request_expires_at <= ${now}
          FOR UPDATE SKIP LOCKED`
      ).map((r) => r.id);
      if (ids.length) {
        await tx.membership.updateMany({ where: { id: { in: ids } }, data: { status: 'cancelled' } });
        await tx.booking.updateMany({
          where: { membershipId: { in: ids }, status: 'booked' },
          data: { status: 'cancelled_by_studio', cancelledAt: now },
        });
      }
      return [done.count, ids.length];
    });
    if (expired || lapsed) this.logger.log(`${expired} membresías vencidas, ${lapsed} solicitudes sin pagar canceladas`);
    return { expired, requestsCancelled: lapsed };
  }

  /** El plan existe y está activo; la clase individual pide una sesión válida de su disciplina. */
  private async checkPurchase(dto: CashRequestDto) {
    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId }, include: { revenueShares: true } });
    if (!plan?.isActive) throw new NotFoundException('El plan no existe o ya no está disponible');

    if (plan.kind !== 'single_class') {
      if (dto.classSessionId) throw new BadRequestException('Solo la clase individual se compra para una sesión');
      return { plan, session: null };
    }
    if (!dto.classSessionId) throw new BadRequestException('Elige la clase a la que vas a ir');
    const session = await this.prisma.classSession.findUnique({
      where: { id: dto.classSessionId },
      include: { class: true, _count: { select: { bookings: { where: { status: { in: [...OCCUPYING] } } } } } },
    });
    if (!session || session.status !== 'scheduled' || session.startsAt <= new Date()) {
      throw new BadRequestException('Esa clase ya no está disponible');
    }
    if (!plan.revenueShares.some((s) => s.disciplineId === session.class.disciplineId)) {
      throw new BadRequestException('Esa clase no es de la disciplina del plan');
    }
    if (session._count.bookings >= session.capacity) throw new BadRequestException('Esa clase ya está llena');
    return { plan, session };
  }

  /** Puede vender o confirmar un plan quien recibe parte de su dinero, o el admin. */
  private async assertSells(user: AuthUser, planId: number) {
    if (isAdmin(user)) return;
    const coachId = coachIdOf(user);
    const share = await this.prisma.planRevenueShare.findFirst({ where: { planId, coachId } });
    if (!share) throw new ForbiddenException('Ese plan no es de tus disciplinas');
  }

  private studentIdOf(user: AuthUser) {
    const id = user.profile?.student?.id;
    if (!id) throw new ForbiddenException('Solo las alumnas compran membresías desde la app');
    return id;
  }

  private async find(id: number) {
    const m = await this.prisma.membership.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('La membresía no existe');
    return m;
  }
}

/** Lo que se copia del plan al comprarlo: si el plan cambia después, la compra no. */
const snapshot = (
  plan: { id: number; credits: number | null; priceCents: number; currency: string; trainingDays: number[] },
  classSessionId?: number,
) => ({
  planId: plan.id,
  creditsTotal: plan.credits,
  pricePaidCents: plan.priceCents,
  currency: plan.currency,
  trainingDays: plan.trainingDays,
  classSessionId: classSessionId ?? null,
});

export function present(m: MembershipRow, refundNoShow = true) {
  const statuses: string[] = consuming(refundNoShow);
  const used = m.bookings.filter((b) => statuses.includes(b.status)).length;
  return {
    id: m.id,
    status: m.status,
    plan: {
      id: m.plan.id,
      name: m.plan.name,
      kind: m.plan.kind,
      disciplines: m.plan.revenueShares.map((s) => s.discipline),
    },
    student: m.student,
    pricePaidCents: m.pricePaidCents,
    creditsTotal: m.creditsTotal,
    creditsUsed: used,
    creditsLeft: m.creditsTotal === null ? null : Math.max(0, m.creditsTotal - used),
    startsAt: m.startsAt,
    expiresAt: m.expiresAt,
    expiresOn: m.expiresAt ? studioDate(m.expiresAt) : null,
    requestExpiresAt: m.requestExpiresAt,
    classSession: m.classSession && {
      id: m.classSession.id,
      name: m.classSession.class.name,
      startsAt: m.classSession.startsAt,
      date: studioDate(m.classSession.startsAt),
    },
    autoRenew: m.autoRenew,
    createdAt: m.createdAt,
    // Pendiente de pago: la clase que reservó con la ficha, donde paga
    bookedClass: (() => {
      const b = m.status === 'pending_payment' ? m.bookings.find((x) => x.status === 'booked') : undefined;
      return b ? { name: b.session.class.name, startsAt: b.session.startsAt } : null;
    })(),
  };
}
