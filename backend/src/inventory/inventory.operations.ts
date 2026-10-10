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

export async function receiveStock(bottleCount: number, note: string | null, actor: Actor, req?: never, reference?: string) {
  if (actor.role !== Role.ADMIN) throw forbidden('Yalnız administrator anbara bidon qəbul edə bilər.');
  return moveStock({ type: InventoryTxType.INBOUND, bottleCount, note, reference }, actor, req);
}

export async function issueToWorker(workerId: string, bottleCount: number, note: string | null, actor: Actor, req?: never, reference?: string) {
  if (actor.role !== Role.ADMIN) throw forbidden('Yalnız administrator işçiyə bidon təhvil verə bilər.');
  const worker = await prisma.user.findUnique({ where: { id: workerId }, select: { id: true, isActive: true, fullName: true } });
  if (!worker) throw notFound('İşçi tapılmadı.');
  if (!worker.isActive) throw badRequest('Bu işçinin hesabı deaktivdir.');
  return moveStock({ type: InventoryTxType.ISSUE_TO_WORKER, bottleCount, workerId, note, reference }, actor, req);
}

export async function returnToStock(bottleCount: number, note: string | null, actor: Actor, req?: never, reference?: string) {
  // A worker may only hand back stock from their own hands.
  if (actor.role !== Role.ADMIN) {
    return moveStock({ type: InventoryTxType.RETURN_TO_STOCK, bottleCount, workerId: actor.id, note, reference }, actor, req);
  }
  throw forbidden('Administrator üçün işçi seçilib.');
}

export async function returnWorkerStock(workerId: string, bottleCount: number, note: string | null, actor: Actor, req?: never, reference?: string) {
  if (actor.role !== Role.ADMIN) throw forbidden('Yalnız administrator istənilən işçinin qaytarılmasını qeyd edə bilər.');
  return moveStock({ type: InventoryTxType.RETURN_TO_STOCK, bottleCount, workerId, note, reference }, actor, req);
}

export async function reportDamageOrLoss(
  type: InventoryTxType,
  bottleCount: number,
  note: string | null,
  workerId: string | null,
  actor: Actor,
  req?: never,
  reference?: string,
) {
  // Only write-off types are meaningful here; the route restricts the input.
  if (type !== InventoryTxType.DAMAGE && type !== InventoryTxType.LOSS) {
    throw badRequest('Yalnız zədələnmiş və ya itmiş bidon qeydə alına bilər.');
  }
  // Workers can only write off stock from their own hands; warehouse write-offs
  // are an admin responsibility.
  const targetWorker = actor.role === Role.ADMIN ? workerId : actor.id;
  return moveStock({ type, bottleCount, workerId: targetWorker, note, reference }, actor, req);
}

// ------------------------------- reporting ---------------------------------

export async function getWarehouseSummary(actor: Actor) {
  const warehouse = await prisma.inventoryBalance.findUnique({
    where: { key: WAREHOUSE_KEY },
    select: { quantity: true },
  });

  const start = resolveRange('today').start!;
  const end = resolveRange('today').end!;

  const [inToday, outToday, damaged, lost, workerRows] = await Promise.all([
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
    prisma.inventoryBalance.findMany({
      where: { scope: 'WORKER' },
      include: { worker: { select: { id: true, fullName: true, username: true, isActive: true } } },
      orderBy: { quantity: 'desc' },
    }),
  ]);

  const inHand = workerRows.reduce((sum, r) => sum + r.quantity, 0);

  return {
    warehouseQuantity: warehouse?.quantity ?? 0,
    inWorkersHands: inHand,
    totalSystemQuantity: (warehouse?.quantity ?? 0) + inHand,
    todayInbound: inToday._sum.bottleCount ?? 0,
    todayOutbound: outToday._sum.bottleCount ?? 0,
    damagedTotal: damaged._sum.bottleCount ?? 0,
    lostTotal: lost._sum.bottleCount ?? 0,
    workers: workerRows
      .filter((r) => r.worker)
      .map((r) => ({
        workerId: r.worker!.id,
        workerName: r.worker!.fullName,
        username: r.worker!.username,
        isActive: r.worker!.isActive,
        quantity: r.quantity,
      })),
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
      include: { worker: { select: { id: true, fullName: true } } },
    }),
    prisma.inventoryTransaction.count({ where }),
  ]);

  return paginate(rows.map(serializeInventoryTx), total, page, pageSize);
}
