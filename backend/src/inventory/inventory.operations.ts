import { InventoryTxType, Prisma, Role, WaterType, WorkerType } from '@prisma/client';
import { prisma } from '../prisma';
import { badRequest, forbidden, notFound } from '../common/utils/errors';
import { audit } from '../common/utils/audit';
import { paginate, serializeInventoryTx } from '../common/utils/serialize';
import { resolveRange, DateRangePreset } from '../common/utils/date';
import { applyInventoryTx, effectFor, warehouseKey, workerKey } from './inventory.service';
import { Actor } from '../deliveries/delivery.service';
import { newIdempotencyKey } from '../auth/tokens';
import { createNotification } from '../notifications/notification.service';

export interface StockMovementInput {
  type: InventoryTxType;
  waterType: WaterType;
  bottleCount: number;
  workerId?: string | null;
  deliveryId?: string | null;
  note?: string | null;
  occurredAt?: Date;
  /** Supply one for offline-replay safety; otherwise a UUID is generated. */
  reference?: string;
}

/**
 * The anbardar runs the warehouse; the admin adds stock and hands bottles out;
 * a REGULAR worker only ever receives bottles and spends them on deliveries.
 *
 * This guard sits in the service, not the route, so no overlooked endpoint can
 * let a regular worker move warehouse stock on their behalf.
 */
function requireWarehouseAccess(actor: Actor): void {
  if (actor.role === Role.ADMIN) return;
  if (actor.workerType === WorkerType.WAREHOUSE_KEEPER) return;
  throw forbidden('Bu əməliyyat yalnız anbardar tərəfindən aparıla bilər.');
}

/**
 * Movements out of and back into the caller's OWN hands (issue/return/write-off).
 * The admin is stopped too: stock in an admin's hands would sit in a bucket no
 * worker view ever lists, so the warehouse total would silently disagree with
 * the sum of its parts. The admin hands bottles out with /distribute instead.
 */
function requireKeeperForSelfMovement(actor: Actor): void {
  if (actor.role === Role.ADMIN) {
    throw forbidden('Bu əməliyyatı anbardar aparır. Administrator yalnız nəzarət edir.');
  }
  if (actor.workerType === WorkerType.WAREHOUSE_KEEPER) return;
  throw forbidden('Bu əməliyyat yalnız anbardar tərəfindən aparıla bilər.');
}

/**
 * Moves stock between two buckets inside ONE database transaction, so the
 * warehouse total and the worker's handheld count can never drift apart.
 * Water type is tracked on both legs so Bulaq and Filtr are never mixed.
 *
 * Every call also writes an admin notification carrying the real balance
 * before and after, plus an audit row: who did it, to what, how many.
 */
