import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthGuard } from './auth.guard.js';
import { JwtVerifier } from './jwt-verifier.js';
import { RolesGuard } from './roles.guard.js';

@Module({
  imports: [
    // Límite de peticiones por IP: 120 por minuto en general (las rutas delicadas piden menos,
    // con @Throttle). Frena abusos y bots antes de tocar la base de datos.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
  ],
  providers: [
    JwtVerifier,
    // Orden: primero el límite de peticiones, luego la sesión, después el rol
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [JwtVerifier],
})
export class AuthModule {}
