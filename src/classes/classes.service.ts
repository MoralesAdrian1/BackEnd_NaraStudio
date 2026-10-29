import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { AuthUser } from '../auth/auth-user.js';
import { assertOwnsOrAdmin, coachIdOf, isAdmin } from '../auth/permissions.js';
import { asDateColumn, asTimeColumn, dateOnly, studioDate, timeOnly } from '../common/studio-time.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateClassDto, CreateScheduleDto, UpdateClassDto } from './classes.dto.js';
import { SessionsService } from './sessions.service.js';

const CLASS_INCLUDE = {
  discipline: { select: { id: true, name: true, slug: true } },
  coach: { select: { id: true, profile: { select: { fullName: true } } } },
  schedules: { orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] },
} satisfies Prisma.StudioClassInclude;

type ClassRow = Prisma.StudioClassGetPayload<{ include: typeof CLASS_INCLUDE }>;

@Injectable()
export class ClassesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
  ) {}

  /** Clases activas con sus horarios vigentes. mine = solo las de la coach que pregunta. */
  async list(user?: AuthUser, mine = false) {
    const today = asDateColumn(studioDate(new Date()));
    const rows = await this.prisma.studioClass.findMany({
      where: {
        isActive: mine ? undefined : true,
        coachId: mine && user && !isAdmin(user) ? coachIdOf(user) : undefined,
      },
      include: {
        ...CLASS_INCLUDE,
        schedules: {
          ...CLASS_INCLUDE.schedules,
          where: { OR: [{ validUntil: null }, { validUntil: { gte: today } }] },
        },
      },
      orderBy: [{ disciplineId: 'asc' }, { name: 'asc' }],
    });
    return rows.map(present);
  }

  async create(user: AuthUser, dto: CreateClassDto) {
    if (dto.coachId && !isAdmin(user)) throw new ForbiddenException('Solo el admin crea clases para otra coach');
    const coachId = dto.coachId ?? coachIdOf(user);

    const discipline = await this.prisma.discipline.findUnique({ where: { id: dto.disciplineId } });
    if (!discipline?.isActive) throw new NotFoundException('La disciplina no existe o está desactivada');

    // Cada coach crea clases solo de sus disciplinas
    const teaches = await this.prisma.coachDiscipline.findUnique({
      where: { coachId_disciplineId: { coachId, disciplineId: discipline.id } },
    });
    if (!teaches) throw new BadRequestException(`Esa coach no imparte ${discipline.name}`);

    const created = await this.prisma.studioClass.create({
      data: {
        name: dto.name,
        disciplineId: discipline.id,
        coachId,
        capacity: dto.capacity ?? discipline.defaultCapacity,
        durationMin: dto.durationMin ?? 60,
      },
      include: CLASS_INCLUDE,
    });
    return present(created);
  }

  async update(user: AuthUser, id: number, dto: UpdateClassDto) {
    const cls = await this.find(id);
    assertOwnsOrAdmin(user, cls.coachId);

    // Reasignar a otra coach (admin): debe impartir la disciplina; sus próximas sesiones también cambian
    if (dto.coachId !== undefined && dto.coachId !== cls.coachId) {
      if (!isAdmin(user)) throw new ForbiddenException('Solo el admin reasigna clases');
      const teaches = await this.prisma.coachDiscipline.findUnique({
        where: { coachId_disciplineId: { coachId: dto.coachId, disciplineId: cls.disciplineId } },
        include: { coach: true },
      });
      if (!teaches?.coach.isActive) throw new BadRequestException('Esa coach no imparte esta disciplina o está desactivada');
      await this.prisma.classSession.updateMany({
        where: { classId: id, status: 'scheduled', startsAt: { gt: new Date() }, coachId: cls.coachId },
        data: { coachId: dto.coachId },
      });
    }
    const updated = await this.prisma.studioClass.update({ where: { id }, data: dto, include: CLASS_INCLUDE });

    // Un cambio de cupo aplica a las sesiones que vienen
    if (dto.capacity !== undefined) {
      await this.prisma.classSession.updateMany({
        where: { classId: id, status: 'scheduled', startsAt: { gt: new Date() } },
        data: { capacity: dto.capacity },
      });
    }
    // Desactivar la clase cancela lo que viene
    if (dto.isActive === false) {
      await this.sessions.cancelMany(
        Prisma.sql`class_id = ${id} AND starts_at > now()`,
        'La clase se dio de baja',
      );
    }
    return present(updated);
  }

  /** Agrega un horario recurrente y genera sus sesiones de inmediato. */
  async addSchedule(user: AuthUser, classId: number, dto: CreateScheduleDto) {
    const cls = await this.find(classId);
    assertOwnsOrAdmin(user, cls.coachId);
    if (!cls.isActive) throw new BadRequestException('La clase está desactivada');

    const validFrom = dto.validFrom ?? studioDate(new Date());
    if (dto.validUntil && dto.validUntil < validFrom) {
      throw new BadRequestException('La fecha final debe ser posterior a la inicial');
    }

    const schedule = await this.prisma.classSchedule.create({
      data: {
        classId,
        weekday: dto.weekday,
        startTime: asTimeColumn(dto.startTime),
        validFrom: asDateColumn(validFrom),
        validUntil: dto.validUntil ? asDateColumn(dto.validUntil) : null,
      },
    });
    const generated = await this.sessions.generate();
    return { schedule: presentSchedule(schedule), generated };
  }

  /** Termina un horario recurrente: deja de repetirse y se cancelan sus sesiones futuras. */
  async endSchedule(user: AuthUser, classId: number, scheduleId: number) {
    const cls = await this.find(classId);
    assertOwnsOrAdmin(user, cls.coachId);
    const schedule = await this.prisma.classSchedule.findFirst({ where: { id: scheduleId, classId } });
    if (!schedule) throw new NotFoundException('Ese horario no existe en esta clase');

    await this.prisma.classSchedule.update({
      where: { id: scheduleId },
      data: { validUntil: asDateColumn(studioDate(new Date())) },
    });
    const [cancelledSessions, refundedBookings] = await this.sessions.cancelMany(
      Prisma.sql`schedule_id = ${scheduleId} AND starts_at > now()`,
      'El horario se dio de baja',
    );
    return { cancelledSessions, refundedBookings };
  }

  private async find(id: number) {
    const cls = await this.prisma.studioClass.findUnique({ where: { id } });
    if (!cls) throw new NotFoundException('La clase no existe');
    return cls;
  }
}

const presentSchedule = (s: ClassRow['schedules'][number]) => ({
  id: s.id,
  weekday: s.weekday,
  startTime: timeOnly(s.startTime),
  validFrom: dateOnly(s.validFrom),
  validUntil: s.validUntil ? dateOnly(s.validUntil) : null,
});

const present = (c: ClassRow) => ({
  id: c.id,
  name: c.name,
  capacity: c.capacity,
  durationMin: c.durationMin,
  isActive: c.isActive,
  discipline: c.discipline,
  coach: { id: c.coach.id, name: c.coach.profile.fullName },
  schedules: c.schedules.map(presentSchedule),
});
