import { DeliveryStatus, InventoryTxType, Prisma, Role } from '@prisma/client';
import { prisma } from '../prisma';
import { resolveRange, DateRangePreset, startOfLocalDay, endOfLocalDay, startOfLocalMonth, endOfLocalMonth } from '../common/utils/date';
import { serializeDelivery } from '../common/utils/serialize';
import { WAREHOUSE_KEY, workerKey } from '../inventory/inventory.service';
import { Actor } from '../users/users.service';

const D = (v: Prisma.Decimal | null | undefined) => Number((v ?? new Prisma.Decimal(0)).toFixed(2));

export interface RangeQuery {
  preset?: DateRangePreset;
  from?: string;
  to?: string;
}

/**
 * WORKER home screen. Every number is a live aggregate scoped to the caller's
 * own records - a worker can never read another worker's figures.
 */
export async function workerDashboard(actor: Actor) {
  const dayStart = startOfLocalDay();
  const dayEnd = endOfLocalDay();

  const [todayDelAgg, todayPayAgg, openDebts, myDebt, stock, myDeliveries] = await Promise.all([
    prisma.delivery.aggregate({
      where: { workerId: actor.id, deliveredAt: { gte: dayStart, lt: dayEnd }, status: { not: DeliveryStatus.CANCELLED } },
      _sum: { bottleCount: true, totalAmount: true },
      _count: { _all: true },
    }),
    prisma.payment.aggregate({
      where: { workerId: actor.id, voidedAt: null, paidAt: { gte: dayStart, lt: dayEnd } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.delivery.count({
      where: { workerId: actor.id, debtAmount: { gt: 0 }, status: { not: DeliveryStatus.CANCELLED } },
    }),
    prisma.delivery.aggregate({
      where: { workerId: actor.id, debtAmount: { gt: 0 }, status: { not: DeliveryStatus.CANCELLED } },
      _sum: { debtAmount: true },
    }),
    prisma.inventoryBalance.findUnique({ where: { key: workerKey(actor.id) }, select: { quantity: true } }),
    prisma.delivery.findMany({
      where: { workerId: actor.id },
      orderBy: { deliveredAt: 'desc' },
      take: 5,
      include: {
        customer: { select: { id: true, name: true, phone: true, address: true } },
        worker: { select: { id: true, fullName: true, username: true } },
      },
    }),
  ]);

  return {
    todayBottles: todayDelAgg._sum.bottleCount ?? 0,
    todayDeliveries: todayDelAgg._count._all,
    todayBilledAmount: D(todayDelAgg._sum.totalAmount),
    todayPayments: todayPayAgg._count._all,
    todayCollected: D(todayPayAgg._sum.amount),
    outstandingDeliveryCount: openDebts,
    outstandingDebt: D(myDebt._sum.debtAmount),
    stockInHand: stock?.quantity ?? 0,
    recentDeliveries: myDeliveries.map(serializeDelivery),
  };
}

/**
 * ADMIN dashboard.
 *
 * Critical distinction enforced here: `billed` (sum of delivery totals) and
 * `collected` (sum of non-voided payments) are separate numbers. Unpaid debt
 * is NEVER reported as revenue.
 */
export async function adminDashboard(query: RangeQuery) {
  const { start, end } = resolveRange(query.preset, query.from ? new Date(query.from) : null, query.to ? new Date(query.to) : null);
  const dayStart = startOfLocalDay();
  const dayEnd = endOfLocalDay();
  const monthStart = startOfLocalMonth();
  const monthEnd = endOfLocalMonth();

  const inRange = (field: 'deliveredAt' | 'paidAt' | 'occurredAt') =>
    start || end ? { [field]: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {};

  const [
    warehouse,
    workerBalances,
    todayInbound,
    todayIssued,
    todayDeliveredBottles,
    todayDamaged,
    todayLost,
    rangePayments,
    rangeBilled,
    todayPayments,
    monthPayments,
    totalDebtAgg,
    debtorCount,
    todayDeliveries,
    allTimeBottles,
    rangeDeliveries,
  ] = await Promise.all([
    prisma.inventoryBalance.findUnique({ where: { key: WAREHOUSE_KEY }, select: { quantity: true } }),
    prisma.inventoryBalance.aggregate({ where: { scope: 'WORKER' }, _sum: { quantity: true } }),
    prisma.inventoryTransaction.aggregate({
      where: { balanceKey: WAREHOUSE_KEY, type: InventoryTxType.INBOUND, occurredAt: { gte: dayStart, lt: dayEnd } },
      _sum: { bottleCount: true },
    }),
    prisma.inventoryTransaction.aggregate({
      where: { balanceKey: WAREHOUSE_KEY, type: InventoryTxType.ISSUE_TO_WORKER, occurredAt: { gte: dayStart, lt: dayEnd } },
      _sum: { bottleCount: true },
    }),
    prisma.delivery.aggregate({
      where: { deliveredAt: { gte: dayStart, lt: dayEnd }, status: { not: DeliveryStatus.CANCELLED } },
      _sum: { bottleCount: true },
    }),
    prisma.inventoryTransaction.aggregate({
      where: { type: InventoryTxType.DAMAGE, ...inRange('occurredAt') },
      _sum: { bottleCount: true },
    }),
    prisma.inventoryTransaction.aggregate({
      where: { type: InventoryTxType.LOSS, ...inRange('occurredAt') },
      _sum: { bottleCount: true },
    }),
    prisma.payment.aggregate({ where: { voidedAt: null, ...inRange('paidAt') }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.delivery.aggregate({ where: { status: { not: DeliveryStatus.CANCELLED }, ...inRange('deliveredAt') }, _sum: { totalAmount: true } }),
    prisma.payment.aggregate({ where: { voidedAt: null, paidAt: { gte: dayStart, lt: dayEnd } }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.payment.aggregate({ where: { voidedAt: null, paidAt: { gte: monthStart, lt: monthEnd } }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.delivery.aggregate({
      where: { debtAmount: { gt: 0 }, status: { not: DeliveryStatus.CANCELLED } },
      _sum: { debtAmount: true },
    }),
    prisma.delivery.groupBy({
      by: ['customerId'],
      where: { debtAmount: { gt: 0 }, status: { not: DeliveryStatus.CANCELLED } },
    }),
    prisma.delivery.count({ where: { deliveredAt: { gte: dayStart, lt: dayEnd }, status: { not: DeliveryStatus.CANCELLED } } }),
    prisma.delivery.aggregate({ where: { status: { not: DeliveryStatus.CANCELLED } }, _sum: { bottleCount: true } }),
    prisma.delivery.count({ where: { status: { not: DeliveryStatus.CANCELLED }, ...inRange('deliveredAt') } }),
  ]);

  return {
    range: { start: start?.toISOString() ?? null, end: end?.toISOString() ?? null, preset: query.preset ?? 'all' },
    inventory: {
      todayInbound: todayInbound._sum.bottleCount ?? 0,
      todayIssuedToWorkers: todayIssued._sum.bottleCount ?? 0,
      warehouseQuantity: warehouse?.quantity ?? 0,
      inWorkersHands: workerBalances._sum.quantity ?? 0,
      damagedInRange: todayDamaged._sum.bottleCount ?? 0,
      lostInRange: todayLost._sum.bottleCount ?? 0,
    },
    finance: {
      // Actual cash received in the selected range (revenue).
      collectedInRange: D(rangePayments._sum.amount),
      paymentsInRange: rangePayments._count._all,
      // Amount invoiced in the range - NOT revenue until it is actually paid.
      billedInRange: D(rangeBilled._sum.totalAmount),
      todayCollected: D(todayPayments._sum.amount),
      todayPayments: todayPayments._count._all,
      monthCollected: D(monthPayments._sum.amount),
      monthPayments: monthPayments._count._all,
      totalOutstandingDebt: D(totalDebtAgg._sum.debtAmount),
      debtorCustomers: debtorCount.length,
      undeliveredValueInRange: D(new Prisma.Decimal(rangeBilled._sum.totalAmount ?? 0).minus(rangePayments._sum.amount ?? 0)),
    },
    deliveries: {
      todayCount: todayDeliveries,
      todayBottles: todayDeliveredBottles._sum.bottleCount ?? 0,
      inRangeCount: rangeDeliveries,
      allTimeBottles: allTimeBottles._sum.bottleCount ?? 0,
    },
  };
}

/** Revenue broken down by payment method - used by the "Gəlirlər" screen. */
export async function revenueBreakdown(query: RangeQuery) {
  const { start, end } = resolveRange(query.preset, query.from ? new Date(query.from) : null, query.to ? new Date(query.to) : null);
  const paidAt = start || end ? { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } : {};

  const byMethod = await prisma.payment.groupBy({
    by: ['method'],
    where: { voidedAt: null, paidAt },
    _sum: { amount: true },
    _count: { _all: true },
  });

  const byWorker = await prisma.payment.groupBy({
    by: ['workerId'],
    where: { voidedAt: null, paidAt },
    _sum: { amount: true },
    _count: { _all: true },
  });

  const workers = await prisma.user.findMany({
    where: { id: { in: byWorker.map((b) => b.workerId) } },
    select: { id: true, fullName: true, username: true },
  });
  const nameOf = new Map(workers.map((w) => [w.id, w]));

  return {
    byMethod: byMethod.map((r) => ({
      method: r.method,
      amount: D(r._sum.amount),
      count: r._count._all,
    })),
    byWorker: byWorker
      .map((r) => ({
        workerId: r.workerId,
        workerName: nameOf.get(r.workerId)?.fullName ?? 'Bilinməyən',
        username: nameOf.get(r.workerId)?.username ?? null,
        amount: D(r._sum.amount),
        count: r._count._all,
      }))
      .sort((a, b) => b.amount - a.amount),
  };
}
