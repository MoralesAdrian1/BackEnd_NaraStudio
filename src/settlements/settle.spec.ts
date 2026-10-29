import { settle, type SettleAllocation } from './settle.js';

const NADIA = 1; // head coach: la cuenta de Stripe es suya
const JUANA = 2;
const BARRE = 1;
const JUMP = 2;

describe('settle', () => {
  it('el efectivo de un plan propio no genera deuda', () => {
    const r = settle([{ coachId: JUANA, disciplineId: JUMP, amountCents: 50_000, method: 'cash', holderCoachId: JUANA }]);
    expect(r.debts).toEqual([]);
    expect(r.income).toEqual([
      { coachId: JUANA, cashCents: 50_000, cardCents: 0, totalCents: 50_000, byDiscipline: [{ disciplineId: JUMP, cashCents: 50_000, cardCents: 0 }] },
    ]);
  });

  it('el combo cobrado en efectivo: quien cobró le da su mitad a la otra', () => {
    const r = settle([
      { coachId: NADIA, disciplineId: BARRE, amountCents: 45_000, method: 'cash', holderCoachId: JUANA },
      { coachId: JUANA, disciplineId: JUMP, amountCents: 45_000, method: 'cash', holderCoachId: JUANA },
    ]);
    expect(r.debts).toMatchObject([{ fromCoachId: JUANA, toCoachId: NADIA, amountCents: 45_000, pendingCents: 45_000 }]);
  });

  it('la tarjeta llega a la cuenta de Nadia: le debe a Juana lo suyo', () => {
    const r = settle([{ coachId: JUANA, disciplineId: JUMP, amountCents: 48_000, method: 'card', holderCoachId: NADIA }]);
    expect(r.debts).toMatchObject([{ fromCoachId: NADIA, toCoachId: JUANA, amountCents: 48_000 }]);
    expect(r.income[0]).toMatchObject({ cashCents: 0, cardCents: 48_000 });
  });

  it('compensa lo que se deben entre las dos y descuenta lo ya pagado', () => {
    const allocations: SettleAllocation[] = [
      { coachId: NADIA, disciplineId: BARRE, amountCents: 30_000, method: 'cash', holderCoachId: JUANA },
      { coachId: JUANA, disciplineId: JUMP, amountCents: 20_000, method: 'card', holderCoachId: NADIA },
    ];
    const r = settle(allocations, [{ fromCoachId: JUANA, toCoachId: NADIA, amountCents: 4_000 }]);
    expect(r.debts).toHaveLength(1);
    expect(r.debts[0]).toMatchObject({ fromCoachId: JUANA, toCoachId: NADIA, amountCents: 10_000, paidCents: 4_000, pendingCents: 6_000 });
    expect(r.debts[0].detail).toHaveLength(2);
  });

  it('si se compensan exacto no queda deuda', () => {
    const r = settle([
      { coachId: NADIA, disciplineId: BARRE, amountCents: 10_000, method: 'cash', holderCoachId: JUANA },
      { coachId: JUANA, disciplineId: JUMP, amountCents: 10_000, method: 'cash', holderCoachId: NADIA },
    ]);
    expect(r.debts).toEqual([]);
  });
});
