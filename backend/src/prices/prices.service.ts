import { Prisma, PriceRequestStatus, Role, WaterType } from '@prisma/client';
import { prisma } from '../prisma';
import { badRequest, conflict, forbidden, notFound } from '../common/utils/errors';
import { audit } from '../common/utils/audit';
import {
  paginate,
  serializePrice,
  serializePriceHistory,
  serializePriceRequest,
} from '../common/utils/serialize';
import { resolveRange, DateRangePreset } from '../common/utils/date';
import { money, moneyOut, round2 } from '../common/utils/money';
import { createNotification } from '../notifications/notification.service';
import type { Actor } from '../deliveries/delivery.service';

const WATER_LABEL: Record<WaterType, string> = {
  FILTERED: 'Filtr suyu',
  SPRING: 'Bulaq suyu',
};

/** Reads one current price, defaulting to zero if the row was never created. */
export async function resolveSalePrice(waterType: WaterType, tx?: Prisma.TransactionClient): Promise<Prisma.Decimal> {
  const db = tx ?? prisma;
  const row = await db.waterPrice.findUnique({ where: { waterType }, select: { price: true } });
  return round2(row?.price ?? 0);
}

/**
 * Both sale prices, split by water type. Any signed-in user may read them: a
 * worker must quote the price to a customer, and only an admin can change it.
 */
export async function getPrices() {
  const rows = await prisma.waterPrice.findMany({
    include: { updatedBy: { select: { id: true, fullName: true } } },
  });
  const byType = new Map(rows.map((r) => [r.waterType, r]));

  return (Object.keys(WATER_LABEL) as WaterType[]).map((waterType) => {
    const row = byType.get(waterType);
    return serializePrice({
      waterType,
      price: row?.price ?? new Prisma.Decimal(0),
      effectiveFrom: row?.effectiveFrom,
      updatedAt: row?.updatedAt,
      updatedBy: row?.updatedBy ?? null,
    });
  });
}

/**
 * Direct price change by an admin. Every change appends to `price_history`
 * inside the same transaction, so the price row and its audit trail can never
 * disagree.
 */
export async function updatePrice(
  waterType: WaterType,
  rawPrice: number | string,
  note: string | null,
  actor: Actor,
  req?: never,
) {
  if (actor.role !== Role.ADMIN) {
    throw forbidden('Qiyməti yalnız administrator dəyişə bilər. İşçi təsdiq sorğusu göndərə bilər.');
  }
  const price = round2(money(rawPrice));
  if (price.isNegative()) throw badRequest('Qiymət mənfi ola bilməz.');

  const outcome = await prisma.$transaction(async (tx) => {
    const current = await tx.waterPrice.findUnique({ where: { waterType }, select: { price: true } });
    const oldPrice = round2(current?.price ?? 0);

    if (oldPrice.equals(price)) {
      return { changed: false as const, oldPrice, row: null };
    }

    const row = await tx.waterPrice.upsert({
      where: { waterType },
      update: { price, updatedById: actor.id, effectiveFrom: new Date() },
      create: { waterType, price, updatedById: actor.id },
    });

    const history = await tx.priceHistory.create({
      data: {
        waterType,
        oldPrice,
        newPrice: price,
        source: 'ADMIN',
        note: note?.trim() || null,
        changedById: actor.id,
      },
    });

    return { changed: true as const, oldPrice, row, history };
  });

  if (outcome.changed) {
    await createNotification({
      actorId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.role,
      kind: 'PRICE',
      action: 'PRICE_CHANGED',
      title: 'Qiymət dəyişdirildi',
      message: `${WATER_LABEL[waterType]}: ${moneyOut(outcome.oldPrice).toFixed(2)} → ${moneyOut(price).toFixed(2)} AZN.`,
      note: note?.trim() || null,
      relatedId: outcome.history!.id,
    });

    await audit({
      actorId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.role,
      action: 'price.changed',
      entityType: 'water_price',
      entityId: outcome.row!.id,
      before: { waterType, price: moneyOut(outcome.oldPrice) },
      after: { waterType, price: moneyOut(price) },
      meta: { note: note ?? null, source: 'ADMIN' },
      req,
    });
  }

  return {
    changed: outcome.changed,
    waterType,
    price: moneyOut(price),
    oldPrice: moneyOut(outcome.oldPrice),
    historyId: outcome.changed ? outcome.history!.id : null,
  };
}

