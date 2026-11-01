import { DeliveryCorrectionStatus, Prisma, Role } from '@prisma/client';
import { prisma } from '../prisma';
import { AppError, badRequest, forbidden, notFound } from '../common/utils/errors';
import { round2 } from '../common/utils/status';
import { audit } from '../common/utils/audit';
import { recalcDelivery } from '../deliveries/delivery.service';
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
    },
  });
  if (!delivery) throw notFound('Çatdırılma tapılmadı.');

  // Only the delivery's own worker can request a correction.
  if (delivery.workerId !== actor.id) {
    throw forbidden('Yalnız çatdırılmanın işçisi təyin.editor düzəldişi istəyə bilər.');
  }

  // Cannot correct a cancelled delivery.
  if (delivery.status === 'CANCELLED') {
    throw badRequest('Ləğv edilmiş çatdırılma düzəltilə bilməz.');
  }

  // No duplicate pending corrections for the same delivery.
  const existing = await prisma.deliveryCorrection.findFirst({
    where: { deliveryId: input.deliveryId, status: DeliveryCorrectionStatus.PENDING },
  });
  if (existing) {
    throw badRequest('Bu çatdırılma üçün gözləmədə düzəlliq artıq var.');
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
    throw forbidden('Yalnız administrator düzəlliklərə baxa bilər.');
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
 * When approved, the delivery's bottleCount is updated and totals recomputed.
 */
export async function reviewCorrection(
  correctionId: string,
  input: { status: 'APPROVED' | 'REJECTED'; reason?: string },
  actor: Actor,
) {
  if (actor.role !== Role.ADMIN) {
    throw forbidden('Yalnız administrator düzəllik təsdiqləyə bilər.');
  }

  const correction = await prisma.deliveryCorrection.findUnique({
    where: { id: correctionId },
    include: { delivery: true },
  });
  if (!correction) throw notFound('Düzəllik tapılmadı.');
  if (correction.status !== DeliveryCorrectionStatus.PENDING) {
    throw badRequest('Bu düzəllik artıq təyin.editor edilib və ya rədd edilib.');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const c = await tx.deliveryCorrection.update({
      where: { id: correctionId },
      data: {
        status: input.status === 'APPROVED' ? DeliveryCorrectionStatus.APPROVED : DeliveryCorrectionStatus.REJECTED,
        approvedById: actor.id,
        approvedAt: new Date(),
      },
      include: { delivery: true },
    });

    if (input.status === 'APPROVED') {
      // Update the delivery's bottleCount. totalAmount = bottleCount * unitPrice
      // is recomputed by recalcDelivery.
      await tx.delivery.update({
        where: { id: correction.deliveryId },
        data: { bottleCount: correction.newBottleCount },
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
  });

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
