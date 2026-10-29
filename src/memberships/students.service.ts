import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { AuthUser } from '../auth/auth-user.js';
import { coachIdOf, isAdmin } from '../auth/permissions.js';
import { SupabaseAdmin } from '../auth/supabase-admin.js';
import { MailService } from '../mail/mail.service.js';
import { invitation } from '../mail/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateStudentDto } from './memberships.dto.js';

@Injectable()
export class StudentsService {
  private readonly logger = new Logger(StudentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: SupabaseAdmin,
    private readonly mail: MailService,
  ) {}

  /**
   * Alumnas que la coach administra: las que registró y las que compraron un plan solo suyo.
   * Las del plan combinado las administra el admin, que ve a todas.
   */
  private visibleTo(user: AuthUser): Prisma.StudentWhereInput {
    if (isAdmin(user)) return {};
    const coachId = coachIdOf(user);
    return {
      OR: [
        { registeredById: coachId },
        { memberships: { some: { plan: { revenueShares: { every: { coachId }, some: { coachId } } } } } },
      ],
    };
  }

  async list(user: AuthUser, q?: string) {
    const search: Prisma.StudentWhereInput = q
      ? {
          OR: [
            { fullName: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
            { email: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {};
    const rows = await this.prisma.student.findMany({
      where: { AND: [this.visibleTo(user), search, { isActive: true }] },
      include: {
        memberships: {
          where: { status: 'active', expiresAt: { gt: new Date() } },
          include: { plan: { select: { name: true } } },
        },
      },
      orderBy: { fullName: 'asc' },
      take: 200,
    });
    return rows.map((s) => ({
      id: s.id,
      fullName: s.fullName,
      phone: s.phone,
      email: s.email,
      photoPath: s.photoPath,
      usesApp: s.profileId !== null,
      activePlans: s.memberships.map((m) => m.plan.name),
    }));
  }

  async detail(user: AuthUser, id: number) {
    const s = await this.prisma.student.findFirst({
      where: { AND: [{ id }, this.visibleTo(user)] },
      include: { health: true },
    });
    if (!s) throw new NotFoundException('La alumna no existe o no es de tus disciplinas');
    return {
      id: s.id,
      fullName: s.fullName,
      phone: s.phone,
      email: s.email,
      address: s.address,
      birthDate: s.birthDate,
      photoPath: s.photoPath,
      usesApp: s.profileId !== null,
      hasSignedIn: await this.hasSignedIn(s.profileId),
      health: s.health,
    };
  }

  /**
   * Registra a la alumna con su cuenta y le manda la invitación para crear su contraseña.
   * Aunque no use la app, la cuenta queda activa y la coach la agrega a la lista de sus clases.
   */
  async create(user: AuthUser, dto: CreateStudentDto) {
    const coachId = coachIdOf(user);
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.profile.findUnique({ where: { email } })) {
      throw new ConflictException('Ya hay una cuenta con ese correo. Búscala en tu lista o pídele que compre su plan desde la app.');
    }
    const account = await this.admin.createUser(email, dto.fullName);
    const birthDate = dto.birthDate ? new Date(dto.birthDate) : undefined;
    let student;
    try {
      const profile = await this.prisma.profile.create({
        data: {
          id: account.id,
          role: 'student',
          fullName: dto.fullName,
          email,
          phone: dto.phone,
          birthDate,
          student: {
            create: { fullName: dto.fullName, email, phone: dto.phone, address: dto.address, birthDate, registeredById: coachId },
          },
        },
        include: { student: true },
      });
      student = profile.student!;
    } catch (e) {
      await this.admin.deleteUser(account.id);
      throw e;
    }
    return { ...student, invitationSent: await this.sendInvitation(email, dto.fullName) };
  }

  /**
   * Manda (o vuelve a mandar) la invitación. A las alumnas registradas antes, sin cuenta,
   * se les crea en este momento.
   */
  async invite(user: AuthUser, id: number) {
    await this.assertVisible(user, id);
    const s = await this.prisma.student.findUniqueOrThrow({ where: { id }, include: { profile: true } });
    if (s.profile) return { invitationSent: await this.sendInvitation(s.profile.email, s.fullName) };
    const email = s.email?.trim().toLowerCase();
    if (!email) throw new BadRequestException('Esta alumna no tiene correo; agrégalo para invitarla');
    if (await this.prisma.profile.findUnique({ where: { email } })) {
      throw new ConflictException('Ese correo ya tiene otra cuenta en la app');
    }
    const account = await this.admin.createUser(email, s.fullName);
    try {
      await this.prisma.$transaction([
        this.prisma.profile.create({
          data: { id: account.id, role: 'student', fullName: s.fullName, email, phone: s.phone, birthDate: s.birthDate },
        }),
        this.prisma.student.update({ where: { id }, data: { profileId: account.id, email } }),
      ]);
    } catch (e) {
      await this.admin.deleteUser(account.id);
      throw e;
    }
    return { invitationSent: await this.sendInvitation(email, s.fullName) };
  }

  /** La cuenta ya existe: si el correo falla, la alumna puede usar “¿Olvidaste tu contraseña?”. */
  private async sendInvitation(email: string, fullName: string) {
    try {
      const link = await this.admin.passwordLink(email);
      await this.mail.send({ to: email, ...invitation(fullName.split(' ')[0], link) });
      return true;
    } catch (e) {
      this.logger.error(`No se pudo generar la invitación de ${email}`, e);
      return false;
    }
  }

  /** ¿Ya entró alguna vez a la app? (lee auth.users de Supabase) */
  private async hasSignedIn(profileId: string | null) {
    if (!profileId) return false;
    try {
      const [row] = await this.prisma.$queryRaw<{ last_sign_in_at: Date | null }[]>`
        SELECT last_sign_in_at FROM auth.users WHERE id = ${profileId}::uuid`;
      return !!row?.last_sign_in_at;
    } catch {
      return null; // sin acceso al esquema auth: no se sabe
    }
  }

  /** Para ver el detalle de una alumna hay que poder administrarla. */
  async assertVisible(user: AuthUser, id: number) {
    const found = await this.prisma.student.count({ where: { AND: [{ id }, this.visibleTo(user)] } });
    if (!found) throw new NotFoundException('La alumna no existe o no es de tus disciplinas');
  }
}
