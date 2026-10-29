import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { AuthUser } from '../auth/auth-user.js';
import { addDays, asDateColumn, STUDIO_TZ, studioDate, studioDateTime } from '../common/studio-time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { computeStreak, dayState, rankDense, type StreakPeriod } from './streak.js';

/** Días que se muestran en la tira de la racha */
const STRIP_DAYS = 14;
const LEADERBOARD_SIZE = 10;

const monthOf = (date: string) => `${date.slice(0, 7)}-01`;
const nextMonth = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
};

/** En la tabla: el nombre público, o el nombre y la inicial del apellido. */
export const publicNameOf = (s: { fullName: string; publicName: string | null }) => {
  if (s.publicName?.trim()) return s.publicName.trim();
  const [first, ...rest] = s.fullName.trim().split(/\s+/);
  return rest.length ? `${first} ${rest[0][0]}.` : first;
};

@Injectable()
export class ProgressService {
  private readonly logger = new Logger(ProgressService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Racha de la alumna, sus últimos días y su lugar del mes. */
  async mine(user: AuthUser) {
    const studentId = user.profile?.student?.id;
    if (!studentId) throw new ForbiddenException('Solo las alumnas tienen racha');
    const today = studioDate(new Date());
    const input = await this.streakInput(studentId, today);
    const streak = computeStreak(input);

    await this.prisma.studentStreak.upsert({
      where: { studentId },
      create: { studentId, currentStreak: streak.current, bestStreak: streak.best, lastAttendedOn: lastDate(streak.lastAttendedOn) },
      update: { currentStreak: streak.current, bestStreak: streak.best, lastAttendedOn: lastDate(streak.lastAttendedOn) },
    });

    const month = monthOf(today);
    const strip = Array.from({ length: STRIP_DAYS }, (_, i) => addDays(today, i - STRIP_DAYS + 1));
    return {
      // La racha se desbloquea con un plan de más de una clase vigente
      unlocked: input.periods.some((p) => p.from <= today && today <= p.to),
      current: streak.current,
      best: streak.best,
      lastAttendedOn: streak.lastAttendedOn,
      attendedToday: input.attended.has(today),
      monthDays: [...input.attended].filter((d) => d >= month).length,
      totalDays: input.attended.size,
      days: strip.map((date) => ({ date, state: dayState(date, input) })),
    };
  }

  /** Lo que necesita la racha: días con asistencia, periodos de membresía y días con clase. */
  private async streakInput(studentId: number, today: string) {
    const [attendedRows, memberships] = await Promise.all([
      this.prisma.booking.findMany({
        where: { studentId, status: 'attended' },
        select: { session: { select: { startsAt: true } } },
      }),
      this.prisma.membership.findMany({
        where: {
          studentId,
          status: { in: ['active', 'expired'] },
          classSessionId: null,
          startsAt: { not: null },
          OR: [{ creditsTotal: null }, { creditsTotal: { gt: 1 } }],
        },
        select: { startsAt: true, expiresAt: true, trainingDays: true, plan: { select: { revenueShares: { select: { disciplineId: true } } } } },
      }),
    ]);
    const attended = new Set(attendedRows.map((b) => studioDate(b.session.startsAt)));
    const periods: StreakPeriod[] = memberships.map((m) => ({
      from: studioDate(m.startsAt!),
      to: m.expiresAt ? studioDate(new Date(m.expiresAt.getTime() - 1)) : today,
      trainingDays: m.trainingDays,
      disciplineIds: m.plan.revenueShares.map((s) => s.disciplineId),
    }));

    // Días con clase desde la primera asistencia (o desde el inicio de la tira, si es antes)
    const stripStart = addDays(today, -STRIP_DAYS + 1);
    const first = [...attended, stripStart].sort()[0];
    const held = await this.prisma.classSession.findMany({
      where: { status: { not: 'cancelled' }, startsAt: { gte: studioDateTime(first, '00:00'), lt: studioDateTime(addDays(today, 1), '00:00') } },
      select: { startsAt: true, class: { select: { disciplineId: true } } },
    });
    const sessionDays = new Map<string, Set<number>>();
    for (const s of held) {
      const d = studioDate(s.startsAt);
      sessionDays.set(d, (sessionDays.get(d) ?? new Set()).add(s.class.disciplineId));
    }
    return { attended, periods, sessionDays, today };
  }

  // ─── Reconocimientos del mes ────────────────────────────────────────────

  /** Tabla del mes: se recalcula cada noche; si aún no existe, al momento. */
  async leaderboard(user: AuthUser) {
    const month = monthOf(studioDate(new Date()));
    let rows = await this.entries(month);
    if (!rows.length) {
      await this.refresh(month);
      rows = await this.entries(month);
    }
    const myId = user.profile?.student?.id;
    const toView = (e: (typeof rows)[number]) => ({
      position: e.position,
      name: publicNameOf(e.student),
      days: e.daysAttended,
      isMe: e.studentId === myId,
    });
    const mine = rows.find((e) => e.studentId === myId);
    // Las primeras 10, más quienes empaten con la décima
    const cutoff = rows[LEADERBOARD_SIZE - 1]?.position ?? Infinity;
    return {
      month,
      updatedAt: rows[0]?.updatedAt ?? null,
      entries: rows.filter((e) => e.position <= cutoff).map(toView),
      me: mine ? toView(mine) : null,
      participants: rows.length,
    };
  }

  private entries(month: string) {
    return this.prisma.leaderboardEntry.findMany({
      where: { month: asDateColumn(month) },
      include: { student: { select: { fullName: true, publicName: true } } },
      orderBy: [{ position: 'asc' }, { student: { fullName: 'asc' } }],
    });
  }

  /** Días distintos con asistencia en el mes, por alumna con cuenta en la app. */
  async refresh(month: string) {
    const from = studioDateTime(month, '00:00');
    const to = studioDateTime(nextMonth(month), '00:00');
    const counts = await this.prisma.$queryRaw<{ studentId: number; days: number }[]>`
      SELECT b.student_id AS "studentId", COUNT(DISTINCT (s.starts_at AT TIME ZONE ${STUDIO_TZ})::date)::int AS days
      FROM bookings b
      JOIN class_sessions s ON s.id = b.session_id
      JOIN students st ON st.id = b.student_id
      WHERE b.status = 'attended' AND s.starts_at >= ${from} AND s.starts_at < ${to}
        AND st.profile_id IS NOT NULL AND st.is_active
      GROUP BY b.student_id`;
    const ranked = rankDense(counts);
    const monthCol = asDateColumn(month);
    try {
      await this.prisma.$transaction([
        this.prisma.leaderboardEntry.deleteMany({ where: { month: monthCol } }),
        this.prisma.leaderboardEntry.createMany({
          data: ranked.map((r) => ({ month: monthCol, studentId: r.studentId, daysAttended: r.days, position: r.position })),
        }),
      ]);
    } catch (e) {
      // Dos recálculos a la vez: el otro ya escribió la tabla
      if ((e as { code?: string }).code !== 'P2002') throw e;
    }
    return ranked.length;
  }

  /** Cada noche a las 00:20: tabla del mes que terminó ayer (y la del mes nuevo el día 1). */
  @Cron('20 0 * * *', { timeZone: STUDIO_TZ })
  async nightly() {
    const today = studioDate(new Date());
    const months = new Set([monthOf(addDays(today, -1)), monthOf(today)]);
    for (const m of months) {
      const n = await this.refresh(m);
      this.logger.log(`Reconocimientos ${m}: ${n} alumnas`);
    }
  }
}

const lastDate = (d: string | null) => (d ? asDateColumn(d) : null);
