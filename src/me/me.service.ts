import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/auth-user.js';
import type { DeleteMeDto, UpdateHealthDto, UpdateMeDto } from './me.dto.js';
import { TERMS_VERSION } from '../common/legal.js';
import { assertAllowedAge, isMinor } from '../common/age.js';
import { readHealth, sealHealth } from '../common/health-crypto.js';
import { StudentPhotos } from '../common/student-photos.js';
import { AccountDeletion } from './account-deletion.service.js';

const ME_INCLUDE = {
  student: { include: { health: true } },
  coach: { include: { disciplines: { include: { discipline: true } } } },
} satisfies Prisma.ProfileInclude;

type Me = Prisma.ProfileGetPayload<{ include: typeof ME_INCLUDE }>;

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly photos: StudentPhotos,
    private readonly deletion: AccountDeletion,
  ) {}

  /** Devuelve el perfil; en el primer ingreso lo crea como alumna. */
  async getOrCreate(user: AuthUser) {
    const existing = await this.find(user.id);
    if (existing) return this.present(existing);

    const email = user.claims.email;
    if (!email) throw new BadRequestException('La cuenta no tiene correo');
    const meta = user.claims.user_metadata;
    const fullName = (meta?.full_name ?? meta?.name ?? email.split('@')[0]).slice(0, 120);
    // Al crear la cuenta con correo ya aceptó los documentos (viene en sus metadatos)
    const accepted = meta?.terms_version === TERMS_VERSION;

    try {
      await this.prisma.profile.create({
        data: {
          id: user.id,
          role: 'student',
          fullName,
          email,
          ...(accepted && { termsVersion: TERMS_VERSION, termsAcceptedAt: new Date() }),
          student: { create: { fullName, email } },
        },
      });
    } catch (e) {
      // Dos peticiones simultáneas en el primer ingreso: la otra ya lo creó
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
    return this.present((await this.find(user.id))!);
  }

  async update(user: AuthUser, dto: UpdateMeDto) {
    const me = await this.requireMe(user);
    if (dto.photoPath && !dto.photoPath.startsWith(`${user.id}/`)) {
      throw new BadRequestException('La foto debe estar en tu carpeta');
    }
    if (dto.birthDate) assertAllowedAge(dto.birthDate);
    const birthDate = dto.birthDate ? new Date(dto.birthDate) : undefined;

    // Menor de edad: hace falta su madre, padre o tutor (una vez; después solo se actualizan)
    const minor = me.student && isMinor(dto.birthDate ?? me.birthDate);
    const guardian = minor ? this.guardianData(me, dto) : {};

    await this.prisma.$transaction(async (tx) => {
      await tx.profile.update({
        where: { id: me.id },
        data: {
          fullName: dto.fullName,
          phone: dto.phone,
          birthDate,
          ...(dto.acceptTerms && { termsVersion: TERMS_VERSION, termsAcceptedAt: new Date() }),
        },
      });
      if (me.student) {
        await tx.student.update({
          where: { id: me.student.id },
          data: {
            fullName: dto.fullName,
            phone: dto.phone,
            birthDate,
            publicName: dto.publicName,
            photoPath: dto.photoPath,
            ...guardian,
          },
        });
      }
    });
    return this.present((await this.find(user.id))!);
  }

  /** Datos del tutor que se guardan. Pide los que falten si todavía no autorizó. */
  private guardianData(me: Me, dto: UpdateMeDto) {
    const s = me.student!;
    const name = dto.guardianName ?? s.guardianName;
    const phone = dto.guardianPhone ?? s.guardianPhone;
    const consented = s.guardianConsentAt || dto.guardianConsent;
    if (!name || !phone || !consented) {
      throw new BadRequestException(
        'Como eres menor de edad, necesitamos el nombre y el celular de tu madre, padre o tutor, y su autorización',
      );
    }
    return {
      guardianName: dto.guardianName,
      guardianPhone: dto.guardianPhone,
      guardianEmail: dto.guardianEmail,
      ...(!s.guardianConsentAt && { guardianConsentAt: new Date() }),
    };
  }

  async updateHealth(user: AuthUser, dto: UpdateHealthDto) {
    const me = await this.requireMe(user);
    if (!me.student) throw new BadRequestException('Solo las alumnas registran datos de salud');

    const data = {
      ...sealHealth({
        weightKg: dto.weightKg ?? null,
        heightCm: dto.heightCm ?? null,
        specialConditions: dto.specialConditions?.trim() || null,
      }),
      consentAt: new Date(),
    };
    await this.prisma.studentHealth.upsert({
      where: { studentId: me.student.id },
      create: { studentId: me.student.id, ...data },
      update: data,
    });
    return this.present((await this.find(user.id))!);
  }

  /** Revoca el consentimiento: se borran sus datos de salud. */
  async deleteHealth(user: AuthUser) {
    const me = await this.requireMe(user);
    if (me.student) await this.prisma.studentHealth.deleteMany({ where: { studentId: me.student.id } });
    return this.present((await this.find(user.id))!);
  }

  /** La alumna borra su cuenta y sus datos personales. */
  async deleteAccount(user: AuthUser, dto: DeleteMeDto) {
    const me = await this.requireMe(user);
    if (!me.student || me.role !== 'student') {
      throw new BadRequestException('Las cuentas de coach las da de baja la head coach. Escríbele para hacerlo.');
    }
    if (dto.confirmEmail.trim().toLowerCase() !== me.email.toLowerCase()) {
      throw new BadRequestException('El correo no coincide con el de tu cuenta');
    }
    return this.deletion.deleteStudent(me.student.id);
  }

  private find(id: string) {
    return this.prisma.profile.findUnique({ where: { id }, include: ME_INCLUDE });
  }

  private async requireMe(user: AuthUser) {
    const me = await this.find(user.id);
    if (!me) throw new BadRequestException('Primero llama a GET /me');
    return me;
  }

  /** Perfil + qué datos le faltan por completar (para el registro con Google o Facebook). */
  private async present(me: Me) {
    const missing: string[] = [];
    if (me.termsVersion !== TERMS_VERSION) missing.push('terms');
    if (!me.phone) missing.push('phone');
    if (!me.birthDate) missing.push('birthDate');
    if (me.student && isMinor(me.birthDate) && !me.student.guardianConsentAt) missing.push('guardian');

    let student = null;
    if (me.student) {
      const { health, ...rest } = me.student;
      const photoUrl = (await this.photos.sign([rest.photoPath])).get(rest.photoPath ?? '') ?? null;
      student = {
        ...rest,
        photoUrl,
        isMinor: isMinor(me.birthDate),
        health: health && { ...readHealth(health), consentAt: health.consentAt, updatedAt: health.updatedAt },
      };
    }
    return { ...me, student, missing, isComplete: missing.length === 0 };
  }
}
