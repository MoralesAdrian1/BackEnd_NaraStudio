import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller.js';
import { PrismaService } from './prisma/prisma.service.js';

describe('HealthController', () => {
  let controller: HealthController;
  const now = new Date();

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: { $queryRaw: async () => [{ now }] } },
      ],
    }).compile();

    controller = app.get(HealthController);
  });

  it('devuelve ok y la hora de la base de datos', async () => {
    expect(await controller.check()).toEqual({ ok: true, db: now });
  });
});
