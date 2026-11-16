import { Router } from 'express';
import { Role } from '@prisma/client';
import { asyncHandler } from '../common/middleware/error';
import { requireAuth, requireRole } from '../common/middleware/auth';
import { validate } from '../common/middleware/validate';
import { actorOf, param } from '../common/utils/actor';
import { uuidParam } from '../common/schemas';
import { z } from 'zod';
import {
  listNotifications,
  markRead,
  markAllRead,
  getUnreadCount,
} from './notification.service';

const listNotificationsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  read: z.coerce.boolean().optional(),
  action: z.string().optional(),
  preset: z
    .enum(['today', 'yesterday', 'last7days', 'last30days', 'thisMonth', 'lastMonth', 'thisYear', 'all'])
    .optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

/**
 * Admin lists their notifications.
 */
notificationsRouter.get(
  '/',
  requireRole(Role.ADMIN),
  validate(listNotificationsSchema, 'query'),
  asyncHandler(async (req, res) => {
    const result = await listNotifications(req.query as never, actorOf(req));
    res.json({ data: result });
  }),
);

/**
 * Admin marks a notification as read.
 */
notificationsRouter.patch(
  '/:id/read',
  requireRole(Role.ADMIN),
  validate(uuidParam, 'params'),
  asyncHandler(async (req, res) => {
    const result = await markRead(param(req, 'id'), actorOf(req));
    res.json({ data: result });
  }),
);

/**
 * Admin marks all notifications as read.
 */
notificationsRouter.patch(
  '/read-all',
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    await markAllRead(actorOf(req));
    res.json({ data: { ok: true } });
  }),
);

/**
 * Admin gets unread notification count for dashboard badge.
 */
notificationsRouter.get(
  '/unread-count',
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const count = await getUnreadCount(actorOf(req));
    res.json({ data: { count } });
  }),
);
