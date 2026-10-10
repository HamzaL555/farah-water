import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { DeliveryStatus } from '@prisma/client';
import { derivePaymentStatus, deriveDebt, round2 } from '../../src/common/utils/status';
import { moneyOut, addMoney, subMoney, round2 as round2Money } from '../../src/common/utils/money';

const d = (v: string | number) => new Prisma.Decimal(v);

describe('money arithmetic', () => {
  it('avoids binary floating point error on 0.1 + 0.2', () => {
    // The classic float bug: 0.1 + 0.2 === 0.30000000000000004 in JS floats.
    const sum = addMoney(d('0.10'), d('0.20'));
    expect(sum.toFixed(2)).toBe('0.30');
    expect(moneyOut(addMoney(d('0.10'), d('0.20')))).toBe(0.3);
  });

  it('rounds half-up to 2 decimals', () => {
    expect(round2Money(d('1.005')).toFixed(2)).toBe('1.01');
    expect(round2Money(d('2.344')).toFixed(2)).toBe('2.34');
    expect(round2Money(d('10.567')).toFixed(2)).toBe('10.57');
  });

  it('computes the spec example: 10 bottles x 2.00 = 20.00', () => {
    const total = round2Money(d('2.00').mul(10));
    expect(total.toFixed(2)).toBe('20.00');
    expect(moneyOut(total)).toBe(20);
  });

  it('keeps totals exact for values that break float maths', () => {
    // 3 x 0.1 = 0.30000000000000004 as floats; Decimal keeps it exact.
    const total = round2Money(d('0.10').mul(3));
    expect(total.toFixed(2)).toBe('0.30');

    const big = round2Money(d('19.99').mul(3));
    expect(big.toFixed(2)).toBe('59.97');
  });

  it('subtracts without drift', () => {
    expect(subMoney(d('20.00'), d('12.00')).toFixed(2)).toBe('8.00');
    expect(addMoney(d('8.00'), d('12.00')).toFixed(2)).toBe('20.00');
  });

  it('serialises to plain JSON-safe numbers', () => {
    expect(moneyOut(d('12.5'))).toBe(12.5);
    expect(moneyOut(null)).toBe(0);
    expect(moneyOut(undefined)).toBe(0);
  });
});

describe('payment status derivation', () => {
  it('is UNPAID when nothing was paid', () => {
    expect(derivePaymentStatus(d('20.00'), d('0'))).toBe(DeliveryStatus.UNPAID);
  });

  it('is PARTIAL for the spec example (12 of 20 AZN)', () => {
    expect(derivePaymentStatus(d('20.00'), d('12.00'))).toBe(DeliveryStatus.PARTIAL);
  });

  it('is PAID when the full amount is paid', () => {
    expect(derivePaymentStatus(d('20.00'), d('20.00'))).toBe(DeliveryStatus.PAID);
  });

  it('treats a tiny residual due to rounding as fully paid', () => {
    expect(derivePaymentStatus(d('20.00'), d('19.999'))).toBe(DeliveryStatus.PAID);
  });

  it('never reports PAID for a zero-payment delivery', () => {
    expect(derivePaymentStatus(d('20.00'), d('0.00'))).not.toBe(DeliveryStatus.PAID);
  });

  it('never reports PAID for a partial payment', () => {
    // This is the core anti-fraud guarantee: choosing "PAID" in the UI cannot
    // bypass the real money check.
    expect(derivePaymentStatus(d('20.00'), d('12.00'))).not.toBe(DeliveryStatus.PAID);
  });

  it('handles a zero-value delivery as paid', () => {
    expect(derivePaymentStatus(d('0'), d('0'))).toBe(DeliveryStatus.PAID);
  });
});

describe('debt derivation', () => {
  it('is total minus paid (spec example)', () => {
    expect(deriveDebt(d('20.00'), d('12.00')).toFixed(2)).toBe('8.00');
  });

  it('is full total when nothing is paid', () => {
    expect(deriveDebt(d('20.00'), d('0')).toFixed(2)).toBe('20.00');
  });

  it('is zero when fully paid', () => {
    expect(deriveDebt(d('20.00'), d('20.00')).toFixed(2)).toBe('0.00');
  });

  it('never goes negative on an overpayment', () => {
    expect(deriveDebt(d('20.00'), d('25.00')).toFixed(2)).toBe('0.00');
  });
});

describe('round2', () => {
  it('keeps two decimals stable', () => {
    expect(round2(d('1.999')).toFixed(2)).toBe('2.00');
    expect(round2(d('1.001')).toFixed(2)).toBe('1.00');
  });
});
