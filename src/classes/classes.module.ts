import { Module } from '@nestjs/common';
import { ClassesController, ClosuresController, SessionsController } from './classes.controller.js';
import { ClassesService } from './classes.service.js';
import { SessionsService } from './sessions.service.js';

@Module({
  controllers: [ClassesController, SessionsController, ClosuresController],
  providers: [ClassesService, SessionsService],
  exports: [SessionsService],
})
export class ClassesModule {}