export async function moveStock(input: StockMovementInput, actor: Actor, req?: never) {
  if (!Number.isInteger(input.bottleCount) || input.bottleCount <= 0) {
    throw badRequest('Bidon sayı müsbət tam ədəd olmalıdır.');
  }
  const reference = input.reference ?? newIdempotencyKey();
  const effect = effectFor(input.type, input.waterType, input.workerId);

  // The admin watches the anbar, so the notification reports the warehouse
  // balance whenever a leg touches it; otherwise the worker's own bucket.
  const reportedKey = effect.counterpartyKey?.startsWith('WAREHOUSE')
    ? effect.counterpartyKey
    : effect.balanceKey;

  const { primary, beforeBalance } = await prisma.$transaction(async (tx) => {
    const beforeRow = await tx.inventoryBalance.findFirst({
      where: { key: reportedKey, waterType: input.waterType },
      select: { quantity: true },
    });

    const primary = await applyInventoryTx(tx, {
      reference,
      type: input.type,
      waterType: input.waterType,
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
      const counterpartyIsWorker = !effect.counterpartyKey.startsWith('WAREHOUSE');
      await applyInventoryTx(tx, {
        reference: `${reference}:cp`,
        type: input.type,
        waterType: input.waterType,
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

    return { primary, beforeBalance: beforeRow?.quantity ?? 0 };
  });

  // `newBalance` belongs to the primary leg only, so when the notification
  // reports the other leg (the anbar), that leg is read back after the commit.
  const finalReported =
    reportedKey === effect.balanceKey
      ? primary.newBalance
      : (await prisma.inventoryBalance.findFirst({
          where: { key: reportedKey, waterType: input.waterType },
          select: { quantity: true },
        }))?.quantity ?? 0;

  // A replayed idempotent call is a no-op: the stock was already moved, so
  // neither a second notification nor a second audit row may claim otherwise.
  if (!primary.duplicate) {
    await createNotification({
      userId: actor.id, // the service fans this out to every active admin
      actorId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.role,
      action: input.type,
      waterType: input.waterType,
      bottleCount: input.bottleCount,
      beforeBalance: beforeBalance,
      afterBalance: finalReported,
      note: input.note ?? null,
      relatedId: input.deliveryId ?? primary.transactionId,
    });

    await audit({
      actorId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.role,
      action: `inventory.${input.type.toLowerCase()}`,
      entityType: 'inventory_transaction',
      entityId: primary.transactionId,
      meta: {
        bottleCount: input.bottleCount,
        waterType: input.waterType,
        workerId: input.workerId ?? null,
        beforeBalance,
        afterBalance: finalReported,
        note: input.note,
      },
      req,
    });
  }

  return { ...primary, beforeBalance, afterBalance: finalReported };
}

// --------------------------- authorised operations -------------------------

/**
 * Records bottles arriving into the central warehouse.
 *
 * Anbardar and admin only: a regular worker receiving stock for the warehouse
 * would let them change the anbar total on their own, which the module forbids.
 * Every row keeps `createdById`, so the history always shows who entered how
 * many, and the admin is notified.
 */
export async function receiveStock(
  waterType: WaterType,
  bottleCount: number,
  note: string | null,
  actor: Actor,
  req?: never,
  reference?: string,
) {
  requireWarehouseAccess(actor);
  return moveStock({ type: InventoryTxType.INBOUND, waterType, bottleCount, note, reference }, actor, req);
}

/**
 * Takes bottles out of the warehouse into the caller's own hands.
 *
 * Anbardar only, and always into the actor's own bucket. The admin cannot use
 * it (see requireKeeperForSelfMovement) and a regular worker must be handed
 * stock by the anbardar through /distribute instead of taking it themselves.
 */
export async function takeFromWarehouse(
  waterType: WaterType,
  bottleCount: number,
  note: string | null,
  actor: Actor,
  req?: never,
  reference?: string,
) {
  requireKeeperForSelfMovement(actor);
  return moveStock(
    { type: InventoryTxType.ISSUE_TO_WORKER, waterType, bottleCount, workerId: actor.id, note, reference },
    actor,
    req,
  );
}

/**
 * Returns stock from a worker's hands back into the warehouse.
 *
 * With no `workerId`, an anbardar returns their OWN handheld stock (the
 * original flow). With a `workerId`, an anbardar or admin records a regular
 * worker handing bottles back, which moves THAT worker's bucket. A regular
 * worker still cannot call this themselves: returning bottles raises the
 * warehouse total, and "adi işçi anbar qalığını dəyişə bilməz" is the rule.
 */
export async function returnToStock(
  waterType: WaterType,
  bottleCount: number,
  note: string | null,
  actor: Actor,
  req?: never,
  reference?: string,
  workerId?: string | null,
) {
  const targetId = workerId && workerId !== actor.id ? workerId : null;
  if (targetId) {
    requireWarehouseAccess(actor);
    const target = await prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, role: true, isActive: true },
    });
    if (!target || target.role !== Role.WORKER || !target.isActive) {
      throw badRequest('Seçilmiş işçi tapılmadı və ya aktiv deyil.');
    }
    return moveStock(
      { type: InventoryTxType.RETURN_TO_STOCK, waterType, bottleCount, workerId: targetId, note, reference },
      actor,
      req,
    );
  }

  requireKeeperForSelfMovement(actor);
  return moveStock(
    { type: InventoryTxType.RETURN_TO_STOCK, waterType, bottleCount, workerId: actor.id, note, reference },
    actor,
    req,
  );
}

/**
 * Damaged / lost write-off from the caller's own hands. The reason is mandatory
 * at the schema level: anbar qalığını səbəbsiz azaltmaq olmaz.
 */
export async function reportDamageOrLoss(
  type: InventoryTxType,
  waterType: WaterType,
  bottleCount: number,
  note: string | null,
  actor: Actor,
  req?: never,
  reference?: string,
) {
  // Only write-off types are meaningful here; the route restricts the input.
  if (type !== InventoryTxType.DAMAGE && type !== InventoryTxType.LOSS) {
    throw badRequest('Yalnız zədələnmiş vəya itmiş bidon qeydə alına bilər.');
  }
  requireKeeperForSelfMovement(actor);
  return moveStock({ type, waterType, bottleCount, workerId: actor.id, note, reference }, actor, req);
}

/**
 * Writes bottles off directly from the warehouse: damaged in storage, lost on
 * the way in, or discarded. Separate from `reportDamageOrLoss`, which moves the
 * caller's OWN handheld stock; here the bucket is the anbar itself.
 *
 * The reason is mandatory in the schema, and the row names the anbardar, so an
 * anbar balance can never be reduced without a written cause and an author.
 */
export async function writeOffWarehouse(
  type: InventoryTxType,
  waterType: WaterType,
  bottleCount: number,
  note: string | null,
  actor: Actor,
  req?: never,
  reference?: string,
) {
  if (type !== InventoryTxType.DAMAGE && type !== InventoryTxType.LOSS) {
    throw badRequest('Yalnız zədələnmiş və ya itmiş bidon qeydə alına bilər.');
  }
  requireKeeperForSelfMovement(actor);
  // `workerId: null` is what makes effectFor() target the WAREHOUSE bucket.
  return moveStock({ type, waterType, bottleCount, workerId: null, note, reference }, actor, req);
}

/**
 * Hands bottles from the warehouse to a named worker's balance.
 *
 * Anbardar or admin. This is the module's core verb: the regular worker's
 * balance only ever grows through here (and through a cancelled delivery being
 * restored), so "heç bir işçi özbaşına bidon götürə bilməz" holds by construction.
 */
export async function distributeToWorker(
  waterType: WaterType,
  workerId: string,
  bottleCount: number,
  note: string | null,
  actor: Actor,
  req?: never,
  reference?: string,
) {
  requireWarehouseAccess(actor);
  // Verify the target is a worker. The anbardar may hand stock to any active
  // worker, including another anbardar, but never to an admin account.
  const target = await prisma.user.findUnique({
    where: { id: workerId },
    select: { id: true, role: true, workerType: true, fullName: true, isActive: true },
  });
  if (!target || target.role !== Role.WORKER || !target.isActive) {
    throw badRequest('Seçilmiş işçi tapılmadı və ya aktiv deyil.');
  }
  return moveStock(
    { type: InventoryTxType.ISSUE_TO_WORKER, waterType, bottleCount, workerId, note, reference },
    actor,
    req,
  );
}

// ------------------------------- reporting ---------------------------------

/** Rows grouped into a per-water-type triple, defaulting to zero. */
function byType(rows: Array<{ waterType: WaterType; sum: number | null }>) {
  const pick = (wt: WaterType) => rows.find((r) => r.waterType === wt)?.sum ?? 0;
  const filtered = pick(WaterType.FILTERED);
  const spring = pick(WaterType.SPRING);
  return { filtered, spring, total: filtered + spring };
}

/**
 * The anbardar panel's numbers.
 *
 * Warehouse stock is read from the balance rows (the live truth), while the
 * in/out figures are summed from the append-only ledger, split by water type.
 * Nothing here can mix Bulaq with Filtr: every aggregate groups by waterType.
 */
export async function getWarehouseSummary(actor: Actor) {
  // The warehouse total is not a regular worker's business - they only ever
  // see their own balance, so this view is keeper/admin only.
  requireWarehouseAccess(actor);

  const [warehouseBalances, workerBalances, workerUsers, inboundRows, outRows, issuedRows, returnedRows, damaged, lost] =
    await Promise.all([
      prisma.inventoryBalance.findMany({
        where: { scope: 'WAREHOUSE' },
        select: { key: true, waterType: true, quantity: true },
      }),
      prisma.inventoryBalance.findMany({
        where: { scope: 'WORKER' },
        select: { workerId: true, waterType: true, quantity: true },
      }),
      prisma.user.findMany({
        // Include deactivated workers: bottles in their hands still exist and
        // must be visible to the anbardar, or the per-worker totals would not
        // add up to the "işçilərdə" figure they are meant to explain.
        where: { role: Role.WORKER },
        select: { id: true, fullName: true, username: true, workerType: true, isActive: true },
        orderBy: { fullName: 'asc' },
      }),
      prisma.inventoryTransaction.groupBy({
        by: ['waterType'],
        where: { balanceKey: { startsWith: 'WAREHOUSE' }, type: InventoryTxType.INBOUND },
        _sum: { bottleCount: true },
      }),
      // Everything that left the anbar: given to workers, damaged or lost.
      prisma.inventoryTransaction.groupBy({
        by: ['waterType'],
        where: { balanceKey: { startsWith: 'WAREHOUSE' }, direction: -1 },
        _sum: { bottleCount: true },
      }),
      prisma.inventoryTransaction.groupBy({
        by: ['waterType'],
        where: { balanceKey: { startsWith: 'WAREHOUSE' }, type: InventoryTxType.ISSUE_TO_WORKER },
        _sum: { bottleCount: true },
      }),
      prisma.inventoryTransaction.groupBy({
        by: ['waterType'],
        where: { balanceKey: { startsWith: 'WAREHOUSE' }, type: InventoryTxType.RETURN_TO_STOCK },
        _sum: { bottleCount: true },
      }),
      prisma.inventoryTransaction.aggregate({ where: { type: InventoryTxType.DAMAGE }, _sum: { bottleCount: true } }),
      prisma.inventoryTransaction.aggregate({ where: { type: InventoryTxType.LOSS }, _sum: { bottleCount: true } }),
    ]);

  const start = resolveRange('today').start!;
  const end = resolveRange('today').end!;

  const [todayInbound, todayOutbound] = await Promise.all([
    prisma.inventoryTransaction.aggregate({
      where: {
        balanceKey: { startsWith: 'WAREHOUSE' },
        type: InventoryTxType.INBOUND,
        occurredAt: { gte: start, lt: end },
      },
      _sum: { bottleCount: true },
    }),
    prisma.inventoryTransaction.aggregate({
      where: {
        balanceKey: { startsWith: 'WAREHOUSE' },
        direction: -1,
        type: { in: [InventoryTxType.ISSUE_TO_WORKER, InventoryTxType.DAMAGE, InventoryTxType.LOSS] },
        occurredAt: { gte: start, lt: end },
      },
      _sum: { bottleCount: true },
    }),
  ]);

  const warehouseByType = new Map<WaterType, number>();
  for (const b of warehouseBalances) {
    // Only the canonical `WAREHOUSE:<type>` row counts. A stray pre-split row
    // would otherwise be able to overwrite the real total with a stale zero.
    if (b.key === warehouseKey(b.waterType)) warehouseByType.set(b.waterType, b.quantity);
  }

  const workerByType = new Map<string, Map<WaterType, number>>();
  for (const b of workerBalances) {
    const wid = b.workerId!;
    if (!workerByType.has(wid)) workerByType.set(wid, new Map());
    workerByType.get(wid)!.set(b.waterType, b.quantity);
  }

  const workers = workerUsers
    .map((u) => {
      const byTypeMap = workerByType.get(u.id) ?? new Map();
      const filteredQty = byTypeMap.get(WaterType.FILTERED) ?? 0;
      const springQty = byTypeMap.get(WaterType.SPRING) ?? 0;
      return {
        workerId: u.id,
        workerName: u.fullName,
        username: u.username,
        workerType: u.workerType,
        isActive: u.isActive,
        filteredQty,
        springQty,
        totalQty: filteredQty + springQty,
      };
    })
    .sort((a, b) => b.totalQty - a.totalQty || a.workerName.localeCompare(b.workerName, 'az'));

  const warehouseFiltered = warehouseByType.get(WaterType.FILTERED) ?? 0;
  const warehouseSpring = warehouseByType.get(WaterType.SPRING) ?? 0;
  const totalWarehouse = warehouseFiltered + warehouseSpring;
  const totalInWorkers = workers.reduce((s, w) => s + w.totalQty, 0);

  const group = (rows: Array<{ waterType: WaterType; _sum: { bottleCount: number | null } }>) =>
    byType(rows.map((r) => ({ waterType: r.waterType, sum: r._sum.bottleCount })));

  return {
    warehouse: { filtered: warehouseFiltered, spring: warehouseSpring, total: totalWarehouse },
    // Kept for clients written before the water-type split; equals `total`.
    warehouseQuantity: totalWarehouse,
    inbound: group(inboundRows),
    outbound: group(outRows),
    issuedToWorkers: group(issuedRows),
    returned: group(returnedRows),
    inWorkersHands: totalInWorkers,
    totalSystemQuantity: totalWarehouse + totalInWorkers,
    todayInbound: todayInbound._sum?.bottleCount ?? 0,
    todayOutbound: todayOutbound._sum?.bottleCount ?? 0,
    damagedTotal: damaged._sum?.bottleCount ?? 0,
    lostTotal: lost._sum?.bottleCount ?? 0,
    workers,
  };
}

/** A worker's own handheld stock, split by water type. */
export async function getMyStock(actor: Actor) {
  const balances = await prisma.inventoryBalance.findMany({
    where: { workerId: actor.id, scope: 'WORKER' },
    select: { waterType: true, quantity: true, updatedAt: true },
  });
  const filtered = balances.find((b) => b.waterType === WaterType.FILTERED)?.quantity ?? 0;
  const spring = balances.find((b) => b.waterType === WaterType.SPRING)?.quantity ?? 0;
  return {
    filteredQty: filtered,
    springQty: spring,
    totalQty: filtered + spring,
    // Pre-split clients read `quantity`; it is the same total.
    quantity: filtered + spring,
    updatedAt: balances.length > 0 ? Math.max(...balances.map((b) => b.updatedAt.getTime())) : null,
  };
}

export interface ListInventoryQuery {
  type?: InventoryTxType;
  waterType?: WaterType;
  workerId?: string;
  /** Who recorded the row - filters the history by anbardar. */
  createdById?: string;
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
  const { start, end } = resolveRange(
    query.preset,
    query.from ? new Date(query.from) : null,
    query.to ? new Date(query.to) : null,
  );

  const where: Prisma.InventoryTransactionWhereInput = {
    ...(query.type ? { type: query.type } : {}),
    ...(query.waterType ? { waterType: query.waterType } : {}),
    ...(query.createdById ? { createdById: query.createdById } : {}),
    ...(query.deliveryId ? { deliveryId: query.deliveryId } : {}),
    ...(start || end ? { occurredAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
    ...(query.workerId ? { workerId: query.workerId } : {}),
  };

  // A regular worker never sees the warehouse ledger: only their own rows.
  // Keepers and admins see everything, optionally narrowed by the filters.
  if (actor.role !== Role.ADMIN && actor.workerType !== WorkerType.WAREHOUSE_KEEPER) {
    where.workerId = actor.id;
  }

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
