import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Role } from '../generated/prisma/client.js';
import type { AuthUser } from './auth-user.js';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

/** Ruta sin sesión. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Ruta solo para estos roles. El admin también entra donde se pide coach. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** La usuaria de la petición, ya verificada por AuthGuard. */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<{ user: AuthUser }>().user,
);
