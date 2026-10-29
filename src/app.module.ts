import { Module, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module.js';
import { BookingsModule } from './bookings/bookings.module.js';
import { ClassesModule } from './classes/classes.module.js';
import { CoachesModule } from './coaches/coaches.module.js';
import { DisciplinesModule } from './disciplines/disciplines.module.js';
import { HealthController } from './health.controller.js';
import { MailModule } from './mail/mail.module.js';
import { MeModule } from './me/me.module.js';
import { MembershipsModule } from './memberships/memberships.module.js';
import { PlansModule } from './plans/plans.module.js';
import { ProgressModule } from './progress/progress.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { SettlementsModule } from './settlements/settlements.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    SettingsModule,
    MailModule,
    AuthModule,
    MeModule,
    DisciplinesModule,
    ClassesModule,
    CoachesModule,
    PlansModule,
    MembershipsModule,
    BookingsModule,
    ProgressModule,
    SettlementsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Rechaza campos que no estén en el DTO y convierte tipos
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    },
  ],
})
export class AppModule {}
