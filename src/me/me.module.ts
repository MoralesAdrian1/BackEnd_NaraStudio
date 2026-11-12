import { Module } from '@nestjs/common';
import { SupabaseAdmin } from '../auth/supabase-admin.js';
import { AccountDeletion } from './account-deletion.service.js';
import { MeController } from './me.controller.js';
import { MeService } from './me.service.js';

@Module({
  controllers: [MeController],
  providers: [MeService, AccountDeletion, SupabaseAdmin],
  exports: [AccountDeletion],
})
export class MeModule {}
