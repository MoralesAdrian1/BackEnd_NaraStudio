import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard.js';
import { JwtVerifier } from './jwt-verifier.js';
import { RolesGuard } from './roles.guard.js';

@Module({
  providers: [
    JwtVerifier,
    // Orden: primero la sesión, después el rol
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [JwtVerifier],
})
export class AuthModule {}
