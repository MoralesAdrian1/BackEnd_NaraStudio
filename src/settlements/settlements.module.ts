import { Module } from '@nestjs/common';
import { SettlementsController } from './settlements.controller.js';
import { SettlementsService } from './settlements.service.js';

@Module({
  controllers: [SettlementsController],
  providers: [SettlementsService],
})
export class SettlementsModule {}
