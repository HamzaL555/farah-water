import { InventoryTxType, Role } from '@prisma/client';
import { prisma } from '../prisma';
import { badRequest, forbidden, notFound } from '../common/utils/errors';
import { audit } from '../common/utils/audit';
import { paginate, serializeInventoryTx } from '../common/utils/serialize';
import { resolveRange, DateRangePreset } from '../common/utils/date';
import { applyInventoryTx, effectFor, WAREHOUSE_KEY, workerKey } from './inventory.service';
import { Actor } from '../deliveries/delivery.service';
import { newIdempotencyKey } from '../auth/tokens';

export interface StockMovementInput {
  type: InventoryTxType;
  bottleCount: number;
  workerId?: string | null;
  deliveryId?: string | null;
  note?: string | null;
  occurredAt?: Date;
  /** Supply one for offline-replay safety; otherwise a UUID is generated. */
  reference?: string;
}

/**
 * Moves stock between two buckets inside ONE database transaction, so the
 * warehouse total and the worker's handheld count can never drift apart.
 */
export async function moveStock(input: StockMovementInput, actor: Actor, req?: never) {
  if (!Number.isInteger(input.bottleCount) || input.bottleCount <= 0) {
    throw badRequest('Bidon sayı müsbət tam ədəd olmalıdır.');
  }
  const reference = input.reference ?? newIdempotencyKey();
  const effect = effectFor(input.type, input.workerId);

  const result = await prisma.$transaction(async (tx) => {
    const primary = await applyInventoryTx(tx, {
      reference,
      type: input.type,
      bottleCount: input.bottleCount,
      balanceKey: effect.balanceKey,
      direction: effect.direction,
      workerId: input.workerId ?? null,
      deliveryId: input.deliveryId ?? null,
      note: input.note ?? null,
      occurredAt: input.occurredAt ?? new Date(),
      createdById: actor.id,
    });

    if (effect.counterpartyKey) {
      // The opposite leg keeps the two buckets balanced in the same commit.
      const counterpartyIsWorker = effect.counterpartyKey !== WAREHOUSE_KEY;
      await applyInventoryTx(tx, {
        reference: `${reference}:cp`,
        type: input.type,
        bottleCount: input.bottleCount,
        balanceKey: effect.counterpartyKey,
        direction: effect.counterpartyDirection!,
        workerId: counterpartyIsWorker ? input.workerId : null,
        deliveryId: input.deliveryId ?? null,
        note: input.note ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        createdById: actor.id,
      });
    }
    return primary;
  });

  await audit({
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: `inventory.${input.type.toLowerCase()}`,
    entityType: 'inventory_transaction',
    entityId: result.transactionId,
    meta: { bottleCount: input.bottleCount, workerId: input.workerId ?? null, note: input.note },
    req,
  });

  return result;
}

// --------------------------- authorised operations -------------------------

/**
 * Records bottles arriving into the central warehouse.
 *
 * Both roles may do this: in this business the worker is the one who physically
 * counts what arrived, and the admin watches the warehouse total. Every row
 * keeps `createdById`, so the admin view can always show who entered how many,
 * and the audit log records it too.
 */
export async function receiveStock(bottleCount: number, note: string | null, actor: Actor, req?: never, reference?: string) {
  return moveStock({ type: InventoryTxType.INBOUND, bottleCount, note, reference }, actor, req);
}

/**
 * Takes bottles out of the warehouse into the caller's own hands.
 *
 * WORKER ONLY, and always into the actor's own bucket. The owner asked that the
 * warehouse be run by the driver who physically receives and uses the stock,
 * with the admin watching the totals rather than dispensing. Accepting a
 * workerId would put that choice back in someone's hands; a worker can only
 * ever move stock to themselves, so the field is not taken at all.
 */
export async function takeFromWarehouse(
  bottleCount: number,
  note: string | null,
  actor: Actor,
  req?: never,
  reference?: string,
) {
  if (actor.role === Role.ADMIN) {
    throw forbidden('Anbardan bidon götürmək işçinin özündədir. Administrator yalnız baxır.');
  }
  return moveStock(
    { type: InventoryTxType.ISSUE_TO_WORKER, bottleCount, workerId: actor.id, note, reference },
    actor,
    req,
  );
}

/**
 * Returns stock from the caller's own hands back into the warehouse.
 *
 * The warehouse is the worker's to run; the admin watches it. That is a
 * deliberate choice by the owner, and it has a cost worth stating: a figure
 * entered wrongly by a worker can only be corrected by that same worker. The
 * audit log records who entered it, so a mistake is visible and attributable -
 * but the fix has to come from the driver.
 */
export async function returnToStock(bottleCount: number, note: string | null, actor: Actor, req?: never, reference?: string) {
  if (actor.role === Role.ADMIN) {
    throw forbidden('Anbarı işçi idarə edir. Administrator yalnız baxır.');
  }
  return moveStock({ type: InventoryTxType.RETURN_TO_STOCK, bottleCount, workerId: actor.id, note, reference }, actor, req);
}