/**
 * A worker asks for a new price. It changes nothing until an admin approves;
 * the request itself is history and cannot be edited afterwards.
 */
export async function requestPriceChange(
  waterType: WaterType,
  rawPrice: number | string,
  reason: string,
  actor: Actor,
  req?: never,
) {
  if (actor.role !== Role.WORKER) {
    throw forbidden('Administrator qiyməti birbaşa dəyişir; sorğu yalnız işçi üçündür.');
  }
  const newPrice = round2(money(rawPrice));
  if (newPrice.isNegative()) throw badRequest('Qiymət mənfi ola bilməz.');
  if (!reason?.trim()) throw badRequest('Səbəb yazılmalıdır.');

  const current = await resolveSalePrice(waterType);
  if (current.equals(newPrice)) throw badRequest('Təklif olunan qiymət mövcud qiymətlə eynidir.');

  const pending = await prisma.priceChangeRequest.findFirst({
    where: { waterType, requestedById: actor.id, status: PriceRequestStatus.PENDING },
    select: { id: true },
  });
  if (pending) {
    throw conflict('Bu su növü üçün artıq gözləyən qiymət sorğunuz var. Administratorun cavabını gözləyin.');
  }

  const request = await prisma.priceChangeRequest.create({
    data: {
      waterType,
      oldPrice: current,
      newPrice,
      reason: reason.trim(),
      requestedById: actor.id,
    },
    include: {
      requestedBy: { select: { id: true, fullName: true, username: true } },
      reviewedBy: { select: { id: true, fullName: true } },
    },
  });

  await createNotification({
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    kind: 'PRICE',
    action: 'PRICE_REQUEST',
    title: 'Yeni qiymət sorğusu',
    message:
      `${actor.fullName} ${WATER_LABEL[waterType]} üçün ` +
      `${moneyOut(current).toFixed(2)} → ${moneyOut(newPrice).toFixed(2)} AZN təklif edir.`,
    note: reason.trim(),
    relatedId: request.id,
  });

  await audit({
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'price.requested',
    entityType: 'price_change_request',
    entityId: request.id,
    after: { waterType, oldPrice: moneyOut(current), newPrice: moneyOut(newPrice), reason: reason.trim() },
    req,
  });

  return serializePriceRequest(request as never);
}

export interface ListPriceRequestsQuery {
  status?: PriceRequestStatus;
  waterType?: WaterType;
  page?: number;
  pageSize?: number;
}

/** Admins see every request; a worker sees only their own. */
export async function listPriceRequests(query: ListPriceRequestsQuery, actor: Actor) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));

  const where: Prisma.PriceChangeRequestWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.waterType ? { waterType: query.waterType } : {}),
    ...(actor.role === Role.ADMIN ? {} : { requestedById: actor.id }),
  };

  const [rows, total] = await Promise.all([
    prisma.priceChangeRequest.findMany({
      where,
      orderBy: [{ requestedAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        requestedBy: { select: { id: true, fullName: true, username: true } },
        reviewedBy: { select: { id: true, fullName: true } },
      },
    }),
    prisma.priceChangeRequest.count({ where }),
  ]);

  return paginate(rows.map((r) => serializePriceRequest(r as never)), total, page, pageSize);
}

/**
 * Approve or reject a pending request. Approval writes the price and its
 * history row in one transaction; a second approval of the same request is
 * rejected by the status claim, so the price cannot be applied twice.
 */
