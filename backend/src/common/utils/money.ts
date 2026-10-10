import { Prisma } from '@prisma/client';

/**
 * All money handling in this system goes through Prisma.Decimal, which maps to
 * Postgres `numeric(12,2)`. Floating point arithmetic is never used for money.
 */

export type Money = Prisma.Decimal;

export function money(value: Prisma.Decimal | number | string | null | undefined): Prisma.Decimal {
  if (value === null || value === undefined) return new Prisma.Decimal(0);
  return new Prisma.Decimal(value);
}

/** Round half-up to 2 decimals, matching what Postgres `numeric(12,2)` stores. */
export function round2(value: Prisma.Decimal | number | string): Prisma.Decimal {
  return new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function addMoney(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  return round2(a.add(b));
}

export function subMoney(a: Prisma.Decimal, b: Prisma.Decimal): Prisma.Decimal {
  return round2(a.sub(b));
}

/**
 * JSON-safe money: Prisma.Decimal serialises itself to a string by default.
 * We normalise every money field in API responses through this helper so the
 * mobile client always receives a number rounded to exactly 2 decimals.
 * Amounts are bounded by numeric(12,2) (< 1e10) so Number is lossless here.
 */
export function moneyOut(value: Prisma.Decimal | number | string | null | undefined): number {
  return Number(round2(money(value)).toFixed(2));
}

/** Builds `{ _sum: { field } }` aggregation results into a plain number. */
export function sumOut(value: Prisma.Decimal | number | string | null | undefined): number {
  return moneyOut(value ?? 0);
}
