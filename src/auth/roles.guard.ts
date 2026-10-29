import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '../generated/prisma/client.js';
import type { AuthUser } from './auth-user.js';
import { ROLES } from './decorators.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!roles?.length) return true;

    const profile = ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user?.profile;
    const role = profile?.role;
    // Una coach desactivada ya no entra a rutas de coach
    if (role === 'coach' && profile?.coach?.isActive === false) throw new ForbiddenException('Tu perfil de coach está desactivado');
    // El admin (head coach) puede todo lo que puede una coach.
    const allowed =
      !!role && (roles.includes(role) || (role === 'admin' && roles.includes('coach')));
    if (!allowed) throw new ForbiddenException();
    return true;
  }
}