export async function reviewPriceRequest(
  requestId: string,
  action: 'APPROVE' | 'REJECT',
  note: string | null,
  actor: Actor,
  req?: never,
) {
  if (actor.role !== Role.ADMIN) {
    throw forbidden('Qiymət sorğusunu yalnız administrator təsdiqləyə bilər.');
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const request = await tx.priceChangeRequest.findUnique({ where: { id: requestId } });
    if (!request) throw notFound('Qiymət sorğusu tapılmadı.');
    if (request.status !== PriceRequestStatus.PENDING) {
      throw conflict('Bu sorğu artıq cavablandırılıb.');
    }

    // Atomic claim: only the FIRST reviewer flips PENDING -> decided.
    const claim = await tx.priceChangeRequest.updateMany({
      where: { id: requestId, status: PriceRequestStatus.PENDING },
      data: {
        status: action === 'APPROVE' ? PriceRequestStatus.APPROVED : PriceRequestStatus.REJECTED,
        reviewedById: actor.id,
        reviewedAt: new Date(),
        reviewNote: note?.trim() || null,
      },
    });
    if (claim.count === 0) throw conflict('Bu sorğu artıq cavablandırılıb.');

    let historyId: string | null = null;
    let appliedPrice: Prisma.Decimal | null = null;
    if (action === 'APPROVE') {
      const current = await tx.waterPrice.findUnique({ where: { waterType: request.waterType }, select: { price: true } });
      const oldPrice = round2(current?.price ?? request.oldPrice);
      appliedPrice = round2(request.newPrice);

      if (!oldPrice.equals(appliedPrice)) {
        await tx.waterPrice.upsert({
          where: { waterType: request.waterType },
          update: { price: appliedPrice, updatedById: actor.id, effectiveFrom: new Date() },
          create: { waterType: request.waterType, price: appliedPrice, updatedById: actor.id },
        });
        const history = await tx.priceHistory.create({
          data: {
            waterType: request.waterType,
            oldPrice,
            newPrice: appliedPrice,
            source: 'PRICE_REQUEST',
            requestId: request.id,
            note: request.reason,
            changedById: actor.id,
          },
        });
        historyId = history.id;
      }
    }

    const updated = await tx.priceChangeRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: {
        requestedBy: { select: { id: true, fullName: true, username: true } },
        reviewedBy: { select: { id: true, fullName: true } },
      },
    });

    return { request, updated, historyId, appliedPrice };
  });

  const verb = action === 'APPROVE' ? 'təsdiqlədi' : 'rədd etdi';
  await createNotification({
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    kind: 'PRICE',
    action: action === 'APPROVE' ? 'PRICE_APPROVED' : 'PRICE_REJECTED',
    title: action === 'APPROVE' ? 'Qiymət sorğusu təsdiqləndi' : 'Qiymət sorğusu rədd edildi',
    message:
      `${actor.fullName} ${outcome.updated.requestedBy?.fullName ?? 'işçinin'} ` +
      `${WATER_LABEL[outcome.request.waterType]} qiymət sorğusunu ${verb}.` +
      (outcome.appliedPrice ? ` Yeni qiymət: ${moneyOut(outcome.appliedPrice).toFixed(2)} AZN.` : ''),
    note: note?.trim() || null,
    relatedId: requestId,
  });

  await audit({
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: action === 'APPROVE' ? 'price.request.approved' : 'price.request.rejected',
    entityType: 'price_change_request',
    entityId: requestId,
    meta: {
      waterType: outcome.request.waterType,
      oldPrice: moneyOut(outcome.request.oldPrice),
      newPrice: moneyOut(outcome.request.newPrice),
      note: note ?? null,
    },
    req,
  });

  return {
    request: serializePriceRequest(outcome.updated as never),
    historyId: outcome.historyId,
    price: outcome.appliedPrice ? moneyOut(outcome.appliedPrice) : null,
  };
}

/** Price change history, newest first. Admin-only. */
export async function listPriceHistory(
  query: { waterType?: WaterType; preset?: DateRangePreset; from?: string; to?: string; page?: number; pageSize?: number },
  actor: Actor,
) {
  if (actor.role !== Role.ADMIN) {
    throw forbidden('Qiymət tarixçəsini yalnız administrator görə bilər.');
  }
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));
  const { start, end } = resolveRange(
    query.preset,
    query.from ? new Date(query.from) : null,
    query.to ? new Date(query.to) : null,
  );

  const where: Prisma.PriceHistoryWhereInput = {
    ...(query.waterType ? { waterType: query.waterType } : {}),
    ...(start || end ? { occurredAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.priceHistory.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { changedBy: { select: { id: true, fullName: true } } },
    }),
    prisma.priceHistory.count({ where }),
  ]);

  return paginate(rows.map((r) => serializePriceHistory(r as never)), total, page, pageSize);
}
