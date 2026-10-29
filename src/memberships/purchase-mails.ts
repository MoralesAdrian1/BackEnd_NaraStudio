import { Injectable, Logger } from '@nestjs/common';
import { MailService } from '../mail/mail.service.js';
import { cashRequested, cashRequestForCoach, paymentForCoach, receipt, type PurchaseInfo } from '../mail/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';

const METHOD = { cash: 'Efectivo', card: 'Tarjeta' } as const;

/**
 * Correos de las compras: a la alumna (confirmación y recibo) y a las coaches del plan.
 * Se mandan después de guardar y sin esperar: si fallan, solo quedan en el log.
 */
@Injectable()
export class PurchaseMails {
  private readonly logger = new Logger(PurchaseMails.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /** La alumna pidió pagar en efectivo el día de su clase. */
  requested(membershipId: number) {
    this.later(async () => {
      const x = await this.load(membershipId);
      await Promise.all([
        this.mail.send({ to: x.studentEmail, ...cashRequested(x.info) }),
        this.mail.send({ to: x.coachEmails, ...cashRequestForCoach(x.coachInfo) }),
      ]);
    });
  }

  /** Entró el pago: recibo a la alumna y aviso a las coaches del plan (menos a quien cobró). */
  paid(membershipId: number, receivedById: number) {
    this.later(async () => {
      const x = await this.load(membershipId, receivedById);
      const payment = await this.prisma.payment.findFirst({
        where: { membershipId, status: 'succeeded' },
        orderBy: { paidAt: 'desc' },
        include: { receivedBy: { select: { profile: { select: { fullName: true } } } } },
      });
      if (!payment) return;
      const paid = {
        paidAt: payment.paidAt ?? new Date(),
        method: METHOD[payment.method],
        receivedBy: payment.receivedBy?.profile.fullName ?? 'Nara Studio',
      };
      await Promise.all([
        this.mail.send({ to: x.studentEmail, ...receipt({ ...x.info, ...paid }) }),
        this.mail.send({ to: x.coachEmails, ...paymentForCoach({ ...x.coachInfo, ...paid }) }),
      ]);
    });
  }

  private async load(membershipId: number, exceptCoachId?: number) {
    const m = await this.prisma.membership.findUniqueOrThrow({
      where: { id: membershipId },
      include: {
        student: { select: { fullName: true, email: true, profile: { select: { email: true } } } },
        plan: { select: { name: true, revenueShares: { select: { coach: { select: { id: true, profile: { select: { email: true } } } } } } } },
        classSession: { select: { startsAt: true, class: { select: { name: true } } } },
        bookings: {
          where: { status: { in: ['booked', 'attended'] } },
          select: { session: { select: { startsAt: true, class: { select: { name: true } } } } },
          take: 1,
        },
      },
    });
    const session = m.classSession ?? m.bookings[0]?.session;
    const info: PurchaseInfo = {
      studentName: m.student.fullName.split(' ')[0],
      planName: m.plan.name,
      priceCents: m.pricePaidCents,
      className: session?.class.name,
      classAt: session?.startsAt,
    };
    const coachEmails = [
      ...new Set(m.plan.revenueShares.filter((s) => s.coach.id !== exceptCoachId).map((s) => s.coach.profile.email)),
    ];
    // Los correos a las coaches llevan el nombre completo de la alumna
    return {
      info,
      studentEmail: m.student.profile?.email ?? m.student.email ?? '',
      coachEmails,
      coachInfo: { ...info, studentName: m.student.fullName },
    };
  }

  private later(fn: () => Promise<void>) {
    fn().catch((e: unknown) => this.logger.error('No se pudo mandar un correo de compra', e));
  }
}
