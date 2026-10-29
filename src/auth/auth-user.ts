import type { Profile } from '../generated/prisma/client.js';
import type { SupabaseClaims } from './jwt-verifier.js';

export type AuthProfile = Profile & {
  coach: { id: number; isActive: boolean } | null;
  student: { id: number } | null;
};

/** Quien hace la petición. profile es null si aún no completa su primer ingreso (GET /me). */
export interface AuthUser {
  id: string;
  claims: SupabaseClaims;
  profile: AuthProfile | null;
}
