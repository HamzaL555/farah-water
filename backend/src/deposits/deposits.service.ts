import { DepositTxType, Prisma, Role, WaterType } from '@prisma/client';
import { prisma } from '../prisma';
import { badRequest, forbidden, notFound } from '../common/utils/errors';
import { audit } from '../common/utils/audit';
import { paginate, serializeDeposit } from '../common/utils/serialize';
import { resolveRange, DateRangePreset } from '../common/utils/date';
import { money, moneyOut, round2 } from '../common/utils/money';
import { newIdempotencyKey } from '../auth/tokens';
import { createNotification } from '../notifications/notification.service';
import type { Actor } from '../deliveries/delivery.service';

const DEPOSIT_LABEL: Record<DepositTxType, string> = {
  DEPOSIT_IN: 'Depozit qəbul edildi',
  DEPOSIT_OUT: 'Depozit geri qaytarıldı',
  ADJUSTMENT: 'Depozit düzəlişi',
};

const WATER_LABEL: Record<WaterType, string> = {
  FILTERED: 'Filtr',
  SPRING: 'Bulaq',
};

export interface DepositInput {
  customerId: string;
  type: DepositTxType;
  /** Bulaq and Filtr deposits are separate accounts. Defaults to FILTERED. */
  waterType?: WaterType;
  /** Positive magnitude for IN/OUT; signed for ADJUSTMENT. Omit to price from settings. */
  amount?: number;
  /** Positive magnitude for IN/OUT; signed for ADJUSTMENT. */
  bottleCount: number;
  note?: string | null;
  occurredAt?: Date;
  idempotencyKey?: string;
}

/** Configured deposit price per bottle, in AZN, per water type. */
export interface DepositPrices {
  FILTERED: number;
  SPRING: number;
}

const DEPOSIT_PRICE_KEY = 'depositPrice';

export async function getDepositPrices(): Promise<DepositPrices> {
  const row = await prisma.appSetting.findUnique({ where: { key: DEPOSIT_PRICE_KEY } });
  const v = (row?.value ?? {}) as Record<string, unknown>;
  return {
    FILTERED: Number(v.FILTERED) || 0,
    SPRING: Number(v.SPRING) || 0,
  };
}

/** Admin-only: how much one bottle's deposit is, per water type. */
export async function setDepositPrices(input: DepositPrices, actor: Actor, req?: never) {
  if (actor.role !== Role.ADMIN) {
    throw forbidden('Depozit qiymətini yalnız administrator dəyişə bilər.');
  }
  const before = await getDepositPrices();
  const value = {
    FILTERED: round2(input.FILTERED).toNumber(),
    SPRING: round2(input.SPRING).toNumber(),
  };
  await prisma.appSetting.upsert({
    where: { key: DEPOSIT_PRICE_KEY },
    create: { key: DEPOSIT_PRICE_KEY, value, updatedById: actor.id },
    update: { value, updatedById: actor.id },
  });
  await audit({
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'deposit.prices.updated',
    entityType: 'app_setting',
    entityId: DEPOSIT_PRICE_KEY,
    before,
    after: value,
    req,
  });
  return value;
}

/**
 * Retries a SERIALIZABLE transaction when Postgres reports a write conflict.
 * Two admins recording a deposit for the same customer at the same moment must
 * serialize, not both apply their delta to the same "before" balance.
 */
async function runSerializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (err) {
      lastError = err;
      const code = (err as { code?: string })?.code;
      // P2034 = transaction conflict / deadlock, P2028 = transaction API error
      if (code !== 'P2034' && code !== 'P2028') throw err;
    }
  }
  throw lastError;
}

/** The signed deltas that one ledger row applies. */
function deltasFor(type: DepositTxType, amount: number, bottleCount: number) {
  const absAmount = round2(Math.abs(amount));
  const absBottles = Math.abs(Math.trunc(bottleCount));
  if (type === DepositTxType.DEPOSIT_IN) {
    // A deposit-free bottle handover is legitimate: bottles can be tracked
    // with zero money when the company charges no deposit.
    if (absAmount.lte(0) && absBottles === 0) {
      throw badRequest('Qəbul edilən depozit məbləği və ya bidon sayı qeyd edilməlidir.');
    }
    return { amount: absAmount, bottles: absBottles };
  }
  if (type === DepositTxType.DEPOSIT_OUT) {
    if (absAmount.lte(0) && absBottles === 0) {
      throw badRequest('Qaytarılan depozit məbləği və ya bidon sayı qeyd edilməlidir.');
    }
    return { amount: absAmount.neg(), bottles: -absBottles };
  }
  // ADJUSTMENT: keep the caller's sign, but never allow a zero row.
  const signedAmount = round2(amount);
  const signedBottles = Math.trunc(bottleCount);
  if (signedAmount.isZero() && signedBottles === 0) {
    throw badRequest('Düzəliş məbləği və ya bidon sayı qeyd edilməlidir.');
  }
  return { amount: signedAmount, bottles: signedBottles };
}

type DepositBucket = { balance: number; bottleBalance: number };

