import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/decorators.js';
import { UpdateHealthDto, UpdateMeDto } from './me.dto.js';
import { MeService } from './me.service.js';

@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  /** Llamarlo justo después de iniciar sesión: en el primer ingreso crea el perfil. */
  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.me.getOrCreate(user);
  }

  @Patch()
  update(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.me.update(user, dto);
  }

  @Put('health')
  updateHealth(@CurrentUser() user: AuthUser, @Body() dto: UpdateHealthDto) {
    return this.me.updateHealth(user, dto);
  }
}
