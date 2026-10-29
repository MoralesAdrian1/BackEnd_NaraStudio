/**
 * Reparto del corte semanal.
 *
 * Cada pago se divide entre coaches según el plan (allocations). El dinero lo tiene quien lo
 * recibió: el efectivo, la coach que lo cobró; la tarjeta, la dueña de la cuenta de Stripe
 * (la head coach). Si quien tiene el dinero no es a quien le toca, se lo debe.
 */

export type Method = 'cash' | 'card';

export interface SettleAllocation {
  coachId: number;
  disciplineId: number;
  amountCents: number;
  method: Method;
  /** Quién tiene el dinero */
  holderCoachId: number;
}

export interface SettlePayment {
  fromCoachId: number;
  toCoachId: number;
  amountCents: number;
}

export interface CoachIncome {
  coachId: number;
  cashCents: number;
  cardCents: number;
  totalCents: number;
  byDiscipline: { disciplineId: number; cashCents: number; cardCents: number }[];
}

export interface Debt {
  fromCoachId: number;
  toCoachId: number;
  /** Lo que se debe en la semana, ya compensado entre las dos */
  amountCents: number;
  /** De dónde sale: lo que cada una cobró de la otra, por método */
  detail: { fromCoachId: number; toCoachId: number; method: Method; amountCents: number }[];
  paidCents: number;
  pendingCents: number;
}

export function settle(allocations: SettleAllocation[], payments: SettlePayment[] = []) {
  const income = new Map<number, CoachIncome>();
  const owed = new Map<string, number>(); // "de→a·método"

  for (const a of allocations) {
    const row = income.get(a.coachId) ?? { coachId: a.coachId, cashCents: 0, cardCents: 0, totalCents: 0, byDiscipline: [] };
    const key = a.method === 'cash' ? 'cashCents' : 'cardCents';
    row[key] += a.amountCents;
    row.totalCents += a.amountCents;
    let d = row.byDiscipline.find((x) => x.disciplineId === a.disciplineId);
    if (!d) row.byDiscipline.push((d = { disciplineId: a.disciplineId, cashCents: 0, cardCents: 0 }));
    d[key] += a.amountCents;
    income.set(a.coachId, row);

    if (a.holderCoachId !== a.coachId) {
      const k = `${a.holderCoachId}>${a.coachId}>${a.method}`;
      owed.set(k, (owed.get(k) ?? 0) + a.amountCents);
    }
  }

  // Compensa por pareja: si Juana le debe 300 a Nadia y Nadia 200 a Juana, Juana debe 100
  const pairs = new Map<string, Debt['detail']>();
  for (const [k, amountCents] of owed) {
    const [from, to, method] = k.split('>');
    const pair = [from, to].sort().join('-');
    pairs.set(pair, [...(pairs.get(pair) ?? []), { fromCoachId: +from, toCoachId: +to, method: method as Method, amountCents }]);
  }

  const debts: Debt[] = [];
  for (const [pair, detail] of pairs) {
    const [a, b] = pair.split('-').map(Number);
    const net = detail.reduce((sum, x) => sum + (x.fromCoachId === a ? x.amountCents : -x.amountCents), 0);
    if (net === 0) continue;
    const [fromCoachId, toCoachId] = net > 0 ? [a, b] : [b, a];
    const paidCents = payments.reduce(
      (sum, p) =>
        sum +
        (p.fromCoachId === fromCoachId && p.toCoachId === toCoachId ? p.amountCents : 0) -
        (p.fromCoachId === toCoachId && p.toCoachId === fromCoachId ? p.amountCents : 0),
      0,
    );
    const amountCents = Math.abs(net);
    debts.push({ fromCoachId, toCoachId, amountCents, detail, paidCents, pendingCents: Math.max(0, amountCents - paidCents) });
  }

  return { income: [...income.values()], debts };
}
