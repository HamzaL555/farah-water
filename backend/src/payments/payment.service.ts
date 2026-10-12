import { DeliveryStatus, PaymentMethod, Prisma, Role } from '@prisma/client';
import { prisma } from '../prisma';
import { badRequest, forbidden, notFound } from '../common/utils/errors';
import { round2 } from '../common/utils/status';
import { audit } from '../common/utils/audit';
import { paginate, serializePayment } from '../common/utils/serialize';
import { resolveRange, DateRangePreset, parseLocalDateInput } from '../common/utils/date';
import { recalcDelivery, Actor } from '../deliveries/delivery.service';

export interface CreatePaymentInput {
  idempotencyKey: string;
  deliveryId: string;
  amount: string | number;
  method?: PaymentMethod;
  paidAt?: string;
  note?: string;
  /** Admins may record an overpayment; workers may not. */
  allowOverpayment?: boolean;
}

/**
 * Records real cash received against a delivery.
 *
 * ADMIN ONLY. A worker no longer records payments: they deliver, and the
 * admin decides what was collected and enters it. Letting the driver mark
 * their own delivery paid meant the revenue figure was whatever the person
 * carrying the money said it was, which is the one number an owner cannot
 * audit from the outside.
 *
 * - `idempotencyKey` is UNIQUE: replaying the same request (e.g. an offline
 *   queue retry) returns the original payment instead of double-counting it.
 * - Payment status/debt are recomputed from the ledger, never set by the client.
 */
export async function createPayment(input: CreatePaymentInput, actor: Actor, req?: never) {
  if (!input.idempotencyKey) throw badRequest('idempotencyKey tələb olunur.');
  if (actor.role !== Role.ADMIN) {
    throw forbidden('Ödənişi yalnız administrator qeyd edə bilər.');
  }

  const amount = round2(new Prisma.Decimal(input.amount ?? 0));
  if (!amount.greaterThan(0)) throw badRequest('Ödəniş məbləği sıfırdan böyük olmalıdır.');

  let paidAt = new Date();
  if (input.paidAt) {
    try {
      paidAt = parseLocalDateInput(input.paidAt);
    } catch {
      throw badRequest('Ödəniş tarixi düzgün deyil.');
    }
    if (paidAt.getTime() > Date.now() + 60_000) throw badRequest('Ödəniş tarixi gələcəkdə ola bilməz.');
  }

  // Idempotent short-circuit before any permission/validation work.
  const already = await prisma.payment.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: { recordedBy: { select: { id: true, fullName: true } } },
  });
  if (already) return { payment: already, duplicate: true };

  const delivery = await prisma.delivery.findUnique({ where: { id: input.deliveryId } });
  if (!delivery) throw notFound('Çatdırılma tapılmadı.');
  if (delivery.status === DeliveryStatus.CANCELLED) {
    throw badRequest('Ləğv edilmiş çatdırılma üçün ödəniş qeydə alına bilməz.');
  }

  // Guards against inflating revenue beyond what the customer actually owes.
  const outstanding = delivery.totalAmount.minus(delivery.paidAmount);
  if (amount.greaterThan(outstanding) && !input.allowOverpayment) {
    throw badRequest(
      `Bu çatdırılmanın qalan borcu ${outstanding.toFixed(2)} AZN-dir. Bu məbləğdən artıq ödəniş qeydə alına bilməz.`,
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    let payment;
    try {
      payment = await tx.payment.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          deliveryId: delivery.id,
          customerId: delivery.customerId,
          workerId: delivery.workerId,
          amount,
          method: input.method ?? PaymentMethod.CASH,
          paidAt,
          note: input.note ?? null,
          recordedById: actor.id,
        },
        include: { recordedBy: { select: { id: true, fullName: true } } },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw badRequest('Bu ödəniş artıq qeydə alınıb (təkrar cəhd).');
      }
      throw err;
    }
    await recalcDelivery(tx, delivery.id);
    return payment;
  });

  await audit({
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'payment.created',
    entityType: 'payment',
    entityId: result.id,
    after: serializePayment(result),
    meta: { deliveryId: delivery.id, amount: amount.toFixed(2), method: result.method },
    req,
  });

  return { payment: result, duplicate: false };
}

