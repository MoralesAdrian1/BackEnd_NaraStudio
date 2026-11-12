import { Module } from '@nestjs/common';
import { SupabaseAdmin } from '../auth/supabase-admin.js';
import { BookingsModule } from '../bookings/bookings.module.js';
import { MeModule } from '../me/me.module.js';
import { MembershipsController, StudentsController } from './memberships.controller.js';
import { MembershipsService } from './memberships.service.js';
import { PurchaseMails } from './purchase-mails.js';
import { StudentsService } from './students.service.js';
import { StripeService } from '../payments/stripe.service.js';
import { StripeWebhookController } from '../payments/stripe-webhook.controller.js';

@Module({
  imports: [BookingsModule, MeModule],
  controllers: [MembershipsController, StudentsController, StripeWebhookController],
  providers: [MembershipsService, StudentsService, SupabaseAdmin, PurchaseMails, StripeService],
})
export class MembershipsModule {}
