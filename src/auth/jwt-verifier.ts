import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';

export interface SupabaseClaims extends JWTPayload {
  sub: string;
  email?: string;
  user_metadata?: { full_name?: string; name?: string };
}

/**
 * Verifica los access tokens de Supabase Auth con la llave pública del proyecto (ES256).
 * La llave se descarga de JWKS y jose la guarda en memoria.
 */
@Injectable()
export class JwtVerifier {
  private readonly issuer: string;
  private readonly keys: JWTVerifyGetKey;

  constructor(config: ConfigService) {
    this.issuer = `${config.getOrThrow<string>('SUPABASE_URL')}/auth/v1`;
    this.keys = createRemoteJWKSet(
      new URL(`${this.issuer}/.well-known/jwks.json`),
    );
  }

  async verify(token: string): Promise<SupabaseClaims> {
    const { payload } = await jwtVerify(token, this.keys, {
      issuer: this.issuer,
      audience: 'authenticated',
    });
    if (!payload.sub) throw new Error('Token sin sub');
    return payload as SupabaseClaims;
  }
}