/**
 * Voids (never deletes) a payment. Admin-only. The delivery is then
 * recalculated from the remaining ledger so the debt comes back accurately.
 */
export async function voidPayment(paymentId: string, reason: string, actor: Actor, req?: never) {
  if (actor.role !== Role.ADMIN) throw forbidden('Yalnız administrator ödənişi geri qaytara bilər.');
  if (!reason?.trim()) throw badRequest('Geri qaytarma səbəbi yazılmalıdır.');

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw notFound('Ödəniş tapılmadı.');
    if (payment.voidedAt) throw badRequest('Bu ödəniş artıq geri qaytarılıb.');

    const voided = await tx.payment.update({
      where: { id: paymentId },
      data: { voidedAt: new Date(), voidedById: actor.id, voidReason: reason },
      include: { recordedBy: { select: { id: true, fullName: true } } },
    });
    const delivery = await recalcDelivery(tx, payment.deliveryId);
    return { payment: voided, delivery };
  });

  await audit({
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'payment.voided',
    entityType: 'payment',
    entityId: paymentId,
    before: serializePayment(result.payment as never),
    meta: { reason, deliveryId: result.payment.deliveryId },
    req,
  });

  return result.payment;
}

export interface ListPaymentsQuery {
  deliveryId?: string;
  workerId?: string;
  customerId?: string;
  method?: PaymentMethod;
  preset?: DateRangePreset;
  from?: string;
  to?: string;
  search?: string;
  includeVoided?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listPayments(query: ListPaymentsQuery, actor: Actor) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));
  const { start, end } = resolveRange(query.preset, query.from ? new Date(query.from) : null, query.to ? new Date(query.to) : null);

  const effectiveWorkerId = actor.role === Role.ADMIN ? query.workerId : actor.id;

  const where: Prisma.PaymentWhereInput = {
    ...(effectiveWorkerId ? { workerId: effectiveWorkerId } : {}),
    ...(query.deliveryId ? { deliveryId: query.deliveryId } : {}),
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.method ? { method: query.method } : {}),
    // Voided payments stay visible in history but never count toward revenue.
    ...(query.includeVoided ? {} : { voidedAt: null }),
    ...(start || end ? { paidAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
    ...(query.search
      ? {
          OR: [
            { customer: { name: { contains: query.search, mode: 'insensitive' } } },
            { delivery: { address: { contains: query.search, mode: 'insensitive' } } },
            { note: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [rows, total, sum] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { paidAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        recordedBy: { select: { id: true, fullName: true } },
        customer: { select: { id: true, name: true } },
      },
    }),
    prisma.payment.count({ where }),
    prisma.payment.aggregate({ where, _sum: { amount: true } }),
  ]);

  return {
    ...paginate(rows.map(serializePayment), total, page, pageSize),
    totalAmount: Number((sum._sum.amount ?? new Prisma.Decimal(0)).toFixed(2)),
  };
}

/** Full, append-only payment history for one delivery. */
export async function paymentHistoryForDelivery(deliveryId: string, actor: Actor) {
  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    select: { id: true, workerId: true },
  });
  if (!delivery) throw notFound('Çatdırılma tapılmadı.');
  if (actor.role !== Role.ADMIN && delivery.workerId !== actor.id) {
    throw forbidden('Bu çatdırılma sizin hesabınıza aid deyil.');
  }
  const rows = await prisma.payment.findMany({
    where: { deliveryId },
    orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
    include: { recordedBy: { select: { id: true, fullName: true } } },
  });
  return rows.map(serializePayment);
}
