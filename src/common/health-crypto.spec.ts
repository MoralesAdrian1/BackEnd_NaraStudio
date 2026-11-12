import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

describe('cifrado de datos de salud', () => {
  let mod: typeof import('./health-crypto.js');
  beforeAll(async () => {
    process.env.HEALTH_DATA_KEY = randomBytes(32).toString('base64');
    mod = await import('./health-crypto.js');
  });

  it('cifra y descifra igual, sin dejar texto en claro', () => {
    const data = { weightKg: 61.5, heightCm: 165, specialConditions: 'Lesión de rodilla' };
    const sealed = mod.sealHealth(data);
    expect(sealed.dataEnc).not.toContain('rodilla');
    expect(sealed).toMatchObject({ weightKg: null, heightCm: null, specialConditions: null });
    expect(mod.readHealth(sealed)).toEqual(data);
  });

  it('cada vez usa un IV distinto', () => {
    const data = { weightKg: null, heightCm: null, specialConditions: 'x' };
    expect(mod.encryptHealth(data)).not.toBe(mod.encryptHealth(data));
  });

  it('rechaza datos alterados', () => {
    const enc = mod.encryptHealth({ weightKg: 1, heightCm: 1, specialConditions: 'a' });
    const parts = enc.split('.');
    parts[3] = Buffer.from('otra cosa').toString('base64url');
    expect(() => mod.readHealth({ dataEnc: parts.join('.'), weightKg: null, heightCm: null, specialConditions: null })).toThrow();
  });

  it('lee los registros viejos sin cifrar', () => {
    expect(mod.readHealth({ dataEnc: null, weightKg: '70.25', heightCm: 170, specialConditions: null })).toEqual({
      weightKg: 70.25,
      heightCm: 170,
      specialConditions: null,
    });
  });
});
