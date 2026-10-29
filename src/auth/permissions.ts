import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from './auth-user.js';

export const isAdmin = (user: AuthUser) => user.profile?.role === 'admin';

/** El id de coach de quien hace la petición (admin incluido). */
export function coachIdOf(user: AuthUser): number {
  const coach = user.profile?.coach;
  if (!coach) throw new ForbiddenException('Tu cuenta no tiene perfil de coach');
  if (!coach.isActive && !isAdmin(user)) throw new ForbiddenException('Tu perfil de coach está desactivado');
  return coach.id;
}

/** Solo la coach dueña o el admin. */
export function assertOwnsOrAdmin(user: AuthUser, ownerCoachId: number) {
  if (!isAdmin(user) && coachIdOf(user) !== ownerCoachId) {
    throw new ForbiddenException('Solo la coach de esta clase o el admin pueden hacer esto');
  }
}
