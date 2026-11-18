import { ExpenseCategory, Prisma, Role, WaterType } from '@prisma/client';
import { prisma } from '../prisma';
import { badRequest, conflict, forbidden, notFound } from '../common/utils/errors';
import { audit } from '../common/utils/audit';
import { paginate, serializeExpense } from '../common/utils/serialize';
import { resolveRange, DateRangePreset } from '../common/utils/date';
import { money, moneyOut, round2 } from '../common/utils/money';
import { newIdempotencyKey } from '../auth/tokens';
import { createNotification } from '../notifications/notification.service';
import type { Actor } from '../deliveries/delivery.service';

const CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  FUEL: 'Yanacaq',
  SALARY: 'Əmək haqqı',
  MAINTENANCE: 'Təmir',
  RENT: 'İcarə',
  UTILITIES: 'Kommunal',
  SUPPLIES: 'Ləvazimat',
  TRANSPORT: 'Nəqliyyat',
  OTHER: 'Digər',
};

const WATER_LABEL: Record<WaterType, string> = {
  FILTERED: 'Filtr suyu',
  SPRING: 'Bulaq suyu',
};

export interface CreateExpenseInput {
  category: ExpenseCategory;
  waterType?: WaterType | null;
  amount: number | string;
  spentAt?: Date;
  note?: string | null;
  idempotencyKey?: string;
}

/**
 * Records a company expense. Admin only: expenses reduce profit, so a worker
 * must never be able to book one. `waterType` is optional; when set, the cost
 * is subtracted from that water type's profit only.
 */
export async function createExpense(input: CreateExpenseInput, actor: Actor, req?: never) {
  if (actor.role !== Role.ADMIN) {
    throw forbidden('Xərci yalnız administrator qeyd edə bilər.');
  }
  const amount = round2(money(input.amount));
  if (amount.lte(0)) throw badRequest('Xərc məbləği sıfırdan böyük olmalıdır.');

  const idempotencyKey = input.idempotencyKey ?? newIdempotencyKey();

  const existing = await prisma.expense.findUnique({
    where: { idempotencyKey },
    include: { createdBy: { select: { id: true, fullName: true } } },
  });
  if (existing) {
    return { expense: serializeExpense(existing as never), duplicate: true };
  }

  const expense = await prisma.expense.create({
    data: {
      idempotencyKey,
      category: input.category,
      waterType: input.waterType ?? null,
      amount,
      spentAt: input.spentAt ?? new Date(),
      note: input.note?.trim() || null,
      createdById: actor.id,
    },
    include: { createdBy: { select: { id: true, fullName: true } } },
  });

  await createNotification({
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    kind: 'EXPENSE',
    action: 'EXPENSE_ADDED',
    title: 'Yeni xərc qeydə alındı',
    message:
      `${CATEGORY_LABEL[expense.category]}: ${moneyOut(amount).toFixed(2)} AZN` +
      (expense.waterType ? ` (${WATER_LABEL[expense.waterType]})` : ' (ümumi)') +
      '.',
    note: expense.note,
    relatedId: expense.id,
  });

  await audit({
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'expense.created',
    entityType: 'expense',
    entityId: expense.id,
    after: {
      category: expense.category,
      waterType: expense.waterType,
      amount: moneyOut(amount),
      spentAt: expense.spentAt,
      note: expense.note,
    },
    req,
  });

  return { expense: serializeExpense(expense as never), duplicate: false };
}

/** Voids a wrong expense. The row stays for the audit trail. */
export async function voidExpense(expenseId: string, reason: string, actor: Actor, req?: never) {
  if (actor.role !== Role.ADMIN) {
    throw forbidden('Xərci yalnız administrator ləğv edə bilər.');
  }
  if (!reason?.trim()) throw badRequest('Ləğv səbəbi yazılmalıdır.');

  const updated = await prisma.$transaction(async (tx) => {
    const expense = await tx.expense.findUnique({ where: { id: expenseId } });
    if (!expense) throw notFound('Xərc tapılmadı.');
    if (expense.voidedAt) throw conflict('Bu xərc artıq ləğv edilib.');

    return tx.expense.update({
      where: { id: expenseId },
      data: { voidedAt: new Date(), voidedById: actor.id, voidReason: reason.trim() },
      include: { createdBy: { select: { id: true, fullName: true } } },
    });
  });

  await createNotification({
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    kind: 'EXPENSE',
    action: 'EXPENSE_VOIDED',
    title: 'Xərc ləğv edildi',
    message:
      `${CATEGORY_LABEL[updated.category]}: ${moneyOut(updated.amount).toFixed(2)} AZN ləğv edildi. ` +
      `Səbəb: ${reason.trim()}`,
    note: reason.trim(),
    relatedId: updated.id,
  });

  await audit({
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'expense.voided',
    entityType: 'expense',
    entityId: expenseId,
    before: { amount: moneyOut(updated.amount), category: updated.category, waterType: updated.waterType },
    meta: { reason: reason.trim() },
    req,
  });

  return serializeExpense(updated as never);
}

export interface ListExpensesQuery {
  category?: ExpenseCategory;
  waterType?: WaterType;
  preset?: DateRangePreset;
  from?: string;
  to?: string;
  includeVoided?: boolean;
  page?: number;
  pageSize?: number;
}

/** Expense ledger, newest first. Admin only. */
export async function listExpenses(query: ListExpensesQuery, actor: Actor) {
  if (actor.role !== Role.ADMIN) {
    throw forbidden('Xərc tarixçəsini yalnız administrator görə bilər.');
  }
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));
  const { start, end } = resolveRange(
    query.preset,
    query.from ? new Date(query.from) : null,
    query.to ? new Date(query.to) : null,
  );

  const where: Prisma.ExpenseWhereInput = {
    ...(query.includeVoided ? {} : { voidedAt: null }),
    ...(query.category ? { category: query.category } : {}),
    ...(query.waterType ? { waterType: query.waterType } : {}),
    ...(start || end ? { spentAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
  };

  const [rows, total, sum] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: [{ spentAt: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { createdBy: { select: { id: true, fullName: true } } },
    }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where, _sum: { amount: true } }),
  ]);

  return {
    ...paginate(rows.map((r) => serializeExpense(r as never)), total, page, pageSize),
    totalAmount: moneyOut(sum._sum.amount ?? 0),
  };
}

/**
 * Expense totals split by water type (and a company-wide bucket). Used by the
 * dashboard and the reports so profit can be shown per water type.
 */
export async function expenseTotalsByWater(start: Date | null, end: Date | null) {
  const rows = await prisma.expense.groupBy({
    by: ['waterType'],
    where: {
      voidedAt: null,
      ...(start || end ? { spentAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
    },
    _sum: { amount: true },
  });

  const pick = (wt: WaterType | null) =>
    moneyOut(rows.find((r) => r.waterType === wt)?._sum.amount ?? 0);
  const filtered = pick(WaterType.FILTERED);
  const spring = pick(WaterType.SPRING);
  const shared = pick(null);
  return {
    filtered,
    spring,
    shared,
    total: moneyOut(filtered + spring + shared),
  };
}
