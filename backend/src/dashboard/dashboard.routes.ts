import { Router } from 'express';
import { Role } from '@prisma/client';
import { asyncHandler } from '../common/middleware/error';
import { requireAuth, requireRole } from '../common/middleware/auth';
import { validate } from '../common/middleware/validate';
import { actorOf } from '../common/utils/actor';
import { dashboardRangeSchema } from '../common/schemas';
import { adminDashboard, revenueBreakdown, workerDashboard } from './dashboard.service';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get(
  '/worker',
  asyncHandler(async (req, res) => {
    res.json({ data: await workerDashboard(actorOf(req)) });
  }),
);

dashboardRouter.get(
  '/admin',
  requireRole(Role.ADMIN),
  validate(dashboardRangeSchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json({ data: await adminDashboard(req.query as never) });
  }),
);

dashboardRouter.get(
  '/revenue',
  requireRole(Role.ADMIN),
  validate(dashboardRangeSchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json({ data: await revenueBreakdown(req.query as never) });
  }),
);
