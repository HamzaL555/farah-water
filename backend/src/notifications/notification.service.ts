import { Prisma, Role, WaterType } from '@prisma/client';
import { prisma } from '../prisma';
import { forbidden, notFound } from '../common/utils/errors';
import { paginate } from '../common/utils/serialize';
import { resolveRange, DateRangePreset } from '../common/utils/date';
import type { Actor } from '../deliveries/delivery.service';

export interface CreateNotificationInput {
  userId: string; // which admin to notify (or 'ALL' for all admins - handled in service)
  actorId: string;
  actorName: string;
  actorRole?: string;
  action: string;
  waterType: WaterType;
  bottleCount: number;
  beforeBalance: number;
  afterBalance: number;
  note?: string | null;
  relatedId?: string | null;
}

/**
 * Create a notification for administrators about warehouse operations.
 * Notifies all admin users so any admin can see what's happening in the warehouse.
 */
export async function createNotification(input: CreateNotificationInput) {
  // Find all admin users to notify
  const admins = await prisma.user.findMany({
    where: { role: Role.ADMIN, isActive: true },
    select: { id: true },
  });

  if (admins.length === 0) return;

  await prisma.notification.createMany({
    data: admins.map((a) => ({
      userId: a.id,
      actorId: input.actorId,
      actorName: input.actorName,
      actorRole: input.actorRole,
      action: input.action,
      waterType: input.waterType,
      bottleCount: input.bottleCount,
      beforeBalance: input.beforeBalance,
      afterBalance: input.afterBalance,
      note: input.note ?? null,
      relatedId: input.relatedId ?? null,
    })),
  });
}

/**
 * List notifications for the calling user (admin only).
 */
export async function listNotifications(
  query: { page?: number; pageSize?: number; read?: boolean; action?: string; preset?: DateRangePreset; from?: string; to?: string },
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

  const where: any = {
    userId: actor.id,
    ...(query.read !== undefined ? { read: query.read } : {}),
    ...(query.action ? { action: query.action } : {}),
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
      action: n.action,
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
