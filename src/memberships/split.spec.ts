import { splitAmount } from './split.js';

describe('splitAmount', () => {
  const nadia = { coachId: 1, disciplineId: 1 };
  const juana = { coachId: 2, disciplineId: 2 };

  it('un plan de una sola coach se queda completo', () => {
    expect(splitAmount(70_000, [{ ...nadia, basisPoints: 10_000 }])).toEqual([{ ...nadia, basisPoints: 10_000, amountCents: 70_000 }]);
  });

  it('el ilimitado de $900 se reparte $450 y $450', () => {
    const out = splitAmount(90_000, [{ ...nadia, basisPoints: 5000 }, { ...juana, basisPoints: 5000 }]);
    expect(out.map((a) => a.amountCents)).toEqual([45_000, 45_000]);
  });

  it('el centavo que sobra va a la primera y la suma siempre cuadra', () => {
    const out = splitAmount(86_701, [{ ...nadia, basisPoints: 5000 }, { ...juana, basisPoints: 5000 }]);
    expect(out.map((a) => a.amountCents)).toEqual([43_351, 43_350]);
    expect(out[0].amountCents + out[1].amountCents).toBe(86_701);
  });

  it('respeta porcentajes distintos', () => {
    const out = splitAmount(100_000, [{ ...nadia, basisPoints: 5300 }, { ...juana, basisPoints: 4700 }]);
    expect(out.map((a) => a.amountCents)).toEqual([53_000, 47_000]);
  });

  it('rechaza porcentajes que no suman 100 %', () => {
    expect(() => splitAmount(100, [{ ...nadia, basisPoints: 6000 }])).toThrow();
    expect(() => splitAmount(100, [])).toThrow();
  });
});
