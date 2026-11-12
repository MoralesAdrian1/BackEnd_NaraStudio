import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/decorators.js';
import { DeleteMeDto, UpdateHealthDto, UpdateMeDto } from './me.dto.js';
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

  /** Retira su consentimiento: se borran sus datos de salud. */
  @Delete('health')
  deleteHealth(@CurrentUser() user: AuthUser) {
    return this.me.deleteHealth(user);
  }

  /** Borra su cuenta y sus datos personales (POST con cuerpo: confirma con su correo). */
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @Post('delete')
  @HttpCode(200)
  deleteAccount(@CurrentUser() user: AuthUser, @Body() dto: DeleteMeDto) {
    return this.me.deleteAccount(user, dto);
  }
}
