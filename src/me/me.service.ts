import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from '../auth/auth-user.js';
import type { UpdateHealthDto, UpdateMeDto } from './me.dto.js';

const ME_INCLUDE = {
  student: { include: { health: true } },
  coach: { include: { disciplines: { include: { discipline: true } } } },
} satisfies Prisma.ProfileInclude;

type Me = Prisma.ProfileGetPayload<{ include: typeof ME_INCLUDE }>;

@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  /** Devuelve el perfil; en el primer ingreso lo crea como alumna. */
  async getOrCreate(user: AuthUser) {
    const existing = await this.find(user.id);
    if (existing) return this.present(existing);

    const email = user.claims.email;
    if (!email) throw new BadRequestException('La cuenta no tiene correo');
    const meta = user.claims.user_metadata;
    const fullName = meta?.full_name ?? meta?.name ?? email.split('@')[0];

    try {
      await this.prisma.profile.create({
        data: {
          id: user.id,
          role: 'student',
          fullName,
          email,
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
    const birthDate = dto.birthDate ? new Date(dto.birthDate) : undefined;

    await this.prisma.$transaction(async (tx) => {
      await tx.profile.update({
        where: { id: me.id },
        data: { fullName: dto.fullName, phone: dto.phone, birthDate },
      });
      if (me.student) {
        await tx.student.update({
          where: { id: me.student.id },
          data: {
            fullName: dto.fullName,
            phone: dto.phone,
            birthDate,
            address: dto.address,
            publicName: dto.publicName,
            photoPath: dto.photoPath,
          },
        });
      }
    });
    return this.present((await this.find(user.id))!);
  }

  async updateHealth(user: AuthUser, dto: UpdateHealthDto) {
    const me = await this.requireMe(user);
    if (!me.student) throw new BadRequestException('Solo las alumnas registran datos de salud');

    const data = {
      weightKg: dto.weightKg,
      heightCm: dto.heightCm,
      specialConditions: dto.specialConditions,
      consentAt: new Date(),
    };
    await this.prisma.studentHealth.upsert({
      where: { studentId: me.student.id },
      create: { studentId: me.student.id, ...data },
      update: data,
    });
    return this.present((await this.find(user.id))!);
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
  private present(me: Me) {
    const missing: string[] = [];
    if (!me.phone) missing.push('phone');
    if (!me.birthDate) missing.push('birthDate');
    if (me.student) {
      if (!me.student.address) missing.push('address');
      if (!me.student.health?.consentAt) missing.push('health');
    }
    return { ...me, missing, isComplete: missing.length === 0 };
  }
}
