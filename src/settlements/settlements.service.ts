import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '../generated/prisma/client.js';
import type { AuthUser } from '../auth/auth-user.js';
import { coachIdOf, isAdmin } from '../auth/permissions.js';
import { addDays, asDateColumn, dateOnly, STUDIO_TZ, studioDate, studioDateTime, weekStart } from '../common/studio-time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { settle, type SettleAllocation } from './settle.js';
import type { SettlementPaymentDto } from './settlements.dto.js';

const ALLOCATION_INCLUDE = {
  discipline: { select: { id: true, name: true } },
  payment: {
    select: {
      id: true,
      method: true,
      grossCents: true,
      feeCents: true,
      netCents: true,
      paidAt: true,
      receivedById: true,
      payout: { select: { arrivalDate: true } },
      student: { select: { fullName: true } },
      membership: { select: { plan: { select: { name: true } } } },
    },
  },
} satisfies Prisma.PaymentAllocationInclude;

type AllocationRow = Prisma.PaymentAllocationGetPayload<{ include: typeof ALLOCATION_INCLUDE }>;

/**
 * Corte semanal (lunes a domingo). El efectivo cuenta por la fecha en que se cobró; la tarjeta,
 * por la fecha en que Stripe depositó en la cuenta de la head coach.
 */
