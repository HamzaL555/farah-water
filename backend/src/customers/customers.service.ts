import { DeliveryStatus, Prisma, Role } from '@prisma/client';
import { prisma } from '../prisma';
import { badRequest, notFound } from '../common/utils/errors';
import { audit } from '../common/utils/audit';
import { paginate, serializeCustomer, serializeDelivery, serializeDeposit } from '../common/utils/serialize';
import { resolveRange, DateRangePreset } from '../common/utils/date';
import { depositBalancesFor, getCustomerDepositSummary } from '../deposits/deposits.service';
import { Actor } from '../users/users.service';

export interface CreateCustomerInput {
  name: string;
  address: string;
  phone?: string | null;
  note?: string | null;
}

export async function createCustomer(input: CreateCustomerInput, actor: Actor, req?: never) {
  const name = input.name?.trim();
  const address = input.address?.trim();
  if (!name) throw badRequest('Müştərinin adı tələb olunur.');
  if (!address) throw badRequest('Ünvan tələb olunur.');

  // Reuse an existing record for the same person at the same address rather
  // than creating endless duplicates from repeated deliveries.
  const existing = await prisma.customer.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, address: { equals: address, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) {
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: existing.id } });
    return { customer: serializeCustomer(customer), created: false };
  }

  const customer = await prisma.customer.create({
    data: { name, address, phone: input.phone?.trim() || null, note: input.note?.trim() || null },
  });

  await audit({
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'customer.created',
    entityType: 'customer',
    entityId: customer.id,
    after: serializeCustomer(customer),
    req,
  });

  return { customer: serializeCustomer(customer), created: true };
}

export async function listCustomers(
  query: { search?: string; onlyDebtors?: boolean; preset?: DateRangePreset; from?: string; to?: string; page?: number; pageSize?: number },
  actor: Actor,
) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));
  const { start, end } = resolveRange(query.preset, query.from ? new Date(query.from) : null, query.to ? new Date(query.to) : null);

  const where: Prisma.CustomerWhereInput = {
    isActive: true,
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { address: { contains: query.search, mode: 'insensitive' } },
            { phone: { contains: query.search } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where,
      orderBy: { name: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return paginate([], total, page, pageSize);

  // Stats are scoped: a worker only sees money/debt from their own deliveries.
  const scoped: Prisma.DeliveryWhereInput = {
    customerId: { in: ids },
    status: { not: DeliveryStatus.CANCELLED },
    ...(actor.role === Role.ADMIN ? {} : { workerId: actor.id }),
    ...(start || end ? { deliveredAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
  };

  const [groups, bottles] = await Promise.all([
    prisma.delivery.groupBy({
      by: ['customerId'],
      where: scoped,
      _sum: { debtAmount: true, totalAmount: true },
      _count: { _all: true },
    }),
    prisma.delivery.groupBy({
      by: ['customerId'],
      where: scoped,
      _sum: { bottleCount: true },
    }),
  ]);

  const debtMap = new Map(groups.map((g) => [g.customerId, g]));
  const bottleMap = new Map(bottles.map((g) => [g.customerId, g]));
  // Deposit balances are admin-only money, and only for the page in view.
  const depositMap = actor.role === Role.ADMIN ? await depositBalancesFor(ids) : new Map();

  let items = rows.map((r) => {
    const g = debtMap.get(r.id);
    const b = bottleMap.get(r.id);
    const dep = depositMap.get(r.id);
    return {
      ...serializeCustomer({
        ...r,
        _count: { deliveries: g?._count._all ?? 0 },
        totalDebt: g?._sum.debtAmount ?? new Prisma.Decimal(0),
        totalDelivered: g?._sum.totalAmount ?? new Prisma.Decimal(0),
        totalBottles: b?._sum.bottleCount ?? 0,
      }),
      depositBalance: dep?.balance ?? 0,
      depositBottleBalance: dep?.bottleBalance ?? 0,
    };
  });

  if (query.onlyDebtors) items = items.filter((i) => i.totalDebt > 0);

  return paginate(items, total, page, pageSize);
}

export async function getCustomerDetail(id: string, actor: Actor) {
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) throw notFound('Müştəri tapılmadı.');

  const deliveryWhere: Prisma.DeliveryWhereInput = {
    customerId: id,
    status: { not: DeliveryStatus.CANCELLED },
    ...(actor.role === Role.ADMIN ? {} : { workerId: actor.id }),
  };

  const [agg, deliveries] = await Promise.all([
    prisma.delivery.aggregate({
      where: deliveryWhere,
      _sum: { totalAmount: true, paidAmount: true, debtAmount: true, bottleCount: true },
      _count: { _all: true },
    }),
    prisma.delivery.findMany({
      where: deliveryWhere,
      orderBy: { deliveredAt: 'desc' },
      take: 50,
      include: {
        worker: { select: { id: true, fullName: true, username: true } },
      },
    }),
  ]);

  const base = {
    ...serializeCustomer({
      ...customer,
      _count: { deliveries: agg._count._all },
      totalDebt: agg._sum.debtAmount ?? new Prisma.Decimal(0),
      totalDelivered: agg._sum.totalAmount ?? new Prisma.Decimal(0),
      totalBottles: agg._sum.bottleCount ?? 0,
    }),
    deliveryCount: agg._count._all,
    totalPaid: Number((agg._sum.paidAmount ?? new Prisma.Decimal(0)).toFixed(2)),
    deliveries: deliveries.map(serializeDelivery),
  };

  // Deposit money and the deposit ledger are shown to the admin only. A worker
  // still sees the customer's phone/address for the delivery, nothing more.
  if (actor.role !== Role.ADMIN) return base;

  const [depositSummary, depositRows] = await Promise.all([
    getCustomerDepositSummary(id),
    prisma.customerDeposit.findMany({
      where: { customerId: id },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      include: { createdBy: { select: { id: true, fullName: true } } },
    }),
  ]);

  return {
    ...base,
    depositBalance: depositSummary.balance,
    depositBottleBalance: depositSummary.bottleBalance,
    depositMovements: depositSummary.movements,
    deposits: depositRows.map((r) => serializeDeposit(r as never)),
  };
}

export async function updateCustomer(
  id: string,
  patch: { name?: string; address?: string; phone?: string | null; note?: string | null; isActive?: boolean },
  actor: Actor,
  req?: never,
) {
  const before = await prisma.customer.findUnique({ where: { id } });
  if (!before) throw notFound('Müştəri tapılmadı.');

  // Renaming/re-addressing would rewrite history on past deliveries, so only
  // contact details and the active flag are editable.
  const data: Prisma.CustomerUpdateInput = {};
  if (patch.phone !== undefined) data.phone = patch.phone?.trim() || null;
  if (patch.note !== undefined) data.note = patch.note?.trim() || null;
  if (patch.isActive !== undefined) data.isActive = patch.isActive;

  const customer = await prisma.customer.update({ where: { id }, data });

  await audit({
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'customer.updated',
    entityType: 'customer',
    entityId: id,
    before: serializeCustomer(before),
    after: serializeCustomer(customer),
    meta: { changes: Object.keys(patch) },
    req,
  });

  return serializeCustomer(customer);
}
