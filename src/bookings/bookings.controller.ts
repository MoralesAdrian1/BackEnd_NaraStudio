import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { IsIn, IsInt } from 'class-validator';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser, Roles } from '../auth/decorators.js';
import { BookingsService } from './bookings.service.js';

class BookDto {
  @IsInt()
  sessionId!: number;
}

class MarkDto {
  @IsIn(['attended', 'no_show', 'booked'])
  status!: 'attended' | 'no_show' | 'booked';
}

class WalkInDto {
  @IsInt()
  studentId!: number;
}

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  // ─── Alumna ───
  @Roles('student')
  @Get('available')
  available(@CurrentUser() user: AuthUser) {
    return this.bookings.available(user);
  }

  @Roles('student')
  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.bookings.mine(user);
  }

  @Roles('student')
  @Post()
  book(@CurrentUser() user: AuthUser, @Body() dto: BookDto) {
    return this.bookings.book(user, dto.sessionId);
  }

  @Roles('student')
  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.bookings.cancel(user, id);
  }

  // ─── Coach: pase de lista ───
  @Roles('coach')
  @Get('sessions/:id')
  roster(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.bookings.roster(user, id);
  }

  /** Alumnas con membresía activa para esta clase que todavía no están en la lista. */
  @Roles('coach')
  @Get('sessions/:id/candidates')
  candidates(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.bookings.candidates(user, id);
  }

  @Roles('coach')
  @Post('sessions/:id/walk-in')
  walkIn(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: WalkInDto) {
    return this.bookings.walkIn(user, id, dto.studentId);
  }

  @Roles('coach')
  @Post(':id/attendance')
  mark(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: MarkDto) {
    return this.bookings.mark(user, id, dto.status);
  }
}
