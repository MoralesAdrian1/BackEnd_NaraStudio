import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from './auth-user.js';
import { IS_PUBLIC } from './decorators.js';
import { JwtVerifier } from './jwt-verifier.js';

/** Guard global: toda ruta pide sesión salvo las marcadas con @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: JwtVerifier,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const [scheme, token] = req.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();

    const claims = await this.verifier.verify(token).catch(() => {
      throw new UnauthorizedException();
    });

    // El rol se lee de la base en cada petición, no del token: así un cambio de rol
    // o una baja aplican de inmediato.
    const profile = await this.prisma.profile.findUnique({
      where: { id: claims.sub },
      include: {
        coach: { select: { id: true, isActive: true } },
        student: { select: { id: true } },
      },
    });
    if (profile && !profile.isActive) throw new ForbiddenException('Cuenta desactivada');

    req.user = { id: claims.sub, claims, profile };
    return true;
  }
}
