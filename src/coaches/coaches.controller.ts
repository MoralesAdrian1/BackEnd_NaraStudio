import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser, Public, Roles } from '../auth/decorators.js';
import { CreateCertificationDto, PromoteCoachDto, UpdateCoachDto, UpdateMyCoachDto } from './coaches.dto.js';
import { CoachesService } from './coaches.service.js';

@Controller('coaches')
export class CoachesController {
  constructor(private readonly coaches: CoachesService) {}

  /** Perfil público de las coaches activas */
  @Public()
  @Get()
  list() {
    return this.coaches.listPublic();
  }

  // ─── La propia coach (rutas fijas antes de :id) ───
  @Roles('coach')
  @Get('me')
  mine(@CurrentUser() user: AuthUser) {
    return this.coaches.mine(user);
  }

  @Roles('coach')
  @Patch('me')
  updateMine(@CurrentUser() user: AuthUser, @Body() dto: UpdateMyCoachDto) {
    return this.coaches.updateMine(user, dto);
  }

  @Roles('coach')
  @Post('me/certifications')
  addCertification(@CurrentUser() user: AuthUser, @Body() dto: CreateCertificationDto) {
    return this.coaches.addCertification(user, dto);
  }

  @Roles('coach')
  @Delete('me/certifications/:id')
  removeCertification(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.coaches.removeCertification(user, id);
  }

  // ─── Admin ───
  @Roles('admin')
  @Get('all')
  listAll() {
    return this.coaches.listAll();
  }

  @Roles('admin')
  @Post()
  promote(@Body() dto: PromoteCoachDto) {
    return this.coaches.promote(dto);
  }

  @Roles('admin')
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCoachDto) {
    return this.coaches.update(user, id, dto);
  }
}
