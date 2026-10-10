import {
  DeliveryStatus,
  DebtAdjustmentType,
  PaymentMethod,
  Prisma,
  Role,
} from '@prisma/client';
import { prisma } from '../prisma';
import { AppError, badRequest, forbidden, notFound } from '../common/utils/errors';
import { round2 } from '../common/utils/status';
import { audit } from '../common/utils/audit';
import { paginate, serializeDelivery, serializePayment, serializeDebtAdjustment, serializeInventoryTx } from '../common/utils/serialize';
import { resolveRange, DateRangePreset, parseLocalDateInput } from '../common/utils/date';
import { applyInventoryTx, workerKey } from '../inventory/inventory.service';

type PrismaClientLike = Prisma.TransactionClient | typeof prisma;

export interface Actor {
  id: string;
  role: Role;
  fullName: string;
}

/**
 * Recomputes paid / debt / status for a delivery from the immutable money
 * ledger. Status is NEVER accepted from the client - it is always recomputed
 * here, which is what makes "mark as paid without paying" impossible.
 */
export async function recalcDelivery(client: PrismaClientLike, deliveryId: string) {
  const delivery = await client.delivery.findUnique({ where: { id: deliveryId } });
  if (!delivery) throw notFound('Çatdırılma tapılmadı.');
  if (delivery.status === DeliveryStatus.CANCELLED) return delivery;

  const [payments, adjustments] = await Promise.all([
    client.payment.findMany({ where: { deliveryId, voidedAt: null }, select: { amount: true } }),
    client.debtAdjustment.findMany({ where: { deliveryId }, select: { type: true, amount: true } }),
  ]);

  let paid = new Prisma.Decimal(0);
  for (const p of payments) paid = paid.plus(p.amount);
  for (const a of adjustments) {
    paid = a.type === DebtAdjustmentType.INCREASE ? paid.minus(a.amount) : paid.plus(a.amount);
  }
  paid = round2(paid);
  if (paid.isNegative()) paid = new Prisma.Decimal(0);
  if (paid.greaterThan(delivery.totalAmount)) paid = round2(delivery.totalAmount);

  const debt = delivery.totalAmount.minus(paid);
  const status =
    paid.lessThanOrEqualTo(0)
      ? DeliveryStatus.UNPAID
      : paid.greaterThanOrEqualTo(delivery.totalAmount)
        ? DeliveryStatus.PAID
        : DeliveryStatus.PARTIAL;

  return client.delivery.update({
    where: { id: deliveryId },
    data: { paidAmount: paid, debtAmount: debt, status },
  });
}

export interface CreateDeliveryInput {
  idempotencyKey: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  address: string;
  contactPhone?: string;
  bottleCount: number;
  unitPrice: string | number;
  paidAmount?: string | number;
  paymentMethod?: PaymentMethod;
  workerId?: string;
  deliveredAt?: string;
  note?: string;
}

