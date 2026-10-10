import { randomUUID } from 'node:crypto';

/** Deterministic-where-possible helpers so integration tests are readable. */

export const uuid = () => randomUUID();

/** The 10 x 2 AZN = 20 AZN worked example from the business spec. */
export const SPEC_EXAMPLE = {
  bottleCount: 10,
  unitPrice: '2.00',
  totalAmount: 20,
  partialPayment: 12,
  remainingDebt: 8,
};

export function key(): string {
  return randomUUID();
}

export function money(n: number): string {
  return n.toFixed(2);
}
