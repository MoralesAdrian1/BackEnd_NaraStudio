import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { JwtVerifier } from './jwt-verifier.js';

// Un "Supabase" local que publica la llave pública en el mismo camino que el real
describe('JwtVerifier', () => {
  let server: Server;
  let baseUrl: string;
  let privateKey: CryptoKey;
  let verifier: JwtVerifier;

  const sign = (claims: Record<string, unknown>, key = privateKey, opts: { iss?: string; aud?: string; exp?: string } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'ES256', kid: 'test' })
      .setIssuer(opts.iss ?? `${baseUrl}/auth/v1`)
      .setAudience(opts.aud ?? 'authenticated')
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? '5m')
      .sign(key);

  beforeAll(async () => {
    const pair = await generateKeyPair('ES256');
    privateKey = pair.privateKey;
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test', alg: 'ES256', use: 'sig' };

    server = createServer((req, res) => {
      if (req.url === '/auth/v1/.well-known/jwks.json') {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ keys: [jwk] }));
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    verifier = new JwtVerifier(new ConfigService({ SUPABASE_URL: baseUrl }));
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it('acepta un token válido y devuelve sus claims', async () => {
    const claims = await verifier.verify(await sign({ sub: 'u1', email: 'ana@correo.com' }));
    expect(claims.sub).toBe('u1');
    expect(claims.email).toBe('ana@correo.com');
  });

  it('rechaza un token de otro emisor', async () => {
    await expect(verifier.verify(await sign({ sub: 'u1' }, privateKey, { iss: 'https://otro.supabase.co/auth/v1' }))).rejects.toThrow();
  });

  it('rechaza un token con otra audiencia', async () => {
    await expect(verifier.verify(await sign({ sub: 'u1' }, privateKey, { aud: 'anon' }))).rejects.toThrow();
  });

  it('rechaza un token vencido', async () => {
    await expect(verifier.verify(await sign({ sub: 'u1' }, privateKey, { exp: '-1m' }))).rejects.toThrow();
  });

  it('rechaza un token firmado con otra llave', async () => {
    const other = await generateKeyPair('ES256');
    await expect(verifier.verify(await sign({ sub: 'u1' }, other.privateKey))).rejects.toThrow();
  });

  it('rechaza un token sin sub', async () => {
    await expect(verifier.verify(await sign({}))).rejects.toThrow();
  });
});
