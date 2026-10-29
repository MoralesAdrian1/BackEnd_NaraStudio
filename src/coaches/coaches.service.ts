import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { AuthUser } from '../auth/auth-user.js';
import { coachIdOf } from '../auth/permissions.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateCertificationDto, PromoteCoachDto, UpdateCoachDto, UpdateMyCoachDto } from './coaches.dto.js';

const COACH_INCLUDE = {
  profile: { select: { fullName: true, email: true, phone: true, role: true } },
  disciplines: { include: { discipline: { select: { id: true, name: true, slug: true, isActive: true } } } },
  certifications: { orderBy: { createdAt: 'asc' } },
  _count: { select: { classes: { where: { isActive: true } } } },
} satisfies Prisma.CoachInclude;

type CoachRow = Prisma.CoachGetPayload<{ include: typeof COACH_INCLUDE }>;

@Injectable()
export class CoachesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Perfil público de las coaches activas (landing). */
  async listPublic() {
    const rows = await this.prisma.coach.findMany({ where: { isActive: true }, include: COACH_INCLUDE, orderBy: { id: 'asc' } });
    return rows.map((c) => {
      const { email: _email, phone: _phone, activeClasses: _classes, ...rest } = present(c);
      return rest;
    });
  }

  /** Todas, con contacto (admin). */
  async listAll() {
    const rows = await this.prisma.coach.findMany({ include: COACH_INCLUDE, orderBy: [{ isActive: 'desc' }, { id: 'asc' }] });
    return rows.map(present);
  }

  /**
   * Da de alta como coach a una cuenta registrada. La coach primero entra a la app con su
   * correo (Google o correo y contraseña); luego el admin la da de alta aquí.
   */
  async promote(dto: PromoteCoachDto) {
    const [account] = await this.prisma.$queryRaw<{ id: string; email: string; meta: { full_name?: string; name?: string } | null }[]>`
      SELECT id, email, raw_user_meta_data AS meta FROM auth.users WHERE lower(email) = lower(${dto.email})`;
    if (!account) {
      throw new NotFoundException('No hay una cuenta con ese correo. Pídele que primero se registre en la app con él.');
    }
    await this.assertDisciplines(dto.disciplineIds);
    const fullName = account.meta?.full_name ?? account.meta?.name ?? account.email.split('@')[0];

    const coach = await this.prisma.$transaction(async (tx) => {
      const profile = await tx.profile.upsert({
        where: { id: account.id },
        create: { id: account.id, role: 'coach', fullName, email: account.email },
        update: {},
      });
      // El admin conserva su rol; cualquier otra cuenta pasa a coach
      if (profile.role === 'student') await tx.profile.update({ where: { id: profile.id }, data: { role: 'coach' } });

      const coach = await tx.coach.upsert({
        where: { profileId: profile.id },
        create: { profileId: profile.id },
        update: { isActive: true },
      });
      await tx.coachDiscipline.createMany({
        data: dto.disciplineIds.map((disciplineId) => ({ coachId: coach.id, disciplineId })),
        skipDuplicates: true,
      });
      // Si entró como alumna y no tiene historial, se quita ese registro
      await tx.student.deleteMany({
        where: { profileId: profile.id, memberships: { none: {} }, bookings: { none: {} }, payments: { none: {} } },
      });
      return coach;
    });
    return present(await this.find(coach.id));
  }

  /** Disciplinas y alta/baja de una coach (admin). */
  async update(user: AuthUser, id: number, dto: UpdateCoachDto) {
    const coach = await this.find(id);

    if (dto.disciplineIds) {
      await this.assertDisciplines(dto.disciplineIds);
      const removed = coach.disciplines.map((d) => d.disciplineId).filter((d) => !dto.disciplineIds!.includes(d));
      const busy = await this.prisma.studioClass.count({ where: { coachId: id, isActive: true, disciplineId: { in: removed } } });
      if (busy) throw new BadRequestException('Tiene clases activas de una disciplina que quieres quitarle. Reasígnalas o desactívalas primero.');
      await this.prisma.$transaction([
        this.prisma.coachDiscipline.deleteMany({ where: { coachId: id, disciplineId: { in: removed } } }),
        this.prisma.coachDiscipline.createMany({
          data: dto.disciplineIds.map((disciplineId) => ({ coachId: id, disciplineId })),
          skipDuplicates: true,
        }),
      ]);
    }

    if (dto.isActive === false && coach.isActive) {
      if (coach.profileId === user.id) throw new BadRequestException('No puedes desactivarte a ti misma');
      if (coach.profile.role === 'admin') throw new BadRequestException('La head coach no se puede desactivar');
      if (coach._count.classes) throw new BadRequestException('Tiene clases activas. Reasígnalas a otra coach o desactívalas primero.');
      const plans = await this.prisma.plan.count({ where: { isActive: true, revenueShares: { some: { coachId: id } } } });
      if (plans) throw new BadRequestException('Recibe dinero de planes que se siguen vendiendo. Deja de venderlos primero.');
    }
    if (dto.isActive !== undefined) await this.prisma.coach.update({ where: { id }, data: { isActive: dto.isActive } });

    return present(await this.find(id));
  }

  // ─── La propia coach ───

  async mine(user: AuthUser) {
    return present(await this.find(coachIdOf(user)));
  }

  async updateMine(user: AuthUser, dto: UpdateMyCoachDto) {
    if (dto.photoPath) this.assertOwnFile(user, dto.photoPath);
    const id = coachIdOf(user);
    await this.prisma.coach.update({ where: { id }, data: dto });
    return present(await this.find(id));
  }

  async addCertification(user: AuthUser, dto: CreateCertificationDto) {
    if (dto.filePath) this.assertOwnFile(user, dto.filePath);
    const id = coachIdOf(user);
    await this.prisma.coachCertification.create({
      data: {
        coachId: id,
        name: dto.name,
        issuer: dto.issuer,
        issuedAt: dto.issuedAt ? new Date(dto.issuedAt) : undefined,
        filePath: dto.filePath,
      },
    });
    return present(await this.find(id));
  }

  async removeCertification(user: AuthUser, certificationId: number) {
    const id = coachIdOf(user);
    const { count } = await this.prisma.coachCertification.deleteMany({ where: { id: certificationId, coachId: id } });
    if (!count) throw new NotFoundException('Esa certificación no existe');
    return present(await this.find(id));
  }

  /** Los archivos se suben al bucket "coaches" dentro de la carpeta de cada una. */
  private assertOwnFile(user: AuthUser, path: string) {
    if (!path.startsWith(`${user.id}/`) || path.includes('..')) {
      throw new ForbiddenException('El archivo debe estar en tu carpeta');
    }
  }

  private async assertDisciplines(ids: number[]) {
    const found = await this.prisma.discipline.count({ where: { id: { in: ids }, isActive: true } });
    if (found !== ids.length) throw new BadRequestException('Alguna disciplina no existe o está desactivada');
  }

  private async find(id: number) {
    const c = await this.prisma.coach.findUnique({ where: { id }, include: COACH_INCLUDE });
    if (!c) throw new NotFoundException('La coach no existe');
    return c;
  }
}

function present(c: CoachRow) {
  return {
    id: c.id,
    name: c.profile.fullName,
    email: c.profile.email,
    phone: c.profile.phone,
    isHeadCoach: c.profile.role === 'admin',
    isActive: c.isActive,
    bio: c.bio,
    instagram: c.instagram,
    tiktok: c.tiktok,
    photoPath: c.photoPath,
    disciplines: c.disciplines.map((d) => d.discipline),
    certifications: c.certifications.map((x) => ({
      id: x.id,
      name: x.name,
      issuer: x.issuer,
      issuedAt: x.issuedAt,
      filePath: x.filePath,
    })),
    activeClasses: c._count.classes,
  };
}
