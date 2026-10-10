import { DebtAdjustmentType, DeliveryStatus, Prisma, Role } from '@prisma/client';
import { prisma } from '../prisma';
import { badRequest, forbidden, notFound } from '../common/utils/errors';
import { round2 } from '../common/utils/status';
import { audit } from '../common/utils/audit';
import { paginate, serializeDebtAdjustment, serializeDelivery } from '../common/utils/serialize';
import { resolveRange, DateRangePreset } from '../common/utils/date';
import { recalcDelivery, Actor } from '../deliveries/delivery.service';

export interface CreateAdjustmentInput {
  deliveryId: string;
  type: DebtAdjustmentType;
  amount: string | number;
  reason: string;
}

/**
 * A debt adjustment (güzəşti / artırma) is deliberately NOT a payment.
 *
 * Rule: waived debt must never inflate revenue. Only rows in `payments` count
 * toward income; adjustments only change what is *owed*, which keeps reported
 * cash and reported revenue honest.
 */
export async function createAdjustment(input: CreateAdjustmentInput, actor: Actor, req?: never) {
  if (actor.role !== Role.ADMIN) {
    throw forbidden('Borc düzəlişini yalnız administrator edə bilər.');
  }
  if (!input.reason?.trim()) throw badRequest('Düzəliş səbəbi yazılmalıdır.');

  const amount = round2(new Prisma.Decimal(input.amount ?? 0));
  if (!amount.greaterThan(0)) throw badRequest('Məbləğ sıfırdan böyük olmalıdır.');

  const delivery = await prisma.delivery.findUnique({ where: { id: input.deliveryId } });
  if (!delivery) throw notFound('Çatdırılma tapılmadı.');
  if (delivery.status === DeliveryStatus.CANCELLED) throw badRequest('Ləğv edilmiş çatdırılmaya düzəliş edilə bilməz.');

  // An adjustment may never push the delivery's debt below zero.
  if (input.type !== DebtAdjustmentType.INCREASE) {
    const outstanding = delivery.totalAmount.minus(delivery.paidAmount);
    if (amount.greaterThan(outstanding)) {
      throw badRequest(
        `Bu çatdırılmanın qalan borcu ${outstanding.toFixed(2)} AZN-dir. Bundan artıq güzəşt tətbiq edilə bilməz.`,
      );
    }
  }

  const adjustment = await prisma.$transaction(async (tx) => {
    const created = await tx.debtAdjustment.create({
      data: {
        deliveryId: delivery.id,
        type: input.type,
        amount,
        reason: input.reason.trim(),
        createdById: actor.id,
      },
      include: { createdBy: { select: { id: true, fullName: true } } },
    });
    await recalcDelivery(tx, delivery.id);
    return created;
  });

  await audit({
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'debt.adjusted',
    entityType: 'debt_adjustment',
    entityId: adjustment.id,
    after: serializeDebtAdjustment(adjustment),
    meta: { deliveryId: delivery.id, type: input.type, amount: amount.toFixed(2), reason: input.reason },
    req,
  });

  return adjustment;
}

export async function listAdjustments(deliveryId: string, actor: Actor) {
  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    select: { id: true, workerId: true },
  });
  if (!delivery) throw notFound('Çatdırılma tapılmadı.');
  if (actor.role !== Role.ADMIN && delivery.workerId !== actor.id) {
    throw forbidden('Bu çatdırılma sizin hesabınıza aid deyil.');
  }
  const rows = await prisma.debtAdjustment.findMany({
    where: { deliveryId },
    orderBy: { createdAt: 'desc' },
    include: { createdBy: { select: { id: true, fullName: true } } },
  });
  return rows.map(serializeDebtAdjustment);
}

export interface ListDebtsQuery {
  workerId?: string;
  customerId?: string;
  status?: DeliveryStatus;
  search?: string;
  preset?: DateRangePreset;
  from?: string;
  to?: string;
  minAmount?: number;
  page?: number;
  pageSize?: number;
}

/** Outstanding-debt ledger. Workers only ever see their own customers' debts. */
export async function listDebts(query: ListDebtsQuery, actor: Actor) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));
  const { start, end } = resolveRange(query.preset, query.from ? new Date(query.from) : null, query.to ? new Date(query.to) : null);

  const effectiveWorkerId = actor.role === Role.ADMIN ? query.workerId : actor.id;

  const where: Prisma.DeliveryWhereInput = {
    debtAmount: { gt: 0 },
    status: { not: DeliveryStatus.CANCELLED },
    ...(effectiveWorkerId ? { workerId: effectiveWorkerId } : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.minAmount ? { debtAmount: { gte: query.minAmount } } : {}),
    ...(start || end ? { deliveredAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
    ...(query.search
      ? {
          OR: [
            { customer: { name: { contains: query.search, mode: 'insensitive' } } },
            { address: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [rows, total, sum] = await Promise.all([
    prisma.delivery.findMany({
      where,
      orderBy: [{ debtAmount: 'desc' }, { deliveredAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        customer: { select: { id: true, name: true, phone: true, address: true } },
        worker: { select: { id: true, fullName: true, username: true } },
      },
    }),
    prisma.delivery.count({ where }),
    prisma.delivery.aggregate({ where, _sum: { debtAmount: true } }),
  ]);

  return {
    ...paginate(rows.map(serializeDelivery), total, page, pageSize),
    totalDebt: Number((sum._sum.debtAmount ?? new Prisma.Decimal(0)).toFixed(2)),
  };
}

/** Per-customer debt rollup used by the admin "Borclar" screen. */
export async function debtSummaryByCustomer(query: ListDebtsQuery, actor: Actor) {
  const effectiveWorkerId = actor.role === Role.ADMIN ? query.workerId : actor.id;
  const { start, end } = resolveRange(query.preset, query.from ? new Date(query.from) : null, query.to ? new Date(query.to) : null);

  const where: Prisma.DeliveryWhereInput = {
    debtAmount: { gt: 0 },
    status: { not: DeliveryStatus.CANCELLED },
    ...(effectiveWorkerId ? { workerId: effectiveWorkerId } : {}),
    ...(start || end ? { deliveredAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
    ...(query.search ? { customer: { name: { contains: query.search, mode: 'insensitive' } } } : {}),
  };

  const grouped = await prisma.delivery.groupBy({
    by: ['customerId'],
    where,
    _sum: { debtAmount: true, totalAmount: true, paidAmount: true },
    _count: { _all: true },
  });

  const customers = await prisma.customer.findMany({
    where: { id: { in: grouped.map((g) => g.customerId) } },
    select: { id: true, name: true, phone: true, address: true },
  });
  const byId = new Map(customers.map((c) => [c.id, c]));

  return grouped
    .map((g) => ({
      customerId: g.customerId,
      customerName: byId.get(g.customerId)?.name ?? 'Bilinməyən',
      phone: byId.get(g.customerId)?.phone ?? null,
      address: byId.get(g.customerId)?.address ?? null,
      deliveryCount: g._count._all,
      totalAmount: Number((g._sum.totalAmount ?? new Prisma.Decimal(0)).toFixed(2)),
      paidAmount: Number((g._sum.paidAmount ?? new Prisma.Decimal(0)).toFixed(2)),
      debtAmount: Number((g._sum.debtAmount ?? new Prisma.Decimal(0)).toFixed(2)),
    }))
    .sort((a, b) => b.debtAmount - a.debtAmount);
}
