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
import type { CashRequestDto, SellAtClassDto, SellDto } from './memberships.dto.js';
import { assertTeaches, ATTENDANCE_OPENS_MS, BookingsService } from '../bookings/bookings.service.js';
import { consuming, payDeadline } from '../bookings/rules.js';
import { PurchaseMails } from './purchase-mails.js';
import { splitAmount } from './split.js';
import { CHECKOUT_MINUTES, StripeService, type CardPayment } from '../payments/stripe.service.js';

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
    private readonly stripe: StripeService,
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

  /**
   * La alumna paga con tarjeta: se crea la membresía esperando el pago (la clase individual aparta
   * su lugar mientras tanto) y se manda a la página de pago de Stripe. Se activa con el webhook.
   */
  async requestCard(user: AuthUser, dto: CashRequestDto) {
    const studentId = this.studentIdOf(user);
    if (!this.stripe.enabled) throw new BadRequestException('El pago con tarjeta no está disponible por ahora');
    const { plan, session } = await this.checkPurchase(dto);

    // Un intento anterior sin terminar del mismo plan se cierra: así no aparta dos lugares
    const previous = await this.prisma.membership.findMany({
      where: { studentId, planId: plan.id, status: 'awaiting_card', classSessionId: dto.classSessionId ?? null },
    });
    for (const p of previous) await this.cancelCard(p.id);

    // La sesión de pago vence en 30 min; la solicitud un poco después, por si el aviso de Stripe tarda
    const holdUntil = new Date(Date.now() + (CHECKOUT_MINUTES + 30) * 60_000);
    let id: number;
    if (session) {
      const refundNoShow = await this.settings.get('refund_credit_on_no_show', true);
      id = await this.prisma.$transaction(
        async (tx) => {
          const locked = await this.bookings.lockSession(tx, session.id);
          if (locked.status !== 'scheduled' || locked.startsAt <= new Date()) {
            throw new BadRequestException('Esa clase ya no está disponible');
          }
          const m = await tx.membership.create({
            data: { ...snapshot(plan, session.id), studentId, status: 'awaiting_card', requestExpiresAt: holdUntil },
          });
          await this.bookings.reserve(tx, locked, studentId, refundNoShow, 'booked', null, m.id);
          return m.id;
        },
        { timeout: 20_000 },
      );
    } else {
      const m = await this.prisma.membership.create({
        data: { ...snapshot(plan), studentId, status: 'awaiting_card', requestExpiresAt: holdUntil },
      });
      id = m.id;
    }

    try {
      const checkout = await this.stripe.checkout({
        membershipId: id,
        planName: plan.name,
        description: session ? `Clase del ${studioDate(session.startsAt)}` : plan.description ?? undefined,
        amountCents: plan.priceCents,
        currency: plan.currency,
        customerId: await this.stripeCustomer(studentId),
      });
      await this.prisma.membership.update({ where: { id }, data: { stripeCheckoutId: checkout.id } });
      return { url: checkout.url };
    } catch (e) {
      // Stripe no respondió: no se queda el lugar apartado
      await this.cancelPending(id);
      this.logger.error('No se pudo crear la página de pago de Stripe', e);
      throw new BadRequestException('No se pudo abrir el pago con tarjeta. Intenta de nuevo o paga en efectivo.');
    }
  }

  /** Cliente de Stripe de la alumna (se crea la primera vez que paga con tarjeta). */
  private async stripeCustomer(studentId: number) {
    const s = await this.prisma.student.findUniqueOrThrow({
      where: { id: studentId },
      select: { fullName: true, email: true, phone: true, stripeCustomerId: true, profile: { select: { email: true } } },
    });
    if (s.stripeCustomerId) return s.stripeCustomerId;
    const customer = await this.stripe.stripe.customers.create({
      name: s.fullName,
      email: s.profile?.email ?? s.email ?? undefined,
      phone: s.phone ?? undefined,
      metadata: { studentId: String(studentId) },
    });
    await this.prisma.student.update({ where: { id: studentId }, data: { stripeCustomerId: customer.id } });
    return customer.id;
  }

  /**
   * Ya la apartó en efectivo y prefiere pagar con tarjeta: se abre la página de pago sin soltar su
   * lugar. Si no termina, sigue apartada en efectivo como estaba.
   */
  async payPendingWithCard(user: AuthUser, id: number) {
    const m = await this.prisma.membership.findUnique({
      where: { id },
      include: { plan: true, classSession: true },
    });
    if (!m) throw new NotFoundException('La membresía no existe');
    if (m.studentId !== this.studentIdOf(user)) throw new ForbiddenException();
    if (!this.stripe.enabled) throw new BadRequestException('El pago con tarjeta no está disponible por ahora');
    if (m.status !== 'pending_payment' || (m.requestExpiresAt && m.requestExpiresAt <= new Date())) {
      throw new BadRequestException('Esta solicitud ya no está pendiente de pago');
    }
    if (m.stripeCheckoutId) await this.stripe.expireCheckout(m.stripeCheckoutId); // un intento anterior
    const checkout = await this.stripe.checkout({
      membershipId: m.id,
      planName: m.plan.name,
      description: m.classSession ? `Clase del ${studioDate(m.classSession.startsAt)}` : m.plan.description ?? undefined,
      amountCents: m.pricePaidCents,
      currency: m.currency,
      customerId: await this.stripeCustomer(m.studentId),
    });
    await this.prisma.membership.update({ where: { id }, data: { stripeCheckoutId: checkout.id } });
    return { url: checkout.url };
  }

  /**
   * Antes de cobrar en efectivo una solicitud con un pago con tarjeta abierto: si ya lo pagó, no se
   * cobra dos veces; si no, se cierra esa página de pago.
   */
  private async closeOpenCheckout(m: { id: number; stripeCheckoutId: string | null }) {
    if (!m.stripeCheckoutId || !this.stripe.enabled) return;
    const s = await this.stripe.stripe.checkout.sessions.retrieve(m.stripeCheckoutId);
    if (s.status === 'complete') throw new BadRequestException('Ya lo pagó con tarjeta; recarga la lista');
    if (s.status === 'open') await this.stripe.expireCheckout(s.id);
    await this.prisma.membership.update({ where: { id: m.id }, data: { stripeCheckoutId: null } });
  }

  /**
   * La página de pago venció o se cerró sin pagar. Si se compró con tarjeta, se cancela y se libera
   * el lugar; si estaba apartada en efectivo, sigue así.
   */
  async cancelCard(id: number, checkoutId?: string) {
    const m = await this.prisma.membership.findUnique({ where: { id } });
    if (m?.status === 'pending_payment' && checkoutId && m.stripeCheckoutId === checkoutId) {
      await this.prisma.membership.updateMany({ where: { id, stripeCheckoutId: checkoutId }, data: { stripeCheckoutId: null } });
      return;
    }
    if (m?.status !== 'awaiting_card') return;
    if (m.stripeCheckoutId) await this.stripe.expireCheckout(m.stripeCheckoutId);
    // Se vuelve a revisar: el pago pudo entrar mientras se cerraba la página
    const fresh = await this.prisma.membership.updateMany({ where: { id, status: 'awaiting_card' }, data: { status: 'cancelled' } });
    if (fresh.count) {
      await this.prisma.booking.updateMany({
        where: { membershipId: id, status: 'booked' },
        data: { status: 'cancelled_by_studio', cancelledAt: new Date() },
      });
    }
  }

  /** La alumna retira su solicitud pendiente (efectivo) o el pago con tarjeta que no terminó. */
  async cancelRequest(user: AuthUser, id: number) {
    const m = await this.find(id);
    if (m.studentId !== this.studentIdOf(user)) throw new ForbiddenException();
    if (m.status === 'awaiting_card') {
      await this.cancelCard(id);
      return (await this.view())(await this.prisma.membership.findUniqueOrThrow({ where: { id }, include: MEMBERSHIP_INCLUDE }));
    }
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
    await this.closeOpenCheckout(m);
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
    if (b.membership.status === 'awaiting_card') throw new BadRequestException('Está pagando con tarjeta; espera a que se confirme');
    if (b.membership.status !== 'pending_payment') throw new BadRequestException('Esta reserva ya está pagada');
    if (b.status !== 'booked' && b.status !== 'attended') throw new BadRequestException('Esa reserva está cancelada');
    if (b.session.status === 'cancelled') throw new BadRequestException('La sesión está cancelada');
    if (Date.now() < b.session.startsAt.getTime() - ATTENDANCE_OPENS_MS) {
      throw new BadRequestException('La lista se pasa a partir de 2 horas antes de la clase');
    }
    await this.closeOpenCheckout(b.membership);
    return this.activateWithCash(user, b.membershipId, { attendBookingId: b.id });
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
   * Llegó a la clase sin plan: se le vende la clase individual o una membresía de la disciplina,
   * se cobra en efectivo y queda con asistencia (gasta un crédito). Se puede mientras la lista está
   * abierta y la clase no termina.
   */
  async sellAtClass(user: AuthUser, { sessionId, studentId, planId }: SellAtClassDto) {
    const session = await this.prisma.classSession.findUnique({ where: { id: sessionId }, include: { class: true } });
    if (!session) throw new NotFoundException('La sesión no existe');
    assertTeaches(user, session);
    const now = Date.now();
    if (session.status !== 'scheduled' || session.endsAt.getTime() <= now) {
      throw new BadRequestException('Esa clase ya terminó o está cancelada');
    }
    if (now < session.startsAt.getTime() - ATTENDANCE_OPENS_MS) {
      throw new BadRequestException('La lista se pasa a partir de 2 horas antes de la clase');
    }
    const plan = await this.prisma.plan.findUnique({ where: { id: planId }, include: { revenueShares: true } });
    if (!plan?.isActive) throw new NotFoundException('El plan no existe o ya no está disponible');
    if (!plan.revenueShares.some((s) => s.disciplineId === session.class.disciplineId)) {
      throw new BadRequestException('Ese plan no incluye esta clase');
    }
    const student = await this.prisma.student.findUnique({ where: { id: studentId } });
    if (!student?.isActive) throw new NotFoundException('La alumna no existe');

    const created = await this.prisma.membership.create({
      data: { ...snapshot(plan, plan.kind === 'single_class' ? session.id : undefined), studentId, status: 'pending_payment' },
    });
    try {
      return await this.activateWithCash(user, created.id, { atSessionId: session.id });
    } catch (e) {
      // Sin lugar o ya en la lista: no queda una venta a medias
      await this.prisma.membership.delete({ where: { id: created.id } });
      throw e;
    }
  }

  /**
   * Activa la membresía, crea el pago en efectivo y su reparto, todo junto. Con attendBookingId
   * (cobro al pasar lista) también marca la asistencia a esa clase; con atSessionId (venta en la
   * clase) la agrega a esa clase con asistencia, aunque ya haya empezado.
   */
  private async activateWithCash(
    user: AuthUser,
    id: number,
    opts: { attendBookingId?: number; atSessionId?: number } = {},
  ) {
    const coachId = coachIdOf(user);
    return this.activate(id, { method: 'cash', coachId }, opts);
  }

  /**
   * Stripe confirmó el pago con tarjeta (webhook): se activa la membresía y se registra el pago.
   * El reparto entre coaches se hace sobre lo neto, ya sin la comisión de Stripe.
   */
  activateWithCard(id: number, checkoutId: string, card: CardPayment) {
    return this.activate(id, { method: 'card', coachId: null, checkoutId, card });
  }

  private async activate(
    id: number,
    pay: { method: 'cash'; coachId: number } | { method: 'card'; coachId: null; checkoutId: string; card: CardPayment },
    { attendBookingId, atSessionId }: { attendBookingId?: number; atSessionId?: number } = {},
  ) {
    const coachId = pay.coachId;
    const now = new Date();
    const refundNoShow = await this.settings.get('refund_credit_on_no_show', true);

    await this.prisma.$transaction(async (tx) => {
      // Venta en la clase: primero la sesión, en el mismo orden que al reservar
      const atSession = atSessionId ? await this.bookings.lockSession(tx, atSessionId) : null;
      if (atSession && (atSession.status !== 'scheduled' || atSession.endsAt <= now)) {
        throw new BadRequestException('Esa clase ya terminó o está cancelada');
      }
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
      // En efectivo, la solicitud pendiente; con tarjeta, la de esa página de pago (comprada con
      // tarjeta, o apartada en efectivo y pagada después con tarjeta)
      const ok =
        pay.method === 'cash'
          ? m.status === 'pending_payment'
          : (m.status === 'awaiting_card' || m.status === 'pending_payment') && m.stripeCheckoutId === pay.checkoutId;
      if (!ok) throw new BadRequestException('Esta solicitud ya no está pendiente');
      // Si ya está en la clase de su ficha, la vigencia cuenta desde esa clase
      const first = m.bookings[0]?.session.startsAt ?? atSession?.startsAt;
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
      } else if (atSession) {
        await this.bookings.reserve(tx, atSession, m.studentId, refundNoShow, 'attended', coachId);
      } else if (m.classSessionId && !m.bookings.length) {
        // Venta en persona de la clase individual: todavía no tiene lugar
        const session = await this.bookings.lockSession(tx, m.classSessionId);
        if (session.status !== 'scheduled' || session.startsAt <= now) {
          throw new BadRequestException('Esa clase ya no está disponible');
        }
        await this.bookings.reserve(tx, session, m.studentId, refundNoShow, 'booked', null);
      }

      const amounts =
        pay.method === 'cash'
          ? { grossCents: m.pricePaidCents, netCents: m.pricePaidCents, receivedById: coachId }
          : {
              grossCents: pay.card.grossCents,
              feeCents: pay.card.feeCents,
              netCents: pay.card.netCents,
              stripePaymentIntentId: pay.card.paymentIntentId,
              stripeChargeId: pay.card.chargeId,
            };
      const allocations = splitAmount(amounts.netCents, m.plan.revenueShares);
      await tx.payment.create({
        data: {
          studentId: m.studentId,
          membershipId: m.id,
          method: pay.method,
          status: 'succeeded',
          ...amounts,
          currency: m.currency,
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

    this.mails.paid(id, coachId ?? undefined);
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
          WHERE status IN ('pending_payment', 'awaiting_card') AND request_expires_at <= ${now}
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
