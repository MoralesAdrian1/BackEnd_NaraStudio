import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { brand } from './common/brand.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true, // el webhook de Stripe verifica la firma con el cuerpo tal cual
    bodyParser: true,
  });
  const production = process.env.NODE_ENV === 'production' || !!process.env.RENDER;

  // Render pone un proxy delante: así la IP de la visitante (límite de peticiones) y el protocolo
  // (https) son los reales y no los del proxy
  app.set('trust proxy', 1);

  // Solo HTTPS en producción: si algo llega por http, se manda a https
  if (production) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.secure || req.path === '/api/health') return next();
      res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
    });
  }

  // Cabeceras de seguridad. La API solo devuelve JSON: se bloquea todo lo demás
  app.use(
    helmet({
      contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(compression());
  // Cuerpos chicos: el más grande es la carga masiva de alumnas
  app.useBodyParser('json', { limit: '1mb' });

  // Solo el sitio del estudio puede llamar a la API desde el navegador
  const origins = (process.env.CORS_ORIGINS ?? process.env.APP_URL ?? 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  app.enableCors({ origin: origins, methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'], maxAge: 86400 });

  app.setGlobalPrefix('api');
  await app.listen(process.env.PORT ?? 3000);
  console.log(`${brand().name} API en ${await app.getUrl()}`);
}
await bootstrap();
