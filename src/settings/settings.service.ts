import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/** Lee las políticas del estudio guardadas en studio_settings. */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const row = await this.prisma.studioSetting.findUnique({ where: { key } });
    return row ? (row.value as T) : fallback;
  }
}
