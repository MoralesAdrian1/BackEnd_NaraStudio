import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type { AuthUser } from '../auth/auth-user.js';
import { coachIdOf, isAdmin } from '../auth/permissions.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreatePlanDto, ShareDto, UpdatePlanDto } from './plans.dto.js';

export const PLAN_INCLUDE = {
  revenueShares: {
    include: {
      discipline: { select: { id: true, name: true, slug: true } },
      coach: { select: { id: true, profile: { select: { fullName: true } } } },
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.PlanInclude;

type PlanRow = Prisma.PlanGetPayload<{ include: typeof PLAN_INCLUDE }>;

@Injectable()
export class PlansService {
  constructor(private readonly prisma: PrismaService) {}

  /** Catálogo público */
  async list() {
    const rows = await this.prisma.plan.findMany({
      where: { isActive: true },
      include: PLAN_INCLUDE,
      orderBy: [{ priceCents: 'desc' }],
    });
    return rows.map(presentPlan);
  }

  /** Planes que la coach creó o de los que recibe dinero; el admin ve todos. */
  async mine(user: AuthUser) {
    const coachId = coachIdOf(user);
    const rows = await this.prisma.plan.findMany({
      where: isAdmin(user) ? {} : { OR: [{ createdById: coachId }, { revenueShares: { some: { coachId } } }] },
      include: PLAN_INCLUDE,
      orderBy: [{ isActive: 'desc' }, { priceCents: 'desc' }],
    });
    return rows.map(presentPlan);
  }

  async create(user: AuthUser, dto: CreatePlanDto) {
    const coachId = coachIdOf(user);
    const shares = await this.resolveShares(user, coachId, dto);

    if (dto.allowsAutoRenew && dto.kind !== 'monthly') {
      throw new BadRequestException('El cobro automático es solo para planes mensuales');
    }
    const single = dto.kind === 'single_class';

    const plan = await this.prisma.plan.create({
      data: {
        name: dto.name,
        description: dto.description,
        kind: dto.kind,
        priceCents: dto.priceCents,
        credits: single ? 1 : (dto.credits ?? null),
        durationDays: single ? 1 : dto.durationDays,
        trainingDays: dto.trainingDays ?? [1, 2, 3, 4, 5],
        allowsAutoRenew: dto.allowsAutoRenew ?? false,
        createdById: coachId,
        revenueShares: { create: shares },
      },
      include: PLAN_INCLUDE,
    });
    return presentPlan(plan);
  }

  async update(user: AuthUser, id: number, dto: UpdatePlanDto) {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('El plan no existe');
    if (!isAdmin(user) && plan.createdById !== coachIdOf(user)) {
      throw new ForbiddenException('Solo quien creó el plan o el admin pueden editarlo');
    }
    if (dto.allowsAutoRenew && plan.kind !== 'monthly') {
      throw new BadRequestException('El cobro automático es solo para planes mensuales');
    }
    // Las membresías ya vendidas guardaron su precio: cambiarlo no las afecta
    const updated = await this.prisma.plan.update({ where: { id }, data: dto, include: PLAN_INCLUDE });
    return presentPlan(updated);
  }

  /**
   * Coach: un plan de una de sus disciplinas, 100 % suyo.
   * Admin: reparto libre (un plan combinado reparte entre dos coaches).
   */
  private async resolveShares(user: AuthUser, coachId: number, dto: CreatePlanDto): Promise<ShareDto[]> {
    if (dto.shares) {
      if (!isAdmin(user)) throw new ForbiddenException('Solo el admin define repartos o planes combinados');
      const total = dto.shares.reduce((s, x) => s + x.basisPoints, 0);
      if (total !== 10_000) throw new BadRequestException(`Los porcentajes suman ${total / 100} %, deben sumar 100 %`);
      if (new Set(dto.shares.map((s) => s.disciplineId)).size !== dto.shares.length) {
        throw new BadRequestException('Cada disciplina va una sola vez en el reparto');
      }
      for (const s of dto.shares) await this.assertTeaches(s.coachId, s.disciplineId);
      return dto.shares;
    }
    if (!dto.disciplineId) throw new BadRequestException('Indica la disciplina del plan');
    await this.assertTeaches(coachId, dto.disciplineId);
    return [{ disciplineId: dto.disciplineId, coachId, basisPoints: 10_000 }];
  }

  private async assertTeaches(coachId: number, disciplineId: number) {
    const row = await this.prisma.coachDiscipline.findUnique({
      where: { coachId_disciplineId: { coachId, disciplineId } },
      include: { discipline: true, coach: true },
    });
    if (!row || !row.discipline.isActive || !row.coach.isActive) {
      throw new BadRequestException('Esa coach no imparte esa disciplina');
    }
  }
}

export function presentPlan(p: PlanRow) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    kind: p.kind,
    priceCents: p.priceCents,
    credits: p.credits,
    durationDays: p.durationDays,
    trainingDays: p.trainingDays,
    allowsAutoRenew: p.allowsAutoRenew,
    isActive: p.isActive,
    createdById: p.createdById,
    isCombo: p.revenueShares.length > 1,
    shares: p.revenueShares.map((s) => ({
      discipline: s.discipline,
      coach: { id: s.coach.id, name: s.coach.profile.fullName },
      basisPoints: s.basisPoints,
    })),
  };
}
