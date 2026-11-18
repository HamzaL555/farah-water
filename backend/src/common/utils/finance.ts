import { Prisma, WaterType } from '@prisma/client';
import { prisma } from '../../prisma';
import { moneyOut } from './money';

/**
 * Revenue split by water type.
 *
 * Revenue is ONLY money that actually arrived: non-voided payment rows. A
 * delivery's invoiced total is never counted here, and a customer deposit is
 * held money - it is deliberately absent from every revenue figure.
 */
export async function revenueByWater(start: Date | null, end: Date | null, workerId?: string | null) {
  const where: Prisma.PaymentWhereInput = {
    voidedAt: null,
    ...(workerId ? { workerId } : {}),
    ...(start || end ? { paidAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
  };

  const grouped = await prisma.payment.groupBy({
    by: ['deliveryId'],
    where,
    _sum: { amount: true },
    _count: { _all: true },
  });

  if (grouped.length === 0) {
    return { filtered: 0, spring: 0, total: 0, payments: 0 };
  }

  const deliveries = await prisma.delivery.findMany({
    where: { id: { in: grouped.map((g) => g.deliveryId) } },
    select: { id: true, waterType: true },
  });
  const typeOf = new Map(deliveries.map((d) => [d.id, d.waterType]));

  let filtered = new Prisma.Decimal(0);
  let spring = new Prisma.Decimal(0);
  let payments = 0;
  for (const row of grouped) {
    const amount = row._sum.amount ?? new Prisma.Decimal(0);
    payments += row._count._all;
    if (typeOf.get(row.deliveryId) === WaterType.SPRING) spring = spring.add(amount);
    else filtered = filtered.add(amount);
  }

  return {
    filtered: moneyOut(filtered),
    spring: moneyOut(spring),
    total: moneyOut(filtered.add(spring)),
    payments,
  };
}

export interface ProfitSummary {
  revenue: { filtered: number; spring: number; total: number; payments: number };
  expenses: { filtered: number; spring: number; shared: number; total: number };
  profit: { filtered: number; spring: number; total: number };
}

/**
 * Revenue, expenses and profit for a range.
 *
 * `profit.filtered`/`profit.spring` subtract only expenses booked against that
 * water type. Shared expenses (no waterType) are subtracted from the overall
 * total only, because inventing a split would be a guess.
 */
export async function profitSummary(start: Date | null, end: Date | null): Promise<ProfitSummary> {
  const [revenue, expenseRows] = await Promise.all([
    revenueByWater(start, end),
    prisma.expense.groupBy({
      by: ['waterType'],
      where: {
        voidedAt: null,
        ...(start || end ? { spentAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
      },
      _sum: { amount: true },
    }),
  ]);

  const pick = (wt: WaterType | null) => moneyOut(expenseRows.find((r) => r.waterType === wt)?._sum.amount ?? 0);
  const expenses = {
    filtered: pick(WaterType.FILTERED),
    spring: pick(WaterType.SPRING),
    shared: pick(null),
    total: 0,
  };
  expenses.total = moneyOut(expenses.filtered + expenses.spring + expenses.shared);

  return {
    revenue,
    expenses,
    profit: {
      filtered: moneyOut(revenue.filtered - expenses.filtered),
      spring: moneyOut(revenue.spring - expenses.spring),
      total: moneyOut(revenue.total - expenses.total),
    },
  };
}
