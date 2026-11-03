import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { AuthUser } from '../auth/auth-user.js';
import { coachIdOf, isAdmin } from '../auth/permissions.js';
import { SupabaseAdmin } from '../auth/supabase-admin.js';
import { MailService } from '../mail/mail.service.js';
import { invitation } from '../mail/templates.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { studioDate, studioDateTime } from '../common/studio-time.js';
import type { CreateStudentDto, ImportStudentsDto } from './memberships.dto.js';

// Resend acepta 2 correos por segundo
const MAIL_GAP_MS = 600;
const DAY_MS = 86_400_000;

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

  /**
   * Carga masiva (Excel) de las alumnas que ya iban al estudio. Se saltan las que ya están por
   * correo o celular. Las invitaciones salen después, una por una, para no esperar a todas.
   */
  async importMany(user: AuthUser, dto: ImportStudentsDto) {
    const coachId = user.profile?.coach?.id ?? null;
    const now = new Date();
    const plans = new Map(
      (
        await this.prisma.plan.findMany({
          where: { id: { in: dto.rows.flatMap((r) => (r.planId ? [r.planId] : [])) }, isActive: true, kind: { not: 'single_class' } },
        })
      ).map((p) => [p.id, p]),
    );
    const today = studioDate(now);
    const rows = dto.rows.map((r, i) => ({
      row: r.line ?? i + 2, // fila del Excel: la 1 son los encabezados
      fullName: r.fullName.trim().replace(/\s+/g, ' '),
      email: r.email?.trim().toLowerCase() || undefined,
      phone: r.phone?.trim() || undefined,
      birthDate: r.birthDate ? new Date(r.birthDate) : undefined,
      plan: r.planId ? plans.get(r.planId) : undefined,
      planId: r.planId,
      startsAt: studioDateTime(r.startDate ?? today, '00:00'),
      credits: r.credits,
    }));
    const emails = rows.flatMap((r) => (r.email ? [r.email] : []));
    const phones = rows.flatMap((r) => (r.phone ? [r.phone] : []));
    const [students, profiles] = await Promise.all([
      this.prisma.student.findMany({
        where: { OR: [{ email: { in: emails, mode: 'insensitive' } }, { phone: { in: phones } }] },
        select: { email: true, phone: true },
      }),
      this.prisma.profile.findMany({ where: { email: { in: emails } }, select: { email: true } }),
    ]);
    const takenEmails = new Set([...students.map((s) => s.email?.toLowerCase()), ...profiles.map((p) => p.email)]);
    const takenPhones = new Set(students.map((s) => s.phone));

    type Note = { row: number; fullName: string; reason: string };
    const skipped: Note[] = [];
    const warnings: Note[] = [];
    const fresh = rows.filter((r) => {
      const reason =
        r.email && takenEmails.has(r.email)
          ? 'Ya hay una alumna con ese correo'
          : r.phone && takenPhones.has(r.phone)
            ? 'Ya hay una alumna con ese celular'
            : null;
      if (reason) skipped.push({ row: r.row, fullName: r.fullName, reason });
      if (r.email) takenEmails.add(r.email);
      if (r.phone) takenPhones.add(r.phone);
      return !reason;
    });

    const created = await this.prisma.$transaction(
      fresh.map((r) => {
        const { plan } = r;
        const expiresAt = plan && new Date(r.startsAt.getTime() + plan.durationDays * DAY_MS);
        if (r.planId && !plan) warnings.push({ row: r.row, fullName: r.fullName, reason: 'Se registró sin membresía: el plan ya no está activo' });
        else if (expiresAt && expiresAt <= now) {
          warnings.push({ row: r.row, fullName: r.fullName, reason: 'Se registró sin membresía: ya había vencido' });
        }
        const active = plan && expiresAt && expiresAt > now;
        return this.prisma.student.create({
          data: {
            fullName: r.fullName,
            email: r.email,
            phone: r.phone,
            birthDate: r.birthDate,
            registeredById: coachId,
            // Membresía que ya pagó en el estudio: entra activa y sin cobro en la app
            memberships: active
              ? {
                  create: {
                    planId: plan.id,
                    status: 'active',
                    creditsTotal: plan.credits === null ? null : (r.credits ?? plan.credits),
                    pricePaidCents: 0,
                    currency: plan.currency,
                    trainingDays: plan.trainingDays,
                    startsAt: r.startsAt,
                    expiresAt,
                    approvedById: coachId,
                    approvedAt: now,
                  },
                }
              : undefined,
          },
          select: { id: true, email: true },
        });
      }),
    );
    const toInvite = dto.invite ? created.filter((s) => s.email).map((s) => s.id) : [];
    if (toInvite.length) void this.inviteAll(user, toInvite);
    return { created: created.length, skipped, warnings, invitations: toInvite.length };
  }

  private async inviteAll(user: AuthUser, ids: number[]) {
    let sent = 0;
    for (const id of ids) {
      try {
        if ((await this.invite(user, id)).invitationSent) sent++;
      } catch (e) {
        this.logger.warn(`Carga masiva: no se invitó a la alumna ${id}: ${(e as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, MAIL_GAP_MS));
    }
    this.logger.log(`Carga masiva: ${sent} de ${ids.length} invitaciones enviadas`);
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
