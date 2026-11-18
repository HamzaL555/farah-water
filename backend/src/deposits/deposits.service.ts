import { DepositTxType, Prisma, Role } from '@prisma/client';
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

export interface DepositInput {
  customerId: string;
  type: DepositTxType;
  /** Positive magnitude for IN/OUT; signed for ADJUSTMENT. */
  amount: number;
  /** Positive magnitude for IN/OUT; signed for ADJUSTMENT. */
  bottleCount: number;
  note?: string | null;
  occurredAt?: Date;
  idempotencyKey?: string;
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
    if (absAmount.lte(0)) throw badRequest('Qəbul edilən depozit məbləği sıfırdan böyük olmalıdır.');
    return { amount: absAmount, bottles: absBottles };
  }
  if (type === DepositTxType.DEPOSIT_OUT) {
    if (absAmount.lte(0)) throw badRequest('Qaytarılan depozit məbləği sıfırdan böyük olmalıdır.');
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

/** Current deposit state of one customer, read straight from the ledger. */
export async function getCustomerDepositSummary(customerId: string, tx?: Prisma.TransactionClient) {
  const db = tx ?? prisma;
  const agg = await db.customerDeposit.aggregate({
    where: { customerId },
    _sum: { amount: true, bottleCount: true },
    _count: { _all: true },
    _max: { occurredAt: true },
  });
  return {
    balance: moneyOut(agg._sum.amount ?? 0),
    bottleBalance: agg._sum.bottleCount ?? 0,
    movements: agg._count._all,
    lastMovementAt: agg._max.occurredAt ?? null,
  };
}

/** Deposit balances for a page of customers, keyed by customer id. */
export async function depositBalancesFor(customerIds: string[]) {
  if (customerIds.length === 0) return new Map<string, { balance: number; bottleBalance: number }>();
  const rows = await prisma.customerDeposit.groupBy({
    by: ['customerId'],
    where: { customerId: { in: customerIds } },
    _sum: { amount: true, bottleCount: true },
  });
  return new Map(
    rows.map((r) => [r.customerId, { balance: moneyOut(r._sum.amount ?? 0), bottleBalance: r._sum.bottleCount ?? 0 }]),
  );
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
  const delta = deltasFor(input.type, Number(input.amount), Number(input.bottleCount));
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
        `${customer.name}: ${sign}${moneyOut(row.amount).toFixed(2)} AZN, ` +
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
    ...(start || end ? { occurredAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
  };

  const [rows, total, totals] = await Promise.all([
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
  ]);

  return {
    ...paginate(rows.map((r) => serializeDeposit(r as never)), total, page, pageSize),
    totals: {
      amount: moneyOut(totals._sum.amount ?? 0),
      bottleCount: totals._sum.bottleCount ?? 0,
    },
  };
}