@Injectable()
export class SettlementsService {
  private readonly logger = new Logger(SettlementsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async week(user: AuthUser, start?: string) {
    const monday = weekStart(start ?? studioDate(new Date()));
    const sunday = addDays(monday, 6);
    const me = isAdmin(user) ? null : coachIdOf(user);

    const [period, coaches, holder] = await Promise.all([
      this.prisma.settlementPeriod.findUnique({
        where: { weekStart: asDateColumn(monday) },
        include: { settlements: { orderBy: { paidAt: 'asc' } } },
      }),
      this.prisma.coach.findMany({ select: { id: true, profile: { select: { fullName: true } } }, orderBy: { id: 'asc' } }),
      this.cardHolder(),
    ]);
    const allocations = await this.allocationsOf(monday, period?.status === 'closed' ? period.id : null);
    const payments = period?.settlements ?? [];
    const result = settle(allocations.map((a) => toSettle(a, holder)), payments);

    // La coach ve lo suyo; el admin, todo
    const involves = (ids: number[]) => me === null || ids.includes(me);
    const byPayment = new Map<number, AllocationRow[]>();
    for (const a of allocations) byPayment.set(a.paymentId, [...(byPayment.get(a.paymentId) ?? []), a]);
    const disciplines = new Map(allocations.map((a) => [a.discipline.id, a.discipline.name]));

    return {
      weekStart: monday,
      weekEnd: sunday,
      isOver: sunday < studioDate(new Date()),
      status: period?.status ?? 'open',
      closedAt: period?.closedAt ?? null,
      cardHolderId: holder,
      coaches: coaches.map((c) => ({ id: c.id, name: c.profile.fullName })),
      income: result.income
        .filter((i) => involves([i.coachId]))
        .map((i) => ({ ...i, byDiscipline: i.byDiscipline.map((d) => ({ ...d, name: disciplines.get(d.disciplineId) })) })),
      debts: result.debts.filter((d) => involves([d.fromCoachId, d.toCoachId])),
      settlements: payments
        .filter((s) => involves([s.fromCoachId, s.toCoachId]))
        .map((s) => ({ id: s.id, fromCoachId: s.fromCoachId, toCoachId: s.toCoachId, amountCents: s.amountCents, method: s.method, paidAt: s.paidAt, notes: s.notes })),
      payments: [...byPayment.values()]
        .filter((rows) => involves([...rows.map((a) => a.coachId), rows[0].payment.receivedById ?? holder]))
        .map((rows) => {
          const p = rows[0].payment;
          return {
            id: p.id,
            method: p.method,
            date: p.method === 'card' && p.payout ? dateOnly(p.payout.arrivalDate) : studioDate(p.paidAt!),
            student: p.student.fullName,
            plan: p.membership?.plan.name ?? '—',
            grossCents: p.grossCents,
            feeCents: p.feeCents,
            netCents: p.netCents,
            receivedById: p.method === 'cash' ? p.receivedById : holder,
            shares: rows.map((a) => ({ coachId: a.coachId, discipline: a.discipline.name, amountCents: a.amountCents })),
          };
        })
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  /** Registrar que una coach le pagó a otra lo del corte. */
  async pay(user: AuthUser, start: string, dto: SettlementPaymentDto) {
    const monday = weekStart(start);
    if (dto.fromCoachId === dto.toCoachId) throw new BadRequestException('Elige a dos coaches distintas');
    if (!isAdmin(user)) {
      const me = coachIdOf(user);
      if (me !== dto.fromCoachId && me !== dto.toCoachId) throw new ForbiddenException('Solo puedes registrar pagos tuyos');
    }
    const found = await this.prisma.coach.count({ where: { id: { in: [dto.fromCoachId, dto.toCoachId] } } });
    if (found !== 2) throw new NotFoundException('La coach no existe');

    const period = await this.ensurePeriod(monday);
    const s = await this.prisma.settlement.create({
      data: {
        periodId: period.id,
        fromCoachId: dto.fromCoachId,
        toCoachId: dto.toCoachId,
        amountCents: dto.amountCents,
        method: dto.method,
        notes: dto.notes,
        paidAt: new Date(),
      },
    });
    return { id: s.id };
  }

  /** Borrar un pago registrado por error: el admin o alguna de las dos coaches. */
  async removePayment(user: AuthUser, id: number) {
    const s = await this.prisma.settlement.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Ese pago no existe');
    if (!isAdmin(user)) {
      const me = coachIdOf(user);
      if (me !== s.fromCoachId && me !== s.toCoachId) throw new ForbiddenException();
    }
    await this.prisma.settlement.delete({ where: { id } });
    return { id };
  }

  /** Cierra la semana: sus movimientos quedan congelados en ese corte. */
  async close(start: string) {
    const monday = weekStart(start);
    if (addDays(monday, 6) >= studioDate(new Date())) throw new BadRequestException('La semana todavía no termina');
    const period = await this.ensurePeriod(monday);
    if (period.status === 'closed') throw new BadRequestException('Ese corte ya está cerrado');

    const [allocations, holder, settlements] = await Promise.all([
      this.allocationsOf(monday, null),
      this.cardHolder(),
      this.prisma.settlement.findMany({ where: { periodId: period.id } }),
    ]);
    const summary = settle(allocations.map((a) => toSettle(a, holder)), settlements);
    await this.prisma.$transaction([
      this.prisma.paymentAllocation.updateMany({ where: { id: { in: allocations.map((a) => a.id) } }, data: { settlementPeriodId: period.id } }),
      this.prisma.settlementPeriod.update({
        where: { id: period.id },
        data: { status: 'closed', closedAt: new Date(), summary: JSON.parse(JSON.stringify(summary)) },
      }),
    ]);
    return { weekStart: monday, allocations: allocations.length };
  }

  /** Cada lunes a las 00:30 se cierra la semana que terminó. */
  @Cron('30 0 * * 1', { timeZone: STUDIO_TZ })
  async closeLastWeek() {
    const last = addDays(weekStart(studioDate(new Date())), -7);
    const period = await this.prisma.settlementPeriod.findUnique({ where: { weekStart: asDateColumn(last) } });
    if (period?.status === 'closed') return;
    const r = await this.close(last);
    this.logger.log(`Corte ${last} cerrado: ${r.allocations} movimientos`);
  }

  /** Movimientos de la semana: los congelados del corte, o los que caen en sus fechas. */
  private allocationsOf(monday: string, closedPeriodId: number | null) {
    if (closedPeriodId !== null) {
      return this.prisma.paymentAllocation.findMany({ where: { settlementPeriodId: closedPeriodId }, include: ALLOCATION_INCLUDE });
    }
    const from = studioDateTime(monday, '00:00');
    const to = studioDateTime(addDays(monday, 7), '00:00');
    return this.prisma.paymentAllocation.findMany({
      where: {
        settlementPeriodId: null,
        OR: [
          { payment: { method: 'cash', status: { in: ['succeeded', 'partially_refunded'] }, paidAt: { gte: from, lt: to } } },
          {
            payment: {
              method: 'card',
              payout: { status: 'paid', arrivalDate: { gte: asDateColumn(monday), lte: asDateColumn(addDays(monday, 6)) } },
            },
          },
        ],
      },
      include: ALLOCATION_INCLUDE,
    });
  }

  /** La cuenta de Stripe es de la head coach: ahí cae el dinero con tarjeta. */
  private async cardHolder() {
    const head = await this.prisma.coach.findFirst({ where: { profile: { role: 'admin' } }, orderBy: { id: 'asc' }, select: { id: true } });
    if (!head) throw new NotFoundException('No hay head coach registrada');
    return head.id;
  }

  private ensurePeriod(monday: string) {
    return this.prisma.settlementPeriod.upsert({
      where: { weekStart: asDateColumn(monday) },
      create: { weekStart: asDateColumn(monday), weekEnd: asDateColumn(addDays(monday, 6)) },
      update: {},
    });
  }
}

const toSettle = (a: AllocationRow, holder: number): SettleAllocation => ({
  coachId: a.coachId,
  disciplineId: a.disciplineId,
  amountCents: a.amountCents,
  method: a.payment.method,
  holderCoachId: a.payment.method === 'cash' ? (a.payment.receivedById ?? holder) : holder,
});
