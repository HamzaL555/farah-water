import { DeliveryCorrectionStatus, DeliveryStatus, Prisma, Role } from '@prisma/client';
import { prisma } from '../prisma';
import { AppError, badRequest, forbidden, notFound } from '../common/utils/errors';
import { round2 } from '../common/utils/status';
import { audit } from '../common/utils/audit';
import { recalcDelivery } from '../deliveries/delivery.service';
import { applyInventoryTx, workerKey } from '../inventory/inventory.service';
import { createNotification } from '../notifications/notification.service';
import type { Actor } from '../users/users.service';

export type DeliveryCorrection = {
  id: string;
  deliveryId: string;
  oldBottleCount: number;
  newBottleCount: number;
  reason: string;
  status: DeliveryCorrectionStatus;
  requestedById: string;
  approvedById: string | null;
  requestedAt: Date;
  approvedAt: Date | null;
  delivery: {
    id: string;
    bottleCount: number;
    unitPrice: Prisma.Decimal;
    totalAmount: Prisma.Decimal;
    paidAmount: Prisma.Decimal;
    debtAmount: Prisma.Decimal;
    workerId: string;
  };
  requestedBy: { id: string; fullName: string; username: string };
  approvedBy: { id: string; fullName: string } | null;
};

/**
 * Worker requests a bottle count change on an existing delivery.
 * The reason is mandatory - no empty corrections allowed.
 */
export async function requestCorrection(
  input: { deliveryId: string; newBottleCount: number; reason: string },
  actor: Actor,
) {
  const delivery = await prisma.delivery.findUnique({
    where: { id: input.deliveryId },
    select: {
      id: true,
      bottleCount: true,
      workerId: true,
      status: true,
      confirmedAt: true,
    },
  });
  if (!delivery) throw notFound('Çatdırılma tapılmadı.');

  // Only the delivery's own worker can request a correction.
  if (delivery.workerId !== actor.id) {
    throw forbidden('Yalnız çatdırılmanın işçisi düzəliş istəyə bilər.');
  }

  // Cannot correct a cancelled delivery.
  if (delivery.status === 'CANCELLED') {
    throw badRequest('Ləğv edilmiş çatdırılma düzəltilə bilməz.');
  }

  // Nor one whose stock has not been accepted yet.
  if (!delivery.confirmedAt) {
    throw badRequest(
      'Təsdiqlənməmiş çatdırılma üçün düzəliş istənə bilməz. Əvvəlcə çatdırılmanı təsdiqləyin.',
    );
  }

  // No duplicate pending corrections for the same delivery.
  const existing = await prisma.deliveryCorrection.findFirst({
    where: { deliveryId: input.deliveryId, status: DeliveryCorrectionStatus.PENDING },
  });
  if (existing) {
    throw badRequest('Bu çatdırılma üçün gözləmədə düzəliş artıq var.');
  }

  const correction = await prisma.deliveryCorrection.create({
    data: {
      deliveryId: input.deliveryId,
      oldBottleCount: delivery.bottleCount,
      newBottleCount: input.newBottleCount,
      reason: input.reason.trim(),
      status: DeliveryCorrectionStatus.PENDING,
      requestedById: actor.id,
    },
    include: {
      delivery: {
        select: {
          id: true,
          bottleCount: true,
          workerId: true,
          status: true,
        },
      },
      requestedBy: { select: { id: true, fullName: true, username: true } },
    },
  });

  await audit({
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'delivery_correction.requested',
    entityType: 'delivery_correction',
    entityId: correction.id,
    after: {
      deliveryId: correction.deliveryId,
      oldBottleCount: correction.oldBottleCount,
      newBottleCount: correction.newBottleCount,
      reason: correction.reason,
    },
  });

  return correction;
}

/**
 * Admin lists correction requests, optionally filtered by status/delivery.
 */
