export interface Share {
  coachId: number;
  disciplineId: number;
  basisPoints: number; // 10000 = 100 %
}

export interface Allocation extends Share {
  amountCents: number;
}

/**
 * Reparte un monto entre coaches según sus porcentajes.
 * Cada parte se redondea hacia abajo y los centavos que sobran van a la primera,
 * así la suma siempre es exacta.
 */
export function splitAmount(amountCents: number, shares: Share[]): Allocation[] {
  if (!shares.length) throw new Error('El plan no tiene a quién repartir');
  const total = shares.reduce((s, x) => s + x.basisPoints, 0);
  if (total !== 10_000) throw new Error(`Los porcentajes suman ${total / 100} %, no 100 %`);

  const parts = shares.map((s) => ({ ...s, amountCents: Math.floor((amountCents * s.basisPoints) / 10_000) }));
  parts[0].amountCents += amountCents - parts.reduce((s, p) => s + p.amountCents, 0);
  return parts;
}
