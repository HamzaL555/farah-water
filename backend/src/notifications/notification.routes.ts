import { Router } from 'express';
import { Role } from '@prisma/client';
import { asyncHandler } from '../common/middleware/error';
import { requireAuth, requireRole } from '../common/middleware/auth';
import { validate } from '../common/middleware/validate';
import { actorOf, param } from '../common/utils/actor';
import { listNotificationsSchema, uuidParam } from '../common/schemas';
import {
  listNotifications,
  markRead,
  markAllRead,
  getUnreadCount,
} from './notification.service';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

/**
 * Admin lists their notifications. `kind` filters the families that share the
 * inbox (stock, deposit, price, expense); without it every family is returned.
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