export async function createDelivery(input: CreateDeliveryInput, actor: Actor) {
  if (!input.idempotencyKey) throw badRequest('idempotencyKey tələb olunur.');
  if (!Number.isInteger(input.bottleCount) || input.bottleCount <= 0) {
    throw badRequest('Bidon sayı müsbət tam ədəd olmalıdır.');
  }
  const address = input.address?.trim();
  if (!address) throw badRequest('Çatdırılma ünvanı tələb olunur.');
  if (!input.customerId && !input.customerName?.trim()) {
    throw badRequest('Müştərinin adı və ya müştəri seçilməlidir.');
  }

  const unitPrice = round2(new Prisma.Decimal(input.unitPrice));
  if (unitPrice.isNegative()) throw badRequest('Bir bidonun qiyməti negatif ola bilməz.');

  // Workers always deliver as themselves; an admin may record on someone's behalf.
  const workerId = actor.role === Role.ADMIN && input.workerId ? input.workerId : actor.id;

  const worker = await prisma.user.findUnique({ where: { id: workerId }, select: { id: true, isActive: true } });
  if (!worker) throw notFound('İşçi tapılmadı.');
  if (!worker.isActive) throw badRequest('Bu işçinin hesabı deaktivdir.');

  let deliveredAt = new Date();
  if (input.deliveredAt) {
    try {
      deliveredAt = parseLocalDateInput(input.deliveredAt);
    } catch {
      throw badRequest('Çatdırılma tarixi düzgün deyil.');
    }
    if (deliveredAt.getTime() > Date.now() + 60_000) {
      throw badRequest('Çatdırılma tarixi gələcəkdə ola bilməz.');
    }
  }

  const totalAmount = round2(unitPrice.mul(input.bottleCount));

  let initialPaid = new Prisma.Decimal(input.paidAmount ?? 0);
  if (initialPaid.isNegative()) throw badRequest('Ödənilən məbləğ negatif ola bilməz.');
  initialPaid = round2(initialPaid);
  if (initialPaid.greaterThan(totalAmount)) {
    throw badRequest(
      `Ödənilən məbləğ ümumi məbləğdən (${totalAmount.toFixed(2)}) çox ola bilməz.`,
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    // Idempotency: the same key always returns the same delivery.
    const existing = await tx.delivery.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      const full = await tx.delivery.findUniqueOrThrow({
        where: { id: existing.id },
        include: {
          customer: { select: { id: true, name: true, phone: true, address: true } },
          worker: { select: { id: true, fullName: true, username: true } },
        },
      });
      return { delivery: serializeDelivery(full as never), duplicate: true };
    }

    // ---- resolve customer -------------------------------------------------
    let customerId = input.customerId;
    if (!customerId) {
      const name = input.customerName!.trim();
      const found = await tx.customer.findFirst({
        where: { name: { equals: name, mode: 'insensitive' }, address: { equals: address, mode: 'insensitive' } },
        select: { id: true },
      });
      if (found) {
        customerId = found.id;
        if (input.customerPhone) {
          await tx.customer.updateMany({
            where: { id: customerId, phone: null },
            data: { phone: input.customerPhone },
          });
        }
      } else {
        const created = await tx.customer.create({
          data: { name, address, phone: input.customerPhone ?? null },
          select: { id: true },
        });
        customerId = created.id;
      }
    } else {
      const exists = await tx.customer.findUnique({ where: { id: customerId }, select: { id: true } });
      if (!exists) throw notFound('Müştəri tapılmadı.');
    }

    // ---- create the delivery ---------------------------------------------
    const createdDelivery = await tx.delivery.create({
      data: {
        idempotencyKey: input.idempotencyKey,
        customerId,
        workerId,
        address,
        contactPhone: input.contactPhone ?? null,
        bottleCount: input.bottleCount,
        unitPrice,
        totalAmount,
        paidAmount: new Prisma.Decimal(0),
        debtAmount: totalAmount,
        status: DeliveryStatus.UNPAID,
        deliveredAt,
        note: input.note ?? null,
      },
    });

    // ---- record the real payment collected at delivery time ----------------
    if (initialPaid.greaterThan(0)) {
      await tx.payment.create({
        data: {
          idempotencyKey: `${input.idempotencyKey}:initial`,
          deliveryId: createdDelivery.id,
          customerId,
          workerId,
          amount: initialPaid,
          method: input.paymentMethod ?? PaymentMethod.CASH,
          paidAt: deliveredAt,
          note: 'Çatdırılma zamanı alınan ödəniş',
          recordedById: actor.id,
        },
      });
    }

    // ---- move the bottles out of the worker's hands (atomic + idempotent) --
    await applyInventoryTx(tx, {
      reference: `delivery:${createdDelivery.id}`,
      type: 'OUT_DELIVERY',
      bottleCount: input.bottleCount,
      balanceKey: workerKey(workerId),
      direction: -1,
      workerId,
      deliveryId: createdDelivery.id,
      note: `Çatdırılma #${createdDelivery.id.slice(0, 8)}`,
      occurredAt: deliveredAt,
      createdById: actor.id,
    });

    const updated = await recalcDelivery(tx, createdDelivery.id);

    // Serialise inside the transaction so Decimal columns become plain JSON
    // numbers before the row object leaves this scope.
    return { delivery: serializeDelivery(updated as never), duplicate: false };
  });

  if (!result.duplicate) {
    await audit({
      actorId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.role,
      action: 'delivery.created',
      entityType: 'delivery',
      entityId: (result.delivery as { id: string }).id,
      after: result.delivery,
      meta: { bottleCount: input.bottleCount, totalAmount: totalAmount.toFixed(2) },
    });
  }

  return { delivery: result.delivery, duplicate: result.duplicate };
}

