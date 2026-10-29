import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/decorators.js';
import { PrismaService } from './prisma/prisma.service.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    const [{ now }] = await this.prisma.$queryRaw<
      { now: Date }[]
    >`SELECT NOW() AS now`;
    return { ok: true, db: now };
  }
}