export async function listCorrections(
  filter: { status?: DeliveryCorrectionStatus; deliveryId?: string; page: number; pageSize: number },
  actor: Actor,
) {
  if (actor.role !== Role.ADMIN) {
    throw forbidden('Yalnız administrator düzəlişlərə baxa bilər.');
  }

  const [items, total] = await Promise.all([
    prisma.deliveryCorrection.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.deliveryId ? { deliveryId: filter.deliveryId } : {}),
      },
      include: {
        delivery: {
          select: {
            id: true,
            bottleCount: true,
            customer: { select: { name: true } },
            worker: { select: { fullName: true, username: true } },
          },
        },
        requestedBy: { select: { id: true, fullName: true, username: true } },
        approvedBy: { select: { id: true, fullName: true } },
      },
      orderBy: { requestedAt: 'desc' },
      skip: (filter.page - 1) * filter.pageSize,
      take: filter.pageSize,
    }),
    prisma.deliveryCorrection.count({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.deliveryId ? { deliveryId: filter.deliveryId } : {}),
      },
    }),
  ]);

  return { items, total, page: filter.page, pageSize: filter.pageSize };
}

/**
 * Admin approves or rejects a correction request.
 *
 * When approved, the delivery's bottleCount is updated, the totals are
 * recomputed, AND the worker's bottle balance is moved by the difference:
 * a higher count spends more of their stock, a lower one returns it. Without
 * this leg the delivery total and the bottle ledger would disagree, which is
 * exactly what a "düzəliş" exists to prevent.
 *
 * The approval is claimed with a conditional UPDATE on PENDING, so a double
 * click (or two admins at once) can never move the same bottles twice. The
 * inventory reference is fixed per correction id as a second line of defence.
 */