export interface ListDeliveriesQuery {
  workerId?: string;
  customerId?: string;
  status?: DeliveryStatus;
  search?: string;
  preset?: DateRangePreset;
  from?: string;
  to?: string;
  onlyDebts?: boolean;
  page?: number;
  pageSize?: number;
  sortBy?: 'deliveredAt' | 'totalAmount' | 'debtAmount' | 'bottleCount';
  sortDir?: 'asc' | 'desc';
}

export async function listDeliveries(query: ListDeliveriesQuery, actor: Actor) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));
  const { start, end } = resolveRange(query.preset, query.from ? new Date(query.from) : null, query.to ? new Date(query.to) : null);

  // A worker can only ever list their own deliveries.
  const effectiveWorkerId = actor.role === Role.ADMIN ? query.workerId : actor.id;

  const where: Prisma.DeliveryWhereInput = {
    ...(effectiveWorkerId ? { workerId: effectiveWorkerId } : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.onlyDebts ? { debtAmount: { gt: 0 } } : {}),
    ...(start || end
      ? { deliveredAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } }
      : {}),
    ...(query.search
      ? {
          OR: [
            { customer: { name: { contains: query.search, mode: 'insensitive' } } },
            { address: { contains: query.search, mode: 'insensitive' } },
            { contactPhone: { contains: query.search } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.DeliveryOrderByWithRelationInput =
    query.sortBy && query.sortDir
      ? { [query.sortBy]: query.sortDir }
      : { deliveredAt: 'desc' };

  const [rows, total] = await Promise.all([
    prisma.delivery.findMany({
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        customer: { select: { id: true, name: true, phone: true, address: true } },
        worker: { select: { id: true, fullName: true, username: true } },
      },
    }),
    prisma.delivery.count({ where }),
  ]);

  return paginate(rows.map(serializeDelivery), total, page, pageSize);
}

export async function getDeliveryDetail(id: string, actor: Actor) {
  const delivery = await prisma.delivery.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, phone: true, address: true } },
      worker: { select: { id: true, fullName: true, username: true } },
      payments: {
        orderBy: { paidAt: 'desc' },
        include: { recordedBy: { select: { id: true, fullName: true } } },
      },
      debtsAdj: {
        orderBy: { createdAt: 'desc' },
        include: { createdBy: { select: { id: true, fullName: true } } },
      },
      inventory: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!delivery) throw notFound('Çatdırılma tapılmadı.');

  const isOwner = delivery.workerId === actor.id;
  if (actor.role !== Role.ADMIN && !isOwner) {
    // A worker may only open deliveries they own.
    throw forbidden('Bu çatdırılma sizin hesabınıza aid deyil.');
  }

  return {
    ...serializeDelivery(delivery as never),
    payments: delivery.payments.map(serializePayment),
    debtAdjustments: delivery.debtsAdj.map(serializeDebtAdjustment),
    inventoryTransactions: delivery.inventory.map(serializeInventoryTx),
  };
}

export async function cancelDelivery(id: string, reason: string, actor: Actor, req?: never) {
  if (actor.role !== Role.ADMIN) throw forbidden('Yalnız administrator çatdırılmanı ləğv edə bilər.');

  const beforeRow = await prisma.delivery.findUnique({ where: { id } });
  if (!beforeRow) throw notFound('Çatdırılma tapılmadı.');

  return prisma.$transaction(async (tx) => {
    const delivery = await tx.delivery.findUnique({ where: { id } });
    if (!delivery) throw notFound('Çatdırılma tapılmadı.');
    if (delivery.status === DeliveryStatus.CANCELLED) {
      return serializeDelivery(delivery as never);
    }

    if (delivery.paidAmount.greaterThan(0)) {
      throw new AppError(
        409,
        'Ödəniş alınmış çatdırılma ləğv edilə bilməz. Əvvəlcə ödənişi geri qaytarın (void).',
        'HAS_PAYMENTS',
      );
    }

    // Return the bottles to the worker's hands so the stock stays truthful.
    await applyInventoryTx(tx, {
      reference: `delivery:cancel:${delivery.id}`,
      type: 'RETURN_TO_STOCK',
      bottleCount: delivery.bottleCount,
      balanceKey: workerKey(delivery.workerId),
      direction: 1,
      workerId: delivery.workerId,
      deliveryId: delivery.id,
      note: `Çatdırılma ləğv edildi: ${reason}`,
      createdById: actor.id,
    });

    const cancelled = await tx.delivery.update({
      where: { id },
      data: {
        status: DeliveryStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelledById: actor.id,
        cancelReason: reason,
        debtAmount: new Prisma.Decimal(0),
      },
    });

    return serializeDelivery(cancelled as never);
  }).then((serialized) => {
    // Audit after commit so the log can never claim a change that rolled back.
    void audit({
      actorId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.role,
      action: 'delivery.cancelled',
      entityType: 'delivery',
      entityId: id,
      before: serializeDelivery(beforeRow as never),
      after: serialized,
      meta: { reason },
      req,
    });
    return serialized;
  });
}

