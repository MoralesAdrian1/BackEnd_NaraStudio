import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser, Public, Roles } from '../auth/decorators.js';
import { CreatePlanDto, UpdatePlanDto } from './plans.dto.js';
import { PlansService } from './plans.service.js';

@Controller('plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Public()
  @Get()
  list() {
    return this.plans.list();
  }

  @Roles('coach')
  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.plans.mine(user);
  }

  @Roles('coach')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePlanDto) {
    return this.plans.create(user, dto);
  }

  @Roles('coach')
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdatePlanDto) {
    return this.plans.update(user, id, dto);
  }
}
