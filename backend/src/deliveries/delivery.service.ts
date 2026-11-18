import {
  DeliveryStatus,
  DebtAdjustmentType,
  DestinationType,
  PaymentMethod,
  Prisma,
  Role,
  WaterType,
  WorkerType,
} from '@prisma/client';
import { prisma } from '../prisma';
import { AppError, badRequest, forbidden, notFound } from '../common/utils/errors';
import { round2 } from '../common/utils/status';
import { audit } from '../common/utils/audit';
import { paginate, serializeDelivery, serializePayment, serializeDebtAdjustment, serializeInventoryTx } from '../common/utils/serialize';
import { resolveRange, DateRangePreset, parseLocalDateInput } from '../common/utils/date';
import { applyInventoryTx, warehouseKey, workerKey } from '../inventory/inventory.service';
import { resolveSalePrice } from '../prices/prices.service';
import { createNotification } from '../notifications/notification.service';
import { newIdempotencyKey } from '../auth/tokens';

type PrismaClientLike = Prisma.TransactionClient | typeof prisma;

export interface Actor {
  id: string;
  role: Role;
  fullName: string;
  /** null for ADMIN and legacy rows; WAREHOUSE_KEEPER or REGULAR for workers. */
  workerType?: WorkerType | null;
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
  address?: string;
  contactPhone?: string;
  waterType?: WaterType;
  destinationType?: DestinationType;
  companyId?: string;
  officeId?: string;
  bottleCount: number;
  workerId?: string;
  deliveredAt?: string;
  note?: string;
}

/**
 * The price of one bottle, decided by the server and never by the client.
 *
 * A company delivery is self-pricing: the company holds a contract price per
 * water type, so the amount cannot be argued with in the field. A home delivery
 * uses the company's own sale price for that water type (`WaterPrice`), which
 * only an admin can change; if no price is set it is 0 and the admin can still
 * correct the single delivery afterwards - see `updateDelivery`.
 */
function resolveUnitPrice(
  destinationType: DestinationType,
  waterType: WaterType,
  company: { filteredPrice: Prisma.Decimal; springPrice: Prisma.Decimal } | null,
  homePrice: Prisma.Decimal,
): Prisma.Decimal {
  if (destinationType === DestinationType.COMPANY && company) {
    return waterType === WaterType.SPRING ? round2(company.springPrice) : round2(company.filteredPrice);
  }
  return round2(homePrice);
}