export async function updateDelivery(
  id: string,
  patch: { address?: string; note?: string; bottleCount?: number; unitPrice?: string | number; reason: string },
  actor: Actor,
  req?: never,
) {
  if (actor.role !== Role.ADMIN) throw forbidden('Yalnız administrator çatdırılmanı redaktə edə bilər.');

  const before = await prisma.delivery.findUnique({ where: { id } });
  if (!before) throw notFound('Çatdırılma tapılmadı.');
  if (before.status === DeliveryStatus.CANCELLED) throw badRequest('Ləğv edilmiş çatdırılma dəyişdirilə bilməz.');

  return prisma.$transaction(async (tx) => {
    const data: Prisma.DeliveryUpdateInput = { address: patch.address ?? before.address, note: patch.note ?? before.note };

    if (patch.unitPrice !== undefined) {
      const unitPrice = round2(new Prisma.Decimal(patch.unitPrice));
      if (unitPrice.isNegative()) throw badRequest('Qiymət negatif ola bilməz.');
      data.unitPrice = unitPrice;
    }

    let bottleDelta = 0;
    if (patch.bottleCount !== undefined && patch.bottleCount !== before.bottleCount) {
      if (!Number.isInteger(patch.bottleCount) || patch.bottleCount <= 0) {
        throw badRequest('Bidon sayı müsbət tam ədəd olmalıdır.');
      }
      data.bottleCount = patch.bottleCount;
      bottleDelta = patch.bottleCount - before.bottleCount;
    }

    // NOTE: the owning worker is intentionally immutable. Reassigning it would
    // misattribute both the stock movement and the collected cash, so an admin
    // must cancel and re-record instead.

    // Resolve from the local values rather than the loose update-input type.
    const finalUnitPrice =
      patch.unitPrice !== undefined ? round2(new Prisma.Decimal(patch.unitPrice)) : before.unitPrice;
    const finalBottleCount = patch.bottleCount ?? before.bottleCount;
    data.totalAmount = round2(finalUnitPrice.mul(finalBottleCount));

    if (bottleDelta > 0) {
      await applyInventoryTx(tx, {
        reference: `delivery:adjust-up:${id}:${bottleDelta}`,
        type: 'OUT_DELIVERY',
        bottleCount: bottleDelta,
        balanceKey: workerKey(before.workerId),
        direction: -1,
        workerId: before.workerId,
        deliveryId: id,
        note: 'Administrator tərəfindən bidon sayı artırıldı',
        createdById: actor.id,
      });
    } else if (bottleDelta < 0) {
      await applyInventoryTx(tx, {
        reference: `delivery:adjust-down:${id}:${Math.abs(bottleDelta)}`,
        type: 'RETURN_TO_STOCK',
        bottleCount: Math.abs(bottleDelta),
        balanceKey: workerKey(before.workerId),
        direction: 1,
        workerId: before.workerId,
        deliveryId: id,
        note: 'Administrator tərəfindən bidon sayı azaldıldı',
        createdById: actor.id,
      });
    }

    await tx.delivery.update({ where: { id }, data });
    const updated = await recalcDelivery(tx, id);
    const serialized = serializeDelivery(updated as never);

    await audit({
      actorId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.role,
      action: 'delivery.updated',
      entityType: 'delivery',
      entityId: id,
      before: serializeDelivery(before as never),
      after: serialized,
      meta: { reason: patch.reason, bottleDelta },
      req,
    });
    return serialized;
  });
}
