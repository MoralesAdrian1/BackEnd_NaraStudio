import { BadRequestException, Controller, Get, Headers, HttpCode, Logger, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { Public } from '../auth/decorators.js';
import { MembershipsService } from '../memberships/memberships.service.js';
import { splitAmount } from '../memberships/split.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StripeService } from './stripe.service.js';

const PAYOUT_STATUS = { paid: 'paid', in_transit: 'in_transit', pending: 'in_transit', failed: 'failed', canceled: 'canceled' } as const;

/**
 * Avisos de Stripe. Eventos que hay que activar en el webhook del dashboard:
 * checkout.session.completed, checkout.session.expired, payout.paid, payout.failed, payout.canceled.
 */
@Controller('stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(
    private readonly stripe: StripeService,
    private readonly memberships: MembershipsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Si la app ofrece pago con tarjeta. */
  @Public()
  @Get('status')
  status() {
    return { card: this.stripe.enabled };
  }

  // Stripe puede mandar muchos avisos juntos; la firma ya garantiza que vienen de Stripe
  @SkipThrottle()
  @Public()
  @Post('webhook')
  @HttpCode(200)
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature: string) {
    let event: Stripe.Event;
    try {
      event = this.stripe.stripe.webhooks.constructEvent(req.rawBody!, signature, this.stripe.webhookSecret);
    } catch {
      throw new BadRequestException('Firma de Stripe inválida');
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await this.paid(event.data.object);
        break;
      case 'checkout.session.expired': {
        const id = Number(event.data.object.metadata?.membershipId);
        if (id) await this.memberships.cancelCard(id, event.data.object.id);
        break;
      }
      case 'payout.paid':
      case 'payout.failed':
      case 'payout.canceled':
        await this.payout(event.data.object);
        break;
    }
    return { received: true };
  }

  /** Se pagó la sesión: se activa la membresía. Stripe puede mandar el aviso dos veces. */
  private async paid(session: Stripe.Checkout.Session) {
    const id = Number(session.metadata?.membershipId);
    if (!id || session.payment_status !== 'paid') return;
    const m = await this.prisma.membership.findUnique({ where: { id } });
    const waiting = (m?.status === 'awaiting_card' || m?.status === 'pending_payment') && m.stripeCheckoutId === session.id;
    if (!waiting) {
      // Stripe repite el aviso de un pago ya registrado: no pasa nada. Otro caso hay que revisarlo.
      const done = await this.prisma.payment.count({ where: { membershipId: id, method: 'card' } });
      if (!done) this.logger.error(`Pago con tarjeta de la membresía ${id} que está ${m?.status}: revisar y reembolsar en Stripe`);
      return;
    }
    await this.memberships.activateWithCard(id, session.id, await this.stripe.cardPayment(session));
  }

  /**
   * Depósito de Stripe a la cuenta bancaria: se guarda con su fecha y se le asignan sus cobros
   * (el corte semanal cuenta la tarjeta por la fecha de depósito). De paso se corrige la comisión
   * de los cobros que entraron sin ella.
   */
  private async payout(p: Stripe.Payout) {
    const status = PAYOUT_STATUS[p.status as keyof typeof PAYOUT_STATUS] ?? 'in_transit';
    const arrivalDate = new Date(p.arrival_date * 1000);
    const payout = await this.prisma.stripePayout.upsert({
      where: { stripePayoutId: p.id },
      create: { stripePayoutId: p.id, amountCents: p.amount, currency: p.currency.toUpperCase(), status, arrivalDate },
      update: { amountCents: p.amount, status, arrivalDate },
    });
    if (status !== 'paid') return;

    for await (const bt of this.stripe.stripe.balanceTransactions.list({ payout: p.id, type: 'charge', limit: 100 })) {
      const chargeId = typeof bt.source === 'string' ? bt.source : bt.source?.id;
      if (!chargeId) continue;
      const payment = await this.prisma.payment.findUnique({
        where: { stripeChargeId: chargeId },
        include: { allocations: true, membership: { include: { plan: { include: { revenueShares: { orderBy: { id: 'asc' } } } } } } },
      });
      if (!payment) continue;
      const feeChanged = payment.netCents !== bt.net && payment.allocations.every((a) => a.settlementPeriodId === null);
      await this.prisma.$transaction(async (tx) => {
        await tx.payment.update({
          where: { id: payment.id },
          data: { payoutId: payout.id, ...(feeChanged && { feeCents: bt.fee, netCents: bt.net }) },
        });
        if (feeChanged && payment.membership) {
          await tx.paymentAllocation.deleteMany({ where: { paymentId: payment.id } });
          await tx.paymentAllocation.createMany({
            data: splitAmount(bt.net, payment.membership.plan.revenueShares).map((a) => ({
              paymentId: payment.id,
              coachId: a.coachId,
              disciplineId: a.disciplineId,
              basisPoints: a.basisPoints,
              amountCents: a.amountCents,
            })),
          });
        }
      });
    }
  }
}
