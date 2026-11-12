import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: config.getOrThrow<string>('DATABASE_URL'),
        // Supabase exige SSL; el Postgres local no lo usa.
        ssl:
          config.get('DATABASE_SSL') === 'true'
            ? { rejectUnauthorized: false }
            : false,
        // Abrir una conexión nueva (TLS + login con Supabase) cuesta ~600 ms. Por defecto pg cierra
        // las conexiones a los 10 s sin uso, así que con poco tráfico casi cada clic pagaba eso.
        // Se mantienen abiertas 10 min y con keep-alive para que el proxy no las corte.
        max: 10,
        idleTimeoutMillis: 10 * 60_000,
        keepAlive: true,
        connectionTimeoutMillis: 10_000,
      }),
      // PRISMA_LOG=query imprime cada consulta (para medir cuántas hace cada ruta)
      log: config.get('PRISMA_LOG') === 'query' ? ['query'] : [],
    });
  }

  /** Abre la primera conexión al arrancar, no en la primera petición de una usuaria. */
  async onModuleInit() {
    await this.$connect().catch(() => undefined);
    await this.$queryRaw`SELECT 1`.catch(() => undefined);
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