export async function createDelivery(input: CreateDeliveryInput, actor: Actor) {
  if (!input.idempotencyKey) throw badRequest('idempotencyKey tələb olunur.');
  if (!Number.isInteger(input.bottleCount) || input.bottleCount <= 0) {
    throw badRequest('Bidon sayı müsbət tam ədəd olmalıdır.');
  }

  const waterType = input.waterType ?? WaterType.FILTERED;
  const destinationType = input.destinationType ?? DestinationType.HOME;

  // ---- resolve the destination ------------------------------------------
  // A company delivery is identified by company + office, not by a typed
  // address: the office name is the address. Recording both would let the two
  // disagree, and every report grouped by office would then be wrong.
  let companyId: string | null = null;
  let officeId: string | null = null;
  let address: string;
  let company: { id: string; name: string; filteredPrice: Prisma.Decimal; springPrice: Prisma.Decimal } | null = null;

  if (destinationType === DestinationType.COMPANY) {
    if (!input.companyId || !input.officeId) {
      throw badRequest('Şirkətə çatdırılmada şirkət və ofis seçilməlidir.');
    }
    const office = await prisma.office.findUnique({
      where: { id: input.officeId },
      include: { company: { select: { id: true, name: true, isActive: true, filteredPrice: true, springPrice: true } } },
    });
    if (!office) throw notFound('Ofis tapılmadı.');
    if (!office.isActive) throw badRequest('Bu ofis artıq fəaliyyət göstərmir.');
    if (office.companyId !== input.companyId) {
      throw badRequest('Seçilmiş ofis seçilmiş şirkətə aid deyil.');
    }
    if (!office.company.isActive) throw badRequest('Bu şirkət artıq fəaliyyət göstərmir.');
    companyId = office.company.id;
    officeId = office.id;
    address = `${office.company.name} - ${office.name}`;
    company = office.company;
  } else {
    address = input.address?.trim() ?? '';
    if (address.length < 3) throw badRequest('Evə çatdırılmada ünvan ən azı 3 simvol olmalıdır.');
    // Only a home delivery has a customer to name. For a company the customer
    // is derived from the company below.
    if (!input.customerId && !input.customerName?.trim()) {
      throw badRequest('Müştərinin adı və ya müştəri seçilməlidir.');
    }
  }

  // ---- price: server-decided --------------------------------------------
  // Home deliveries use the company sale price for this water type; a company
  // drop keeps its contract price.
  const homePrice = await resolveSalePrice(waterType);
  const unitPrice = resolveUnitPrice(destinationType, waterType, company, homePrice);

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

  const result = await prisma.$transaction(async (tx) => {
    // Idempotency: the same key always returns the same delivery.
    const existing = await tx.delivery.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      const full = await tx.delivery.findUniqueOrThrow({
        where: { id: existing.id },
        include: {
          customer: { select: { id: true, name: true, phone: true, address: true } },
          worker: { select: { id: true, fullName: true, username: true } },
          company: { select: { id: true, name: true } },
          office: { select: { id: true, name: true } },
        },
      });
      return { delivery: serializeDelivery(full as never), duplicate: true, stockAfter: null as number | null };
    }

    // ---- resolve customer -------------------------------------------------
    let customerId = input.customerId;
    if (!customerId && destinationType === DestinationType.COMPANY) {
      // A company delivery names a company, not a person, so the form asks for
      // no customer at all. Attach the company itself: every report, debt view
      // and invoice already reads through this relation, and a company drop
      // still has to appear in them.
      const companyCustomer = await tx.customer.findFirst({
        where: { name: { equals: company!.name, mode: 'insensitive' }, address: { equals: address, mode: 'insensitive' } },
        select: { id: true },
      });
      customerId = companyCustomer
        ? companyCustomer.id
        : (await tx.customer.create({ data: { name: company!.name, address }, select: { id: true } })).id;
    } else if (!customerId) {
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
        waterType,
        destinationType,
        companyId,
        officeId,
        bottleCount: input.bottleCount,
        unitPrice,
        totalAmount,
        // Always starts unpaid. The worker neither collects nor declares money;
        // the admin records what was actually received. A delivery that began
        // as PAID would be indistinguishable from one nobody ever paid for.
        paidAmount: new Prisma.Decimal(0),
        debtAmount: totalAmount,
        status: DeliveryStatus.UNPAID,
        deliveredAt,
        note: input.note ?? null,
      },
    });

    // ---- move the bottles out of the worker's hands (atomic + idempotent) --
    const stockResult = await applyInventoryTx(tx, {
      reference: `delivery:${createdDelivery.id}`,
      type: 'OUT_DELIVERY',
      waterType: waterType,
      bottleCount: input.bottleCount,
      balanceKey: workerKey(workerId, waterType),
      direction: -1,
      workerId,
      deliveryId: createdDelivery.id,
      note: `Çatdırılma #${createdDelivery.id.slice(0, 8)}`,
      occurredAt: deliveredAt,
      createdById: actor.id,
    });

    const updated = await recalcDelivery(tx, createdDelivery.id);

    // recalcDelivery returns the bare row. A POST answer should carry the same
    // shape as a GET: without the relations the caller gets back a delivery with
    // no customer name and, for a company drop, no office name - the very two
    // fields it just supplied.
    const withRelations = await tx.delivery.findUniqueOrThrow({
      where: { id: updated.id },
      include: {
        customer: { select: { id: true, name: true, phone: true, address: true } },
        worker: { select: { id: true, fullName: true, username: true } },
        company: { select: { id: true, name: true } },
        office: { select: { id: true, name: true } },
      },
    });

    // Serialise inside the transaction so Decimal columns become plain JSON
    // numbers before the row object leaves this scope.
    return { delivery: serializeDelivery(withRelations as never), duplicate: false, stockAfter: stockResult.newBalance };
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
      meta: {
        bottleCount: input.bottleCount,
        totalAmount: totalAmount.toFixed(2),
        waterType,
        destinationType,
        companyId,
        officeId,
      },
    });

    // The worker's hand stock just dropped by this delivery. Admins watch
    // every balance movement, so they see the before and after here too.
    await createNotification({
      userId: actor.id,
      actorId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.role,
      action: 'OUT_DELIVERY',
      waterType,
      bottleCount: input.bottleCount,
      beforeBalance: (result.stockAfter ?? 0) + input.bottleCount,
      afterBalance: result.stockAfter ?? 0,
      note: `Çatdırılma #${(result.delivery as { id: string }).id.slice(0, 8)}`,
      relatedId: (result.delivery as { id: string }).id,
    });
  }

  return { delivery: result.delivery, duplicate: result.duplicate };
}

