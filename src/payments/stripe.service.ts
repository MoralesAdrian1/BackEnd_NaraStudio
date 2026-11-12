import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/** Lo que se guarda del cobro con tarjeta: monto, comisión de Stripe y lo que queda. */
export interface CardPayment {
  grossCents: number;
  feeCents: number;
  netCents: number;
  paymentIntentId: string;
  chargeId: string | null;
}

/** Minutos que la alumna tiene para pagar en la página de Stripe (Stripe pide 30 como mínimo). */
export const CHECKOUT_MINUTES = 30;

/**
 * Cliente de Stripe. Sin STRIPE_SECRET_KEY el pago con tarjeta queda apagado y la app solo
 * ofrece efectivo.
 */
@Injectable()
export class StripeService {
  private readonly client: Stripe | null;
  readonly webhookSecret: string;
  readonly appUrl: string;

  constructor(config: ConfigService) {
    const key = config.get<string>('STRIPE_SECRET_KEY');
    this.client = key ? new Stripe(key) : null;
    this.webhookSecret = config.get<string>('STRIPE_WEBHOOK_SECRET') ?? '';
    this.appUrl = config.get<string>('APP_URL') ?? 'http://localhost:5173';
  }

  get enabled() {
    return this.client !== null;
  }

  get stripe(): Stripe {
    if (!this.client) throw new ServiceUnavailableException('El pago con tarjeta no está disponible por ahora');
    return this.client;
  }

  /** Página de pago de Stripe para una membresía. Devuelve la sesión (su url y cuándo vence). */
  checkout(args: {
    membershipId: number;
    planName: string;
    description?: string;
    amountCents: number;
    currency: string;
    customerId: string;
  }) {
    const meta = { membershipId: String(args.membershipId) };
    return this.stripe.checkout.sessions.create({
      mode: 'payment',
      allowed_payment_method_types: ['card'], // solo tarjeta: OXXO tarda días y el lugar se libera en 30 min
      customer: args.customerId,
      client_reference_id: meta.membershipId,
      metadata: meta,
      payment_intent_data: { metadata: meta, description: args.planName },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: args.currency.toLowerCase(),
            unit_amount: args.amountCents,
            product_data: { name: args.planName, ...(args.description && { description: args.description }) },
          },
        },
      ],
      locale: 'es-419',
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60,
      success_url: `${this.appUrl}/cuenta?pago=ok#membresias`,
      cancel_url: `${this.appUrl}/cuenta?pago=cancelado#membresias`,
    });
  }

  /** Cierra la página de pago (la alumna retiró su solicitud). Si ya venció o se pagó, no pasa nada. */
  async expireCheckout(id: string) {
    if (!this.client) return;
    await this.client.checkout.sessions.expire(id).catch(() => undefined);
  }

  /** Monto, comisión y neto del cobro de la sesión de pago. */
  async cardPayment(session: Stripe.Checkout.Session): Promise<CardPayment> {
    const piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent!.id;
    const pi = await this.stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge.balance_transaction'] });
    const charge = pi.latest_charge && typeof pi.latest_charge !== 'string' ? pi.latest_charge : null;
    const bt = charge?.balance_transaction && typeof charge.balance_transaction !== 'string' ? charge.balance_transaction : null;
    const gross = pi.amount_received;
    // Si Stripe todavía no calcula la comisión, se toma completo y se corrige al llegar el depósito
    return { grossCents: gross, feeCents: bt?.fee ?? 0, netCents: bt?.net ?? gross, paymentIntentId: pi.id, chargeId: charge?.id ?? null };
  }
}
