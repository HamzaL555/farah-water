import { InventoryTxType, Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../common/utils/errors';

export const WAREHOUSE_KEY = 'WAREHOUSE';
export const workerKey = (workerId: string) => `WORKER:${workerId}`;

/**
 * Which balance a transaction type moves stock from/to, and in which direction.
 * `balanceKey` is the bucket that the signed delta is applied to.
 */
export interface InventoryEffect {
  balanceKey: string;
  direction: 1 | -1;
  counterpartyKey?: string;
  counterpartyDirection?: 1 | -1;
}

export function effectFor(type: InventoryTxType, workerId?: string | null): InventoryEffect {
  switch (type) {
    case InventoryTxType.INBOUND:
      return { balanceKey: WAREHOUSE_KEY, direction: 1 };
    case InventoryTxType.ISSUE_TO_WORKER:
      return { balanceKey: workerKey(workerId!), direction: 1, counterpartyKey: WAREHOUSE_KEY, counterpartyDirection: -1 };
    case InventoryTxType.RETURN_TO_STOCK:
      return { balanceKey: WAREHOUSE_KEY, direction: 1, counterpartyKey: workerKey(workerId!), counterpartyDirection: -1 };
    case InventoryTxType.OUT_DELIVERY:
      return { balanceKey: workerKey(workerId!), direction: -1 };
    case InventoryTxType.DAMAGE:
    case InventoryTxType.LOSS:
      return workerId
        ? { balanceKey: workerKey(workerId), direction: -1 }
        : { balanceKey: WAREHOUSE_KEY, direction: -1 };
    case InventoryTxType.CORRECTION:
      throw new AppError(400, 'Düzəliş üçün istiqamət ayrıca göstərilməlidir.', 'BAD_REQUEST');
    default:
      throw new AppError(400, 'Bilinməyən inventar əməliyyatı.', 'BAD_REQUEST');
  }
}

export interface ApplyInventoryInput {
  reference: string;
  type: InventoryTxType;
  bottleCount: number;
  balanceKey: string;
  direction: 1 | -1;
  workerId?: string | null;
  deliveryId?: string | null;
  note?: string | null;
  occurredAt?: Date;
  createdById: string;
}

export interface ApplyInventoryResult {
  transactionId: string;
  duplicate: boolean;
  newBalance: number;
}

async function ensureBalanceRow(
  tx: Prisma.TransactionClient,
  key: string,
  workerId?: string | null,
): Promise<void> {
  const scope = workerId ? 'WORKER' : 'WAREHOUSE';
  await tx.$executeRaw`
    INSERT INTO inventory_balances ("key", scope, "workerId", quantity, "updatedAt")
    VALUES (${key}, ${scope}::"BalanceScope", ${workerId ?? null}, 0, NOW())
    ON CONFLICT ("key") DO NOTHING
  `;
}

/**
 * Applies a signed stock delta atomically and records it in the ledger.
 *
 * - The conditional `quantity + delta >= 0` in the WHERE clause means the row
 *   lock is taken and the check happens in the SAME statement, so two workers
 *   spending the last bottles concurrently can never drive stock negative.
 * - `reference` is unique, so replaying the same delivery/inventory call is a
 *   no-op instead of a second deduction.
 */
export async function applyInventoryTx(
  client: PrismaClient | Prisma.TransactionClient,
  input: ApplyInventoryInput,
): Promise<ApplyInventoryResult> {
  if (!Number.isInteger(input.bottleCount) || input.bottleCount <= 0) {
    throw new AppError(400, 'Bidon sayı müsbət tam ədəd olmalıdır.', 'BAD_REQUEST');
  }
  const delta = input.direction * input.bottleCount;

  // Fast path: the reference was already processed by an earlier call.
  const existing = await client.inventoryTransaction.findUnique({
    where: { reference: input.reference },
    select: { id: true },
  });
  if (existing) {
    const bal = await client.inventoryBalance.findUnique({
      where: { key: input.balanceKey },
      select: { quantity: true },
    });
    return { transactionId: existing.id, duplicate: true, newBalance: bal?.quantity ?? 0 };
  }

  await ensureBalanceRow(client, input.balanceKey, input.workerId ?? null);

  const rows = await client.$queryRaw<Array<{ quantity: number }>>`
    UPDATE inventory_balances
       SET quantity = quantity + ${delta}, "updatedAt" = NOW()
     WHERE "key" = ${input.balanceKey}
       AND quantity + ${delta} >= 0
    RETURNING quantity
  `;

  if (rows.length === 0) {
    const current = await client.inventoryBalance.findUnique({
      where: { key: input.balanceKey },
      select: { quantity: true },
    });
    const owner = input.balanceKey === WAREHOUSE_KEY ? 'anbarda' : 'işçinin əlində';
    throw new AppError(
      409,
      `Kifayət qədər bidon yoxdur: ${owner} ${current?.quantity ?? 0} ədəd var, ${input.bottleCount} tələb olunur.`,
      'INSUFFICIENT_STOCK',
    );
  }

  let created;
  try {
    created = await client.inventoryTransaction.create({
      data: {
        reference: input.reference,
        type: input.type,
        bottleCount: input.bottleCount,
        direction: delta >= 0 ? 1 : -1,
        balanceKey: input.balanceKey,
        workerId: input.workerId ?? null,
        deliveryId: input.deliveryId ?? null,
        note: input.note ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        createdById: input.createdById,
      },
      select: { id: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Concurrent duplicate: roll the caller back via the thrown conflict so
      // the surrounding transaction is aborted rather than half-committed.
      throw new AppError(409, 'Bu inventar əməliyyatı artıq qeydə alınıb.', 'DUPLICATE_INVENTORY');
    }
    throw err;
  }

  return { transactionId: created.id, duplicate: false, newBalance: Number(rows[0].quantity) };
}
