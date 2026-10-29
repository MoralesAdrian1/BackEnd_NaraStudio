import { Controller, Get, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser, Roles } from '../auth/decorators.js';
import { ProgressService } from './progress.service.js';

@Controller('progress')
export class ProgressController {
  constructor(private readonly progress: ProgressService) {}

  /** Mi racha y mis últimos días */
  @Roles('student')
  @Get('me')
  mine(@CurrentUser() user: AuthUser) {
    return this.progress.mine(user);
  }

  /** Reconocimientos del mes: cualquier cuenta los ve */
  @Get('leaderboard')
  leaderboard(@CurrentUser() user: AuthUser) {
    return this.progress.leaderboard(user);
  }

  /** Recalcular la tabla ahora (sin esperar a la noche) */
  @Roles('admin')
  @Post('leaderboard/refresh')
  refresh() {
    return this.progress.nightly();
  }
}