export async function reportDamageOrLoss(
  type: InventoryTxType,
  bottleCount: number,
  note: string | null,
  actor: Actor,
  req?: never,
  reference?: string,
) {
  // Only write-off types are meaningful here; the route restricts the input.
  if (type !== InventoryTxType.DAMAGE && type !== InventoryTxType.LOSS) {
    throw badRequest('Yalnız zədələnmiş və ya itmiş bidon qeydə alına bilər.');
  }
  // Workers write off stock from their own hands. The admin does not: with the
  // warehouse run by the worker, the admin watching is the whole of the role.
  if (actor.role === Role.ADMIN) {
    throw forbidden('Anbarı işçi idarə edir. Administrator yalnız baxır.');
  }
  return moveStock({ type, bottleCount, workerId: actor.id, note, reference }, actor, req);
}

// ------------------------------- reporting ---------------------------------

export async function getWarehouseSummary(actor: Actor) {
  const warehouse = await prisma.inventoryBalance.findUnique({
    where: { key: WAREHOUSE_KEY },
    select: { quantity: true },
  });

  const start = resolveRange('today').start!;
  const end = resolveRange('today').end!;

  const [inToday, outToday, damaged, lost, workerUsers, workerBalances] = await Promise.all([
    prisma.inventoryTransaction.aggregate({
      where: { balanceKey: WAREHOUSE_KEY, type: InventoryTxType.INBOUND, occurredAt: { gte: start, lt: end } },
      _sum: { bottleCount: true },
    }),
    prisma.inventoryTransaction.aggregate({
      where: { balanceKey: WAREHOUSE_KEY, direction: -1, type: { in: [InventoryTxType.ISSUE_TO_WORKER, InventoryTxType.DAMAGE, InventoryTxType.LOSS] }, occurredAt: { gte: start, lt: end } },
      _sum: { bottleCount: true },
    }),
    prisma.inventoryTransaction.aggregate({
      where: { type: InventoryTxType.DAMAGE },
      _sum: { bottleCount: true },
    }),
    prisma.inventoryTransaction.aggregate({
      where: { type: InventoryTxType.LOSS },
      _sum: { bottleCount: true },
    }),
    // Every worker account, not just the ones who already hold stock: a newly
    // created worker has no InventoryBalance row yet, and must still be
    // selectable for "İşçiyə təhvil".
    prisma.user.findMany({
      where: { role: Role.WORKER },
      select: { id: true, fullName: true, username: true, isActive: true },
      orderBy: { fullName: 'asc' },
    }),
    prisma.inventoryBalance.findMany({
      where: { scope: 'WORKER' },
      select: { workerId: true, quantity: true },
    }),
  ]);

  const balanceByWorker = new Map(workerBalances.map((b) => [b.workerId, b.quantity]));
  const inHand = workerBalances.reduce((sum, r) => sum + r.quantity, 0);

  const workers = workerUsers
    .map((u) => ({
      workerId: u.id,
      workerName: u.fullName,
      username: u.username,
      isActive: u.isActive,
      quantity: balanceByWorker.get(u.id) ?? 0,
    }))
    .sort((a, b) => b.quantity - a.quantity || a.workerName.localeCompare(b.workerName, 'az'));

  return {
    warehouseQuantity: warehouse?.quantity ?? 0,
    inWorkersHands: inHand,
    totalSystemQuantity: (warehouse?.quantity ?? 0) + inHand,
    todayInbound: inToday._sum.bottleCount ?? 0,
    todayOutbound: outToday._sum.bottleCount ?? 0,
    damagedTotal: damaged._sum.bottleCount ?? 0,
    lostTotal: lost._sum.bottleCount ?? 0,
    workers,
  };
}

/** A worker's own handheld stock count. */
export async function getMyStock(actor: Actor) {
  const balance = await prisma.inventoryBalance.findUnique({
    where: { key: workerKey(actor.id) },
    select: { quantity: true, updatedAt: true },
  });
  return { quantity: balance?.quantity ?? 0, updatedAt: balance?.updatedAt ?? null };
}

export interface ListInventoryQuery {
  type?: InventoryTxType;
  workerId?: string;
  deliveryId?: string;
  preset?: DateRangePreset;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export async function listInventoryTransactions(query: ListInventoryQuery, actor: Actor) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));
  const { start, end } = resolveRange(query.preset, query.from ? new Date(query.from) : null, query.to ? new Date(query.to) : null);

  const effectiveWorkerId = actor.role === Role.ADMIN ? query.workerId : actor.id;

  const where = {
    ...(query.type ? { type: query.type } : {}),
    ...(query.deliveryId ? { deliveryId: query.deliveryId } : {}),
    ...(start || end ? { occurredAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
    // Workers see warehouse movements plus their own; admins see everything.
    ...(actor.role === Role.ADMIN
      ? effectiveWorkerId ? { workerId: effectiveWorkerId } : {}
      : { OR: [{ balanceKey: WAREHOUSE_KEY }, { balanceKey: workerKey(actor.id) }] }),
  };

  const [rows, total] = await Promise.all([
    prisma.inventoryTransaction.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        worker: { select: { id: true, fullName: true } },
        createdBy: { select: { id: true, fullName: true, role: true } },
      },
    }),
    prisma.inventoryTransaction.count({ where }),
  ]);

  return paginate(rows.map(serializeInventoryTx), total, page, pageSize);
}
