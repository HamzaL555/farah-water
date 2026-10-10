import { DeliveryStatus, Prisma } from '@prisma/client';

/**
 * The single source of truth for payment status.
 *
 * Business rule 5: status is DERIVED from the real money that came in. It can
 * never be set independently by a client, so picking "PAID" in the UI without
 * recording a payment does not clear the debt - the recomputation overwrites it.
 */

export function derivePaymentStatus(totalAmount: Prisma.Decimal, paidAmount: Prisma.Decimal): DeliveryStatus {
  // All money in this system is stored at 2 decimals, so compare the rounded
  // values. Without this a 19.999 residual would read as PARTIAL forever.
  const total = round2(totalAmount);
  const paid = round2(paidAmount);

  // Nothing was ever owed (e.g. a complimentary delivery): nothing is outstanding.
  if (total.lessThanOrEqualTo(0)) return DeliveryStatus.PAID;
  if (paid.lessThanOrEqualTo(0)) return DeliveryStatus.UNPAID;
  if (paid.greaterThanOrEqualTo(total)) return DeliveryStatus.PAID;
  return DeliveryStatus.PARTIAL;
}

/** Remaining debt, never negative (never "over-credit" a delivery). */
export function deriveDebt(totalAmount: Prisma.Decimal, paidAmount: Prisma.Decimal): Prisma.Decimal {
  const remaining = round2(totalAmount).minus(round2(paidAmount));
  return remaining.isNegative() ? new Prisma.Decimal(0) : remaining;
}

export function round2(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