export interface ListDeliveriesQuery {
  workerId?: string;
  customerId?: string;
  status?: DeliveryStatus;
  waterType?: WaterType;
  destinationType?: DestinationType;
  companyId?: string;
  officeId?: string;
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
    ...(query.waterType ? { waterType: query.waterType } : {}),
    ...(query.destinationType ? { destinationType: query.destinationType } : {}),
    ...(query.companyId ? { companyId: query.companyId } : {}),
    ...(query.officeId ? { officeId: query.officeId } : {}),
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
            { office: { name: { contains: query.search, mode: 'insensitive' } } },
            { company: { name: { contains: query.search, mode: 'insensitive' } } },
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
        company: { select: { id: true, name: true } },
        office: { select: { id: true, name: true } },
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
      company: { select: { id: true, name: true } },
      office: { select: { id: true, name: true } },
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

  // Filled inside the transaction, read after commit: the notification must
  // only exist if the cancellation really moved bottles.
  const stock = { after: null as number | null };

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
    const applied = await applyInventoryTx(tx, {
      reference: `delivery:cancel:${delivery.id}`,
      type: 'RETURN_TO_STOCK',
      waterType: delivery.waterType,
      bottleCount: delivery.bottleCount,
      balanceKey: workerKey(delivery.workerId, delivery.waterType),
      direction: 1,
      workerId: delivery.workerId,
      deliveryId: delivery.id,
      note: `Çatdırılma ləğv edildi: ${reason}`,
      createdById: actor.id,
    });
    stock.after = applied.newBalance;

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
  }).then(async (serialized) => {
    // Audit after commit so the log can never claim a change that rolled back.
    await audit({
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

    if (stock.after !== null) {
      await createNotification({
        userId: actor.id,
        actorId: actor.id,
        actorName: actor.fullName,
        actorRole: actor.role,
        action: 'RETURN_TO_STOCK',
        waterType: beforeRow.waterType,
        bottleCount: beforeRow.bottleCount,
        // The bottles came back to the worker, so the balance rose by the count.
        beforeBalance: stock.after - beforeRow.bottleCount,
        afterBalance: stock.after,
        note: `Çatdırılma ləğv edildi: ${reason}`,
        relatedId: id,
      });
    }
    return serialized;
  });
}

export async function updateDelivery(
  id: string,
  patch: {
    address?: string;
    note?: string;
    bottleCount?: number;
    unitPrice?: string | number;
    /** The money the admin says was actually collected. See below. */
    paidAmount?: string | number;
    /** Optional. The ledger keys the correction; a reason is a courtesy. */
    reason?: string;
  },
  actor: Actor,
  req?: never,
) {
  if (actor.role !== Role.ADMIN) throw forbidden('Yalnız administrator çatdırılmanı redaktə edə bilər.');

  const before = await prisma.delivery.findUnique({ where: { id } });
  if (!before) throw notFound('Çatdırılma tapılmadı.');
  if (before.status === DeliveryStatus.CANCELLED) throw badRequest('Ləğv edilmiş çatdırılma dəyişdirilə bilməz.');

  // Filled inside the transaction when bottles actually move; read after commit.
  const stock = { after: null as number | null };
  const appliedDelta =
    patch.bottleCount !== undefined && patch.bottleCount !== before.bottleCount
      ? patch.bottleCount - before.bottleCount
      : 0;

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
    const finalTotal = round2(finalUnitPrice.mul(finalBottleCount));
    data.totalAmount = finalTotal;

    // debt_amount must move in the SAME statement as total_amount. The table
    // carries `CHECK (debt_amount = total_amount - paid_amount)`, so updating
    // only the total leaves the row momentarily inconsistent and PostgreSQL
    // rejects it. `paidAmount` is untouched here, so this is exactly the
    // identity recalcDelivery is about to re-derive from the ledger.
    if (!finalTotal.equals(before.totalAmount)) {
      data.debtAmount = finalTotal.minus(before.paidAmount);
    }

    // Claim the row first with an optimistic check on bottleCount. If a second
    // admin saved the same delivery between the read above and here, this hits
    // zero rows, so we abort BEFORE moving any bottles. Without it, two
    // concurrent edits carrying the same delta would deduct twice while the
    // delivery only moved once.
    const claimed = await tx.delivery.updateMany({
      where: { id, bottleCount: before.bottleCount },
      data,
    });
    if (claimed.count === 0) {
      throw new AppError(
        409,
        'Çatdırılma bu arada başqa istifadəçi tərəfindən dəyişdirildi. Yenidən yoxlayın.',
        'CONCURRENT_UPDATE',
      );
    }

    if (bottleDelta > 0) {
      const applied = await applyInventoryTx(tx, {
        // A fresh reference per actual movement: a revisiting edit such as
        // 10 -> 12 -> 14 -> 12 -> 14 must still move bottles on the last step.
        // A retry of the same request sees the new count already saved, so its
        // delta is zero and no second movement is written.
        reference: `delivery:adjust-up:${id}:${newIdempotencyKey()}`,
        type: 'OUT_DELIVERY',
        waterType: before.waterType,
        bottleCount: bottleDelta,
        balanceKey: workerKey(before.workerId, before.waterType),
        direction: -1,
        workerId: before.workerId,
        deliveryId: id,
        note: 'Administrator tərəfindən bidon sayı artırıldı',
        createdById: actor.id,
      });
      stock.after = applied.newBalance;
    } else if (bottleDelta < 0) {
      const applied = await applyInventoryTx(tx, {
        reference: `delivery:adjust-down:${id}:${newIdempotencyKey()}`,
        type: 'RETURN_TO_STOCK',
        waterType: before.waterType,
        bottleCount: Math.abs(bottleDelta),
        balanceKey: workerKey(before.workerId, before.waterType),
        direction: 1,
        workerId: before.workerId,
        deliveryId: id,
        note: 'Administrator tərəfindən bidon sayı azaldıldı',
        createdById: actor.id,
      });
      stock.after = applied.newBalance;
    }

    let updated = await recalcDelivery(tx, id);

    // ---- the admin states how much was actually collected -------------------
    // This writes a real payment row rather than editing `paidAmount`, so the
    // money ledger stays the single source of truth and revenue keeps meaning
    // "cash that arrived". Setting a different figure voids the previous entry
    // and records the correction with the admin's reason attached, which is
    // what makes the change auditable instead of a silent number edit.
    if (patch.paidAmount !== undefined) {
      const target = round2(new Prisma.Decimal(patch.paidAmount));
      if (target.isNegative()) throw badRequest('Ödənilən məbləğ negatif ola bilməz.');
      if (target.greaterThan(updated.totalAmount)) {
        throw badRequest(
          `Ödənilən məbləğ ümumi məbləğdən (${updated.totalAmount.toFixed(2)}) çox ola bilməz.`,
        );
      }

      const existing = await tx.payment.findMany({ where: { deliveryId: id, voidedAt: null } });
      const nowPaid = existing.reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
      // A blank reason is fine; the ledger already says who changed what and
      // when, and an invented excuse would be worse than none.
      const reason = patch.reason?.trim() || 'Qiymət / ödəniş düzəlişi';

      if (!target.equals(nowPaid)) {
        for (const p of existing) {
          await tx.payment.update({
            where: { id: p.id },
            data: { voidedAt: new Date(), voidedById: actor.id, voidReason: reason },
          });
        }
        if (target.greaterThan(0)) {
          await tx.payment.create({
            data: {
              // The delivery id plus the new amount makes a retry of this exact
              // correction a no-op rather than a second payment.
              idempotencyKey: `delivery:paid:${id}:${target.toFixed(2)}`,
              deliveryId: id,
              customerId: before.customerId,
              workerId: before.workerId,
              amount: target,
              method: PaymentMethod.CASH,
              paidAt: new Date(),
              note: `Administrator tərəfindən düzəldildi: ${reason}`,
              recordedById: actor.id,
            },
          });
        }
      }
      updated = await recalcDelivery(tx, id);
    }

    const serialized = serializeDelivery(updated as never);

    await audit({
      actorId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.role,
      action: patch.paidAmount !== undefined ? 'delivery.payment_corrected' : 'delivery.updated',
      entityType: 'delivery',
      entityId: id,
      before: serializeDelivery(before as never),
      after: serialized,
      meta: { reason: patch.reason?.trim() || null, bottleDelta, paidAmountSet: patch.paidAmount },
      req,
    });
    return serialized;
  }).then(async (serialized) => {
    // A bottle-count correction moves bottles into or out of the worker's
    // hands. The admin watching the warehouse sees that movement like any
    // other, with the balance before and after it.
    if (stock.after !== null && appliedDelta !== 0) {
      await createNotification({
        userId: actor.id,
        actorId: actor.id,
        actorName: actor.fullName,
        actorRole: actor.role,
        action: appliedDelta > 0 ? 'OUT_DELIVERY' : 'RETURN_TO_STOCK',
        waterType: before.waterType,
        bottleCount: Math.abs(appliedDelta),
        beforeBalance: (stock.after as number) + appliedDelta,
        afterBalance: stock.after as number,
        note:
          appliedDelta > 0
            ? 'Çatdırılma bidon sayı artırıldı'
            : 'Çatdırılma bidon sayı azaldıldı',
        relatedId: id,
      });
    }
    return serialized;
  });
}
