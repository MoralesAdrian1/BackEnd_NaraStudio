import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser, Roles } from '../auth/decorators.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { CashRequestDto, CollectDto, CreateStudentDto, SellDto, StudentsQuery } from './memberships.dto.js';
import { MEMBERSHIP_INCLUDE, MembershipsService, present } from './memberships.service.js';
import { StudentsService } from './students.service.js';

@Controller('memberships')
export class MembershipsController {
  constructor(private readonly memberships: MembershipsService) {}

  // ─── Alumna ───
  @Roles('student')
  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.memberships.mine(user);
  }

  /** Comprar con pago en efectivo: queda pendiente unos días hasta que la coach lo confirme. */
  @Roles('student')
  @Post('cash-request')
  requestCash(@CurrentUser() user: AuthUser, @Body() dto: CashRequestDto) {
    return this.memberships.requestCash(user, dto);
  }

  @Roles('student')
  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.memberships.cancelRequest(user, id);
  }

  // ─── Coach ───
  @Roles('coach')
  @Get('requests')
  requests(@CurrentUser() user: AuthUser) {
    return this.memberships.requests(user);
  }

  @Roles('coach')
  @Post(':id/approve')
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.memberships.approve(user, id);
  }

  @Roles('coach')
  @Post(':id/reject')
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.memberships.reject(user, id);
  }

  /** Pase de lista con cobro: asistió y pagó en efectivo la clase o la membresía que reservó. */
  @Roles('coach')
  @Post('collect')
  collect(@CurrentUser() user: AuthUser, @Body() dto: CollectDto) {
    return this.memberships.collect(user, dto.bookingId);
  }

  /** Venta en persona con pago en efectivo */
  @Roles('coach')
  @Post('sell')
  sell(@CurrentUser() user: AuthUser, @Body() dto: SellDto) {
    return this.memberships.sell(user, dto);
  }

  @Roles('admin')
  @Post('expire')
  expire() {
    return this.memberships.expire();
  }
}

@Controller('students')
export class StudentsController {
  constructor(
    private readonly students: StudentsService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  @Roles('coach')
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: StudentsQuery) {
    return this.students.list(user, q.q);
  }

  @Roles('coach')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateStudentDto) {
    return this.students.create(user, dto);
  }

  /** Vuelve a mandar la invitación (o crea la cuenta a una alumna registrada sin ella). */
  @Roles('coach')
  @Post(':id/invite')
  invite(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.students.invite(user, id);
  }

  @Roles('coach')
  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.students.detail(user, id);
  }

  @Roles('coach')
  @Get(':id/memberships')
  async memberships(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    await this.students.assertVisible(user, id);
    const rows = await this.prisma.membership.findMany({
      where: { studentId: id },
      include: MEMBERSHIP_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    const refundNoShow = await this.settings.get('refund_credit_on_no_show', true);
    return rows.map((m) => present(m, refundNoShow));
  }
}
