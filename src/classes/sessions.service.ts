import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '../generated/prisma/client.js';
import { bookableUntil, type BookingOpens } from '../bookings/rules.js';
import type { AuthUser } from '../auth/auth-user.js';
import { assertOwnsOrAdmin, isAdmin } from '../auth/permissions.js';
import {
  addDays,
  asDateColumn,
  dateOnly,
  STUDIO_TZ,
  studioDate,
  studioDateTime,
  timeOnly,
  weekStart,
} from '../common/studio-time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { CreateSessionDto } from './classes.dto.js';
import { occurrences } from './occurrences.js';

/** Las reservas que ocupan lugar (y gastan crédito). */
const OCCUPYING = ['booked', 'attended'] as const;
const CLOSURE_PREFIX = 'Estudio cerrado';

const SESSION_INCLUDE = {
  class: { select: { id: true, name: true, discipline: { select: { id: true, name: true, slug: true } } } },
  coach: { select: { id: true, profile: { select: { fullName: true } } } },
  _count: { select: { bookings: { where: { status: { in: [...OCCUPYING] } } } } },
} satisfies Prisma.ClassSessionInclude;

type SessionRow = Prisma.ClassSessionGetPayload<{ include: typeof SESSION_INCLUDE }>;

@Injectable()
export class SessionsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  onApplicationBootstrap() {
    // En los tests no se escribe en la base al arrancar
    if (process.env.NODE_ENV === 'test') return;
    this.generate().catch((e: unknown) => this.logger.error('No se pudieron generar las sesiones', e));
  }

  /** Cada día a las 00:05 (hora del estudio) se generan las sesiones que falten. */
  @Cron('5 0 * * *', { timeZone: STUDIO_TZ })
  async daily() {
    await this.prisma.classSession.updateMany({
      where: { status: 'scheduled', endsAt: { lt: new Date() } },
      data: { status: 'completed' },
    });
    await this.generate();
  }

  /**
   * Crea las sesiones de la semana en curso y las siguientes (sessions_weeks_ahead).
   * Se puede llamar las veces que sea: las que ya existen no se duplican.
   */
  async generate(now = new Date()) {
    const weeks = await this.settings.get('sessions_weeks_ahead', 2);
    const from = studioDate(now);
    const to = addDays(weekStart(from), weeks * 7 - 1);

    const [schedules, closures] = await Promise.all([
      this.prisma.classSchedule.findMany({
        where: {
          class: { isActive: true },
          validFrom: { lte: asDateColumn(to) },
          OR: [{ validUntil: null }, { validUntil: { gte: asDateColumn(from) } }],
        },
        include: { class: true },
      }),
      this.prisma.studioClosure.findMany({
        where: { date: { gte: asDateColumn(from), lte: asDateColumn(to) } },
      }),
    ]);

    const rules = schedules.map((s) => ({
      scheduleId: s.id,
      classId: s.classId,
      coachId: s.class.coachId,
      capacity: s.class.capacity,
      durationMin: s.class.durationMin,
      weekday: s.weekday,
      startTime: timeOnly(s.startTime),
      validFrom: dateOnly(s.validFrom),
      validUntil: s.validUntil ? dateOnly(s.validUntil) : null,
    }));
    const closed = new Set(closures.map((c) => dateOnly(c.date)));
    const data = occurrences(rules, from, to, closed, now);

    const { count } = await this.prisma.classSession.createMany({ data, skipDuplicates: true });
    if (count) this.logger.log(`${count} sesiones nuevas hasta el ${to}`);
    return { from, to, created: count };
  }

  /** Horario público. Por defecto: semana en curso y la siguiente. */
  async list(from?: string, to?: string) {
    const today = studioDate(new Date());
    const start = from ?? weekStart(today);
    const end = to ?? addDays(weekStart(today), 13);
    if (end < start) throw new BadRequestException('"to" debe ser igual o posterior a "from"');
    if (addDays(start, 62) < end) throw new BadRequestException('El rango máximo es de dos meses');

    const rows = await this.prisma.classSession.findMany({
      where: {
        startsAt: { gte: studioDateTime(start, '00:00'), lt: studioDateTime(addDays(end, 1), '00:00') },
      },
      include: SESSION_INCLUDE,
      orderBy: { startsAt: 'asc' },
    });
    // Hasta qué día ya se puede reservar (la semana siguiente abre el sábado)
    const opens = await this.settings.get<BookingOpens>('booking_opens', { weekday: 6, time: '06:00' });
    const until = bookableUntil(new Date(), opens);
    return rows.map((r) => ({ ...present(r), bookable: studioDate(r.startsAt) <= until }));
  }

  /** Clase suelta en un horario que no es recurrente. */
  async createOneOff(user: AuthUser, dto: CreateSessionDto) {
    const cls = await this.prisma.studioClass.findUnique({ where: { id: dto.classId } });
    if (!cls || !cls.isActive) throw new NotFoundException('La clase no existe o está desactivada');
    assertOwnsOrAdmin(user, cls.coachId);
    if (dto.coachId && !isAdmin(user)) throw new BadRequestException('Solo el admin asigna suplentes');

    const startsAt = studioDateTime(dto.date, dto.startTime);
    if (startsAt <= new Date()) throw new BadRequestException('La clase debe ser en el futuro');
    if (await this.prisma.studioClosure.findUnique({ where: { date: asDateColumn(dto.date) } })) {
      throw new BadRequestException('Ese día el estudio está cerrado');
    }

    const clash = await this.prisma.classSession.findFirst({
      where: { classId: cls.id, startsAt, status: { not: 'cancelled' } },
    });
    if (clash) throw new ConflictException('Ya hay una sesión de esta clase a esa hora');

    const session = await this.prisma.classSession.create({
      data: {
        classId: cls.id,
        coachId: dto.coachId ?? cls.coachId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + cls.durationMin * 60_000),
        capacity: cls.capacity,
      },
      include: SESSION_INCLUDE,
    });
    return present(session);
  }

  /** Cancela una sesión y devuelve el crédito a quienes reservaron. */
  async cancel(user: AuthUser, id: number, reason: string) {
    const session = await this.prisma.classSession.findUnique({ where: { id }, include: { class: true } });
    if (!session) throw new NotFoundException('La sesión no existe');
    assertOwnsOrAdmin(user, session.class.coachId);
    if (session.status !== 'scheduled') throw new BadRequestException('La sesión ya no está programada');

    const [, bookings] = await this.cancelMany(Prisma.sql`id = ${id}`, reason);
    const updated = await this.prisma.classSession.findUniqueOrThrow({ where: { id }, include: SESSION_INCLUDE });
    return { ...present(updated), refundedBookings: bookings };
  }

  /** Cancela sesiones futuras y libera sus reservas, en una sola transacción. */
  async cancelMany(where: Prisma.Sql, reason: string): Promise<[number, number]> {
    return this.prisma.$transaction(async (tx) => {
      const ids = await tx.$queryRaw<{ id: number }[]>`
        UPDATE class_sessions
        SET status = 'cancelled', cancel_reason = ${reason}, cancelled_at = now()
        WHERE status = 'scheduled' AND ${where}
        RETURNING id`;
      if (!ids.length) return [0, 0];
      const sessionIds = ids.map((r) => r.id);
      // Pagos en efectivo de esas clases: la clase individual se cancela; la ficha de una
      // membresía queda libre para reservar otra clase
      const days = await this.settings.get('cash_request_days', 3);
      await tx.membership.updateMany({
        where: { status: 'pending_payment', classSessionId: { in: sessionIds } },
        data: { status: 'cancelled' },
      });
      await tx.membership.updateMany({
        where: { status: 'pending_payment', classSessionId: null, bookings: { some: { sessionId: { in: sessionIds }, status: 'booked' } } },
        data: { requestExpiresAt: new Date(Date.now() + days * 86_400_000) },
      });
      const { count } = await tx.booking.updateMany({
        where: { sessionId: { in: sessionIds }, status: 'booked' },
        data: { status: 'cancelled_by_studio', cancelledAt: new Date() },
      });
      return [ids.length, count];
    });
  }

  /** Días cerrados: cancela las sesiones de ese día. */
  async createClosure(date: string, reason: string) {
    if (date < studioDate(new Date())) throw new BadRequestException('La fecha ya pasó');
    try {
      await this.prisma.studioClosure.create({ data: { date: asDateColumn(date), reason } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ese día ya está marcado como cerrado');
      }
      throw e;
    }
    const [sessions, bookings] = await this.cancelMany(
      Prisma.sql`starts_at >= ${studioDateTime(date, '00:00')} AND starts_at < ${studioDateTime(addDays(date, 1), '00:00')}`,
      `${CLOSURE_PREFIX}: ${reason}`,
    );
    return { date, reason, cancelledSessions: sessions, refundedBookings: bookings };
  }

  /** Reabre un día: quita las sesiones canceladas por el cierre (sin reservas) y las vuelve a generar. */
  async deleteClosure(date: string) {
    const closure = await this.prisma.studioClosure.findUnique({ where: { date: asDateColumn(date) } });
    if (!closure) throw new NotFoundException('Ese día no está cerrado');
    await this.prisma.$transaction([
      this.prisma.classSession.deleteMany({
        where: {
          status: 'cancelled',
          cancelReason: { startsWith: CLOSURE_PREFIX },
          bookings: { none: {} },
          startsAt: { gte: studioDateTime(date, '00:00'), lt: studioDateTime(addDays(date, 1), '00:00') },
        },
      }),
      this.prisma.studioClosure.delete({ where: { id: closure.id } }),
    ]);
    return this.generate();
  }

  listClosures() {
    return this.prisma.studioClosure
      .findMany({ where: { date: { gte: asDateColumn(studioDate(new Date())) } }, orderBy: { date: 'asc' } })
      .then((rows) => rows.map((c) => ({ ...c, date: dateOnly(c.date) })));
  }
}

function present(s: SessionRow) {
  const booked = s._count.bookings;
  return {
    id: s.id,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    date: studioDate(s.startsAt),
    time: new Intl.DateTimeFormat('en-GB', { timeZone: STUDIO_TZ, hour: '2-digit', minute: '2-digit' }).format(s.startsAt),
    status: s.status,
    cancelReason: s.cancelReason,
    capacity: s.capacity,
    booked,
    spotsLeft: Math.max(0, s.capacity - booked),
    class: { id: s.class.id, name: s.class.name },
    discipline: s.class.discipline,
    coach: { id: s.coach.id, name: s.coach.profile.fullName },
    recurring: s.scheduleId !== null,
  };
}
