import { describe, expect, it } from 'vitest';
import { ageOn, assertAllowedAge, isMinor } from './age.js';

describe('edad', () => {
  const today = new Date('2026-11-12T18:00:00Z');

  it('cuenta los años cumplidos', () => {
    expect(ageOn('2008-11-12', today)).toBe(18);
    expect(ageOn('2008-11-13', today)).toBe(17);
    expect(ageOn('2014-01-01', today)).toBe(12);
  });

  it('menor de edad: menos de 18', () => {
    expect(isMinor(null)).toBe(false);
    expect(isMinor('1990-05-05')).toBe(false);
    expect(isMinor(new Date(Date.now() - 15 * 365.25 * 86_400_000).toISOString().slice(0, 10))).toBe(true);
  });

  it('no permite cuentas de menores de 12 ni fechas futuras', () => {
    const elevenYears = new Date(Date.now() - 11 * 365.25 * 86_400_000).toISOString().slice(0, 10);
    expect(() => assertAllowedAge(elevenYears)).toThrow(/al menos 12/);
    expect(() => assertAllowedAge('2999-01-01')).toThrow();
    expect(assertAllowedAge('2000-01-01')).toBeGreaterThan(18);
  });
});
