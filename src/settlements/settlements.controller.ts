import { BadRequestException, Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser, Roles } from '../auth/decorators.js';
import { SettlementPaymentDto, WeekQuery } from './settlements.dto.js';
import { SettlementsService } from './settlements.service.js';

@Controller('settlements')
export class SettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  /** Ingresos de la semana y quién le debe a quién */
  @Roles('coach')
  @Get()
  week(@CurrentUser() user: AuthUser, @Query() q: WeekQuery) {
    return this.settlements.week(user, q.start);
  }

  @Roles('coach')
  @Post(':start/payments')
  pay(@CurrentUser() user: AuthUser, @Param() p: { start: string }, @Body() dto: SettlementPaymentDto) {
    return this.settlements.pay(user, isoDate(p.start), dto);
  }

  @Roles('coach')
  @Delete('payments/:id')
  removePayment(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.settlements.removePayment(user, id);
  }

  @Roles('admin')
  @Post(':start/close')
  close(@Param() p: { start: string }) {
    return this.settlements.close(isoDate(p.start));
  }
}

function isoDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new BadRequestException('Fecha inválida');
  return s;
}
