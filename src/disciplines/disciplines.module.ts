import { Module } from '@nestjs/common';
import { DisciplinesController } from './disciplines.controller.js';

@Module({ controllers: [DisciplinesController] })
export class DisciplinesModule {}