/** Per-water-type deposit state of one customer. */
export async function getCustomerDepositByType(customerId: string, tx?: Prisma.TransactionClient) {
  const db = tx ?? prisma;
  const rows = await db.customerDeposit.groupBy({
    by: ['waterType'],
    where: { customerId },
    _sum: { amount: true, bottleCount: true },
  });
  const out: Record<string, DepositBucket> = {
    FILTERED: { balance: 0, bottleBalance: 0 },
    SPRING: { balance: 0, bottleBalance: 0 },
  };
  for (const r of rows) {
    out[r.waterType] = {
      balance: moneyOut(r._sum.amount ?? 0),
      bottleBalance: r._sum.bottleCount ?? 0,
    };
  }
  return out;
}

/** Current deposit state of one customer, read straight from the ledger. */
export async function getCustomerDepositSummary(customerId: string, tx?: Prisma.TransactionClient) {
  const db = tx ?? prisma;
  const agg = await db.customerDeposit.aggregate({
    where: { customerId },
    _sum: { amount: true, bottleCount: true },
    _count: { _all: true },
    _max: { occurredAt: true },
  });
  const byType = await getCustomerDepositByType(customerId, tx);
  return {
    balance: moneyOut(agg._sum.amount ?? 0),
    bottleBalance: agg._sum.bottleCount ?? 0,
    movements: agg._count._all,
    lastMovementAt: agg._max.occurredAt ?? null,
    byType,
  };
}

/** Deposit balances for a page of customers, keyed by customer id. */
export async function depositBalancesFor(customerIds: string[]) {
  if (customerIds.length === 0) return new Map<string, { balance: number; bottleBalance: number; byType: Record<string, DepositBucket> }>();
  const rows = await prisma.customerDeposit.groupBy({
    by: ['customerId', 'waterType'],
    where: { customerId: { in: customerIds } },
    _sum: { amount: true, bottleCount: true },
  });
  const map = new Map<string, { balance: number; bottleBalance: number; byType: Record<string, DepositBucket> }>();
  for (const id of customerIds) {
    map.set(id, {
      balance: 0,
      bottleBalance: 0,
      byType: {
        FILTERED: { balance: 0, bottleBalance: 0 },
        SPRING: { balance: 0, bottleBalance: 0 },
      },
    });
  }
  for (const r of rows) {
    const entry = map.get(r.customerId)!;
    const bucket = {
      balance: moneyOut(r._sum.amount ?? 0),
      bottleBalance: r._sum.bottleCount ?? 0,
    };
    entry.byType[r.waterType] = bucket;
    entry.balance = moneyOut(round2(entry.balance).add(bucket.balance));
    entry.bottleBalance += bucket.bottleBalance;
  }
  return map;
}

/**
 * Records one deposit movement (deposit taken, deposit refunded, or a signed
 * correction). Admin only: a worker never handles customer money.
 *
 * The running balance is computed inside a SERIALIZABLE transaction and the
 * new row stores the resulting balances, so the history can be read forwards
 * without replaying it. A refund can never take the balance below zero.
 */