export async function reviewCorrection(
  correctionId: string,
  input: { status: 'APPROVED' | 'REJECTED'; reason?: string },
  actor: Actor,
) {
  if (actor.role !== Role.ADMIN) {
    throw forbidden('Yalnız administrator düzəlişi təsdiqləyə bilər.');
  }

  const correction = await prisma.deliveryCorrection.findUnique({
    where: { id: correctionId },
    include: { delivery: true },
  });
  if (!correction) throw notFound('Düzəllik tapılmadı.');
  if (correction.status !== DeliveryCorrectionStatus.PENDING) {
    throw badRequest('Bu düzəllik artıq təsdiqlənib və ya rədd edilib.');
  }

  // Filled inside the transaction and read after commit, so a notification is
  // only written for a change that really happened.
  const stock = {
    delta: 0,
    after: null as number | null,
    before: 0,
    waterType: correction.delivery.waterType,
  };

  const updated = await prisma.$transaction(async (tx) => {
    // Atomic claim: only one review may pass from PENDING to a final status.
    const claimed = await tx.deliveryCorrection.updateMany({
      where: { id: correctionId, status: DeliveryCorrectionStatus.PENDING },
      data: {
        status: input.status === 'APPROVED' ? DeliveryCorrectionStatus.APPROVED : DeliveryCorrectionStatus.REJECTED,
        approvedById: actor.id,
        approvedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      throw badRequest('Bu düzəllik artıq təsdiqlənib və ya rədd edilib.');
    }

    const c = await tx.deliveryCorrection.findUniqueOrThrow({
      where: { id: correctionId },
      include: { delivery: true },
    });

    if (input.status === 'APPROVED') {
      if (c.delivery.status === DeliveryStatus.CANCELLED) {
        throw badRequest('Ləğv edilmiş çatdırılma üçün düzəliş təsdiqlənə bilməz.');
      }
      if (!c.delivery.confirmedAt) {
        throw badRequest('Təsdiqlənməmiş çatdırılma üçün düzəliş təsdiqlənə bilməz.');
      }

      // Use the delivery's CURRENT count, not the one captured when the worker
      // asked: an admin may have edited it while the request was pending. The
      // balance must move by what actually changes now.
      const currentCount = c.delivery.bottleCount;
      const delta = c.newBottleCount - currentCount;
      stock.delta = delta;
      stock.waterType = c.delivery.waterType;

      if (delta !== 0) {
        const applied = await applyInventoryTx(tx, {
          reference: `delivery:correction:${correctionId}`,
          type: delta > 0 ? 'OUT_DELIVERY' : 'RETURN_TO_STOCK',
          waterType: c.delivery.waterType,
          bottleCount: Math.abs(delta),
          balanceKey: workerKey(c.delivery.workerId, c.delivery.waterType),
          direction: delta > 0 ? -1 : 1,
          workerId: c.delivery.workerId,
          deliveryId: c.deliveryId,
          note:
            `Təsdiqlənmiş düzəliş: ${correction.reason}` +
            (input.reason ? ` (${input.reason})` : ''),
          createdById: actor.id,
        });
        stock.after = applied.newBalance;
        stock.before = applied.newBalance + delta;
      }

      // Update the delivery's bottleCount. totalAmount and debtAmount must move
      // in the SAME statement: the table enforces
      // `debt_amount = total_amount - paid_amount`, so writing the count alone
      // makes the row momentarily inconsistent and PostgreSQL rejects it.
      // recalcDelivery then re-derives the settled figures from the ledger.
      const newTotal = round2(new Prisma.Decimal(c.delivery.unitPrice).mul(c.newBottleCount));
      await tx.delivery.update({
        where: { id: correction.deliveryId },
        data: {
          bottleCount: c.newBottleCount,
          totalAmount: newTotal,
          debtAmount: newTotal.minus(c.delivery.paidAmount),
        },
      });
      await recalcDelivery(tx, correction.deliveryId);
    }

    return c;
  });

  await audit({
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: input.status === 'APPROVED' ? 'delivery_correction.approved' : 'delivery_correction.rejected',
    entityType: 'delivery_correction',
    entityId: correctionId,
    after: {
      status: input.status,
      reason: input.reason ?? null,
      oldBottleCount: correction.oldBottleCount,
      newBottleCount: correction.newBottleCount,
    },
    meta: {
      workerId: correction.delivery.workerId,
      bottleDelta: stock.delta,
      beforeBalance: stock.after !== null ? stock.before : null,
      afterBalance: stock.after,
    },
  });

  // A bottle-count correction is a balance change like any other: the admin
  // supervising the warehouse sees it with the exact before/after figures.
  if (input.status === 'APPROVED' && stock.after !== null && stock.delta !== 0) {
    await createNotification({
      userId: actor.id,
      actorId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.role,
      action: stock.delta > 0 ? 'OUT_DELIVERY' : 'RETURN_TO_STOCK',
      waterType: stock.waterType,
      bottleCount: Math.abs(stock.delta),
      beforeBalance: stock.before,
      afterBalance: stock.after,
      note: `Çatdırılma düzəlişi təsdiqləndi: ${correction.reason}`,
      relatedId: correction.deliveryId,
    });
  }

  return updated;
}

/**
 * Get a single correction (worker can see their own, admin can see all).
 */
export async function getCorrection(correctionId: string, actor: Actor) {
  const correction = await prisma.deliveryCorrection.findUnique({
    where: { id: correctionId },
    include: {
      delivery: {
        select: {
          id: true,
          bottleCount: true,
          status: true,
          customer: { select: { name: true } },
          worker: { select: { fullName: true, username: true } },
        },
      },
      requestedBy: { select: { id: true, fullName: true, username: true } },
      approvedBy: { select: { id: true, fullName: true } },
    },
  });
  if (!correction) throw notFound('Düzəllik tapılmadı.');

  if (actor.role !== Role.ADMIN && correction.requestedById !== actor.id) {
    throw forbidden('Bu düzəlişə baxma hüququnuz yoxdur.');
  }

  return correction;
}
