import { Prisma, Role, WaterType } from '@prisma/client';
import { prisma } from '../prisma';
import { forbidden, notFound } from '../common/utils/errors';
import { paginate } from '../common/utils/serialize';
import { resolveRange, DateRangePreset } from '../common/utils/date';
import type { Actor } from '../deliveries/delivery.service';

export type NotificationKind = 'STOCK' | 'DEPOSIT' | 'PRICE' | 'EXPENSE' | 'BALANCE' | 'DELIVERY';

export interface CreateNotificationInput {
  /** Ignored: notifications always fan out to every active admin. Kept so the
   * stock module's existing call sites keep type-checking. */
  userId?: string;
  actorId: string;
  actorName: string;
  actorRole?: string;
  /** Event family shown as a badge in the admin inbox. Defaults to STOCK. */
  kind?: NotificationKind;
  action: string;
  /** Human headline, e.g. "Anbara mədaxil" or "Depozit qəbul edildi". */
  title?: string | null;
  /** Full sentence for non-stock events, where bottle fields do not apply. */
  message?: string | null;
  waterType?: WaterType | null;
  bottleCount?: number | null;
  beforeBalance?: number | null;
  afterBalance?: number | null;
  note?: string | null;
  relatedId?: string | null;
}

/**
 * Create a notification for administrators about an operation.
 * Every active admin receives it, so no admin misses an event because of who
 * happened to be logged in. Safe to call from inside or outside a transaction.
 */
export async function createNotification(input: CreateNotificationInput, tx?: Prisma.TransactionClient) {
  const db = tx ?? prisma;
  const admins = await db.user.findMany({
    where: { role: Role.ADMIN, isActive: true },
    select: { id: true },
  });

  if (admins.length === 0) return;

  await db.notification.createMany({
    data: admins.map((a) => ({
      userId: a.id,
      actorId: input.actorId,
      actorName: input.actorName,
      actorRole: input.actorRole ?? null,
      kind: input.kind ?? 'STOCK',
      action: input.action,
      title: input.title ?? null,
      message: input.message ?? null,
      waterType: input.waterType ?? null,
      bottleCount: input.bottleCount ?? null,
      beforeBalance: input.beforeBalance ?? null,
      afterBalance: input.afterBalance ?? null,
      note: input.note ?? null,
      relatedId: input.relatedId ?? null,
    })),
  });
}

/**
 * List notifications for the calling user (admin only).
 */
export async function listNotifications(
  query: {
    page?: number;
    pageSize?: number;
    read?: boolean;
    action?: string;
    kind?: string;
    preset?: DateRangePreset;
    from?: string;
    to?: string;
  },
  actor: Actor,
) {
  if (actor.role !== Role.ADMIN) {
    throw forbidden('Yalnız administrator bildirişlərə baxa bilər.');
  }

  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));
  const { start, end } = resolveRange(
    query.preset,
    query.from ? new Date(query.from) : null,
    query.to ? new Date(query.to) : null,
  );

  const where: Prisma.NotificationWhereInput = {
    userId: actor.id,
    ...(query.read !== undefined ? { read: query.read } : {}),
    ...(query.action ? { action: query.action } : {}),
    ...(query.kind ? { kind: query.kind } : {}),
    ...(start || end ? { createdAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        actor: { select: { id: true, fullName: true, username: true, role: true } },
      },
    }),
    prisma.notification.count({ where }),
  ]);

  return {
    items: rows.map((n) => ({
      id: n.id,
      kind: n.kind,
      action: n.action,
      title: n.title,
      message: n.message,
      waterType: n.waterType,
      bottleCount: n.bottleCount,
      beforeBalance: n.beforeBalance,
      afterBalance: n.afterBalance,
      note: n.note,
      relatedId: n.relatedId,
      read: n.read,
      createdAt: n.createdAt,
      actorName: n.actorName,
      actorRole: n.actorRole,
      actor: n.actor,
    })),
    total,
    page,
    pageSize,
  };
}

/**
 * Mark a notification as read.
 */
export async function markRead(notificationId: string, actor: Actor) {
  if (actor.role !== Role.ADMIN) {
    throw forbidden('Yalnız administrator bildirişləri dəyişə bilər.');
  }

  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
  });
  if (!notification || notification.userId !== actor.id) {
    throw notFound('Bildiriş tapılmadı.');
  }

  return prisma.notification.update({
    where: { id: notificationId },
    data: { read: true },
  });
}

/**
 * Mark all notifications as read.
 */
export async function markAllRead(actor: Actor) {
  if (actor.role !== Role.ADMIN) {
    throw forbidden('Yalnız administrator bildirişləri dəyişə bilər.');
  }

  return prisma.notification.updateMany({
    where: { userId: actor.id, read: false },
    data: { read: true },
  });
}

/**
 * Get unread notification count for admin dashboard.
 */
export async function getUnreadCount(actor: Actor) {
  if (actor.role !== Role.ADMIN) {
    throw forbidden('Yalnız administrator bildirişlərə baxa bilər.');
  }

  return prisma.notification.count({
    where: { userId: actor.id, read: false },
  });
}