export async function createDepositTx(input: DepositInput, actor: Actor, req?: never) {
  if (actor.role !== Role.ADMIN) {
    throw forbidden('Depozit əməliyyatlarını yalnız administrator aparır.');
  }

  const idempotencyKey = input.idempotencyKey ?? newIdempotencyKey();
  const waterType = input.waterType ?? WaterType.FILTERED;
  const bottleCount = Number(input.bottleCount) || 0;
  let resolvedAmount = input.amount === undefined ? undefined : Number(input.amount);
  // No amount typed: price the bottles from the configured deposit price.
  if (resolvedAmount === undefined) {
    const prices = await getDepositPrices();
    resolvedAmount = round2(prices[waterType] * Math.abs(bottleCount)).toNumber();
  }
  const delta = deltasFor(input.type, resolvedAmount, bottleCount);
  const occurredAt = input.occurredAt ?? new Date();

  const customer = await prisma.customer.findUnique({
    where: { id: input.customerId },
    select: { id: true, name: true, phone: true },
  });
  if (!customer) throw notFound('Müştəri tapılmadı.');

  const outcome = await runSerializable(async (tx) => {
    const existing = await tx.customerDeposit.findUnique({
      where: { idempotencyKey },
      include: { customer: { select: { id: true, name: true, phone: true } }, createdBy: { select: { id: true, fullName: true } } },
    });
    if (existing) {
      return { duplicate: true as const, row: existing, before: null, after: null };
    }

    const agg = await tx.customerDeposit.aggregate({
      where: { customerId: customer.id },
      _sum: { amount: true, bottleCount: true },
    });
    const beforeAmount = money(agg._sum.amount ?? 0);
    const beforeBottles = agg._sum.bottleCount ?? 0;

    // Per-water-type guard: returning more Bulaq bottles than the customer
    // received cannot be covered by their Filtr balance.
    const typeAgg = await tx.customerDeposit.aggregate({
      where: { customerId: customer.id, waterType },
      _sum: { bottleCount: true },
    });
    const beforeTypeBottles = typeAgg._sum.bottleCount ?? 0;
    const afterTypeBottles = beforeTypeBottles + delta.bottles;
    if (afterTypeBottles < 0) {
      throw badRequest(
        `${WATER_LABEL[waterType]} depozitində müştəridə ${beforeTypeBottles} bidon var; ` +
          `${Math.abs(delta.bottles)} ədəd qaytarmaq mümkün deyil.`,
      );
    }

    const afterAmount = round2(beforeAmount.add(delta.amount));
    const afterBottles = beforeBottles + delta.bottles;

    if (afterAmount.isNegative()) {
      throw badRequest(
        `Depozit balansı mənfi ola bilməz. Mövcud balans: ${moneyOut(beforeAmount).toFixed(2)} AZN.`,
      );
    }
    if (afterBottles < 0) {
      throw badRequest(`Müştəridə ${beforeBottles} bidon var; ${Math.abs(delta.bottles)} ədəd qaytarmaq mümkün deyil.`);
    }

    const row = await tx.customerDeposit.create({
      data: {
        idempotencyKey,
        customerId: customer.id,
        type: input.type,
        waterType,
        amount: delta.amount,
        bottleCount: delta.bottles,
        balanceAfter: afterAmount,
        bottleBalanceAfter: afterBottles,
        note: input.note?.trim() || null,
        occurredAt,
        createdById: actor.id,
      },
      include: { customer: { select: { id: true, name: true, phone: true } }, createdBy: { select: { id: true, fullName: true } } },
    });

    return { duplicate: false as const, row, before: { amount: beforeAmount, bottles: beforeBottles }, after: { amount: afterAmount, bottles: afterBottles } };
  });

  if (!outcome.duplicate) {
    const { row } = outcome;
    const sign = row.amount.isNegative() ? '' : '+';
    await createNotification({
      actorId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.role,
      kind: 'DEPOSIT',
      action: input.type,
      title: DEPOSIT_LABEL[input.type],
      message:
        `${WATER_LABEL[waterType]} · ${customer.name}: ${sign}${moneyOut(row.amount).toFixed(2)} AZN, ` +
        `${row.bottleCount >= 0 ? '+' : ''}${row.bottleCount} bidon. ` +
        `Yeni balans: ${moneyOut(row.balanceAfter).toFixed(2)} AZN / ${row.bottleBalanceAfter} bidon.`,
      bottleCount: Math.abs(row.bottleCount),
      note: row.note,
      relatedId: row.id,
    });

    await audit({
      actorId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.role,
      action: `deposit.${input.type.toLowerCase()}`,
      entityType: 'customer_deposit',
      entityId: row.id,
      meta: {
        customerId: customer.id,
        customerName: customer.name,
        amount: moneyOut(row.amount),
        bottleCount: row.bottleCount,
        balanceBefore: moneyOut(outcome.before!.amount),
        balanceAfter: moneyOut(row.balanceAfter),
        bottleBalanceBefore: outcome.before!.bottles,
        bottleBalanceAfter: row.bottleBalanceAfter,
        note: row.note,
      },
      req,
    });
  }

  return {
    deposit: serializeDeposit(outcome.row as never),
    duplicate: outcome.duplicate,
    balance: moneyOut(outcome.row.balanceAfter),
    bottleBalance: outcome.row.bottleBalanceAfter,
  };
}

export interface ListDepositsQuery {
  customerId?: string;
  type?: DepositTxType;
  waterType?: WaterType;
  preset?: DateRangePreset;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/** Full deposit history. Admin-only, like every other money view. */
export async function listDeposits(query: ListDepositsQuery, actor: Actor) {
  if (actor.role !== Role.ADMIN) {
    throw forbidden('Depozit tarixçəsini yalnız administrator görə bilər.');
  }

  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));
  const { start, end } = resolveRange(
    query.preset,
    query.from ? new Date(query.from) : null,
    query.to ? new Date(query.to) : null,
  );

  const where: Prisma.CustomerDepositWhereInput = {
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.waterType ? { waterType: query.waterType } : {}),
    ...(start || end ? { occurredAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
  };

  const [rows, total, totals, byTypeRows] = await Promise.all([
    prisma.customerDeposit.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
    }),
    prisma.customerDeposit.count({ where }),
    prisma.customerDeposit.aggregate({ where, _sum: { amount: true, bottleCount: true } }),
    prisma.customerDeposit.groupBy({
      by: ['waterType'],
      where,
      _sum: { amount: true, bottleCount: true },
    }),
  ]);

  const byType: Record<string, { amount: number; bottleCount: number }> = {
    FILTERED: { amount: 0, bottleCount: 0 },
    SPRING: { amount: 0, bottleCount: 0 },
  };
  for (const r of byTypeRows) {
    byType[r.waterType] = {
      amount: moneyOut(r._sum.amount ?? 0),
      bottleCount: r._sum.bottleCount ?? 0,
    };
  }

  return {
    ...paginate(rows.map((r) => serializeDeposit(r as never)), total, page, pageSize),
    totals: {
      amount: moneyOut(totals._sum.amount ?? 0),
      bottleCount: totals._sum.bottleCount ?? 0,
      byType,
    },
  };
}
