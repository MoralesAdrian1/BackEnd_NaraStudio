import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser, Public, Roles } from '../auth/decorators.js';
import {
  CancelSessionDto,
  CreateClassDto,
  CreateClosureDto,
  CreateScheduleDto,
  CreateSessionDto,
  ListSessionsQuery,
  UpdateClassDto,
} from './classes.dto.js';
import { ClassesService } from './classes.service.js';
import { SessionsService } from './sessions.service.js';

@Controller('classes')
export class ClassesController {
  constructor(private readonly classes: ClassesService) {}

  @Public()
  @Get()
  list() {
    return this.classes.list();
  }

  /** Las clases de la coach (incluye desactivadas). El admin ve todas. */
  @Roles('coach')
  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.classes.list(user, true);
  }

  @Roles('coach')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateClassDto) {
    return this.classes.create(user, dto);
  }

  @Roles('coach')
  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateClassDto) {
    return this.classes.update(user, id, dto);
  }

  @Roles('coach')
  @Post(':id/schedules')
  addSchedule(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: CreateScheduleDto) {
    return this.classes.addSchedule(user, id, dto);
  }

  @Roles('coach')
  @Delete(':id/schedules/:scheduleId')
  endSchedule(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('scheduleId', ParseIntPipe) scheduleId: number,
  ) {
    return this.classes.endSchedule(user, id, scheduleId);
  }
}

@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  /** Horario público: ?from=AAAA-MM-DD&to=AAAA-MM-DD (por defecto, esta semana y la siguiente). */
  @Public()
  @Get()
  list(@Query() q: ListSessionsQuery) {
    return this.sessions.list(q.from, q.to);
  }

  @Roles('coach')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSessionDto) {
    return this.sessions.createOneOff(user, dto);
  }

  @Roles('coach')
  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() dto: CancelSessionDto) {
    return this.sessions.cancel(user, id, dto.reason);
  }

  /** Forzar la generación (normalmente corre sola cada día). */
  @Roles('admin')
  @Post('generate')
  generate() {
    return this.sessions.generate();
  }
}

@Controller('closures')
export class ClosuresController {
  constructor(private readonly sessions: SessionsService) {}

  @Public()
  @Get()
  list() {
    return this.sessions.listClosures();
  }

  @Roles('admin')
  @Post()
  create(@Body() dto: CreateClosureDto) {
    return this.sessions.createClosure(dto.date, dto.reason);
  }

  @Roles('admin')
  @Delete(':date')
  remove(@Param('date') date: string) {
    return this.sessions.deleteClosure(date);
  }
}
