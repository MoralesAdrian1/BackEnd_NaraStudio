import { ForbiddenException, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AuthUser } from './auth-user.js';
import { AuthGuard } from './auth.guard.js';
import { IS_PUBLIC, ROLES } from './decorators.js';
import type { JwtVerifier } from './jwt-verifier.js';
import { RolesGuard } from './roles.guard.js';

const context = (req: Record<string, unknown>) =>
  ({
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

const reflectorWith = (meta: Record<string, unknown>) =>
  ({ getAllAndOverride: (key: string) => meta[key] }) as unknown as Reflector;

describe('AuthGuard', () => {
  const profile = { id: 'u1', role: 'student', isActive: true, coach: null, student: { id: 7 } };
  const verifier = {
    verify: async (t: string) => {
      if (t !== 'bueno') throw new Error('inválido');
      return { sub: 'u1' };
    },
  } as unknown as JwtVerifier;
  const prismaWith = (p: unknown) =>
    ({ profile: { findUnique: async () => p } }) as unknown as PrismaService;

  it('deja pasar las rutas públicas sin token', async () => {
    const guard = new AuthGuard(reflectorWith({ [IS_PUBLIC]: true }), verifier, prismaWith(null));
    expect(await guard.canActivate(context({ headers: {} }))).toBe(true);
  });

  it('pide token en las demás rutas', async () => {
    const guard = new AuthGuard(reflectorWith({}), verifier, prismaWith(profile));
    await expect(guard.canActivate(context({ headers: {} }))).rejects.toThrow(UnauthorizedException);
  });

  it('rechaza un token inválido', async () => {
    const guard = new AuthGuard(reflectorWith({}), verifier, prismaWith(profile));
    await expect(
      guard.canActivate(context({ headers: { authorization: 'Bearer malo' } })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('carga el perfil en la petición', async () => {
    const req: { headers: object; user?: AuthUser } = { headers: { authorization: 'Bearer bueno' } };
    const guard = new AuthGuard(reflectorWith({}), verifier, prismaWith(profile));
    expect(await guard.canActivate(context(req))).toBe(true);
    expect(req.user?.id).toBe('u1');
    expect(req.user?.profile?.student?.id).toBe(7);
  });

  it('deja pasar el primer ingreso aunque aún no tenga perfil', async () => {
    const req: { headers: object; user?: AuthUser } = { headers: { authorization: 'Bearer bueno' } };
    const guard = new AuthGuard(reflectorWith({}), verifier, prismaWith(null));
    expect(await guard.canActivate(context(req))).toBe(true);
    expect(req.user?.profile).toBeNull();
  });

  it('bloquea una cuenta desactivada', async () => {
    const guard = new AuthGuard(reflectorWith({}), verifier, prismaWith({ ...profile, isActive: false }));
    await expect(
      guard.canActivate(context({ headers: { authorization: 'Bearer bueno' } })),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('RolesGuard', () => {
  const asRole = (role: string | null) => context({ user: { profile: role ? { role } : null } });

  it('sin @Roles deja pasar a cualquiera con sesión', () => {
    expect(new RolesGuard(reflectorWith({})).canActivate(asRole('student'))).toBe(true);
  });

  it('una alumna no entra a rutas de coach', () => {
    const guard = new RolesGuard(reflectorWith({ [ROLES]: ['coach'] }));
    expect(() => guard.canActivate(asRole('student'))).toThrow(ForbiddenException);
  });

  it('una coach entra a rutas de coach', () => {
    const guard = new RolesGuard(reflectorWith({ [ROLES]: ['coach'] }));
    expect(guard.canActivate(asRole('coach'))).toBe(true);
  });

  it('el admin entra a rutas de coach', () => {
    const guard = new RolesGuard(reflectorWith({ [ROLES]: ['coach'] }));
    expect(guard.canActivate(asRole('admin'))).toBe(true);
  });

  it('una coach no entra a rutas de admin', () => {
    const guard = new RolesGuard(reflectorWith({ [ROLES]: ['admin'] }));
    expect(() => guard.canActivate(asRole('coach'))).toThrow(ForbiddenException);
  });

  it('sin perfil no entra a rutas con rol', () => {
    const guard = new RolesGuard(reflectorWith({ [ROLES]: ['student'] }));
    expect(() => guard.canActivate(asRole(null))).toThrow(ForbiddenException);
  });
});
