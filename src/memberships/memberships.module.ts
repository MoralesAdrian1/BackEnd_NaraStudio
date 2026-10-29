import { Module } from '@nestjs/common';
import { SupabaseAdmin } from '../auth/supabase-admin.js';
import { BookingsModule } from '../bookings/bookings.module.js';
import { MembershipsController, StudentsController } from './memberships.controller.js';
import { MembershipsService } from './memberships.service.js';
import { PurchaseMails } from './purchase-mails.js';
import { StudentsService } from './students.service.js';

@Module({
  imports: [BookingsModule],
  controllers: [MembershipsController, StudentsController],
  providers: [MembershipsService, StudentsService, SupabaseAdmin, PurchaseMails],
})
export class MembershipsModule {}
