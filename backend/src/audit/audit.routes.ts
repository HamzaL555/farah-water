import { Router } from 'express';
import { Role } from '@prisma/client';
import { asyncHandler } from '../common/middleware/error';
import { requireAuth, requireRole } from '../common/middleware/auth';
import { validate } from '../common/middleware/validate';
import { actorOf, param } from '../common/utils/actor';
import { listAuditSchema, updateSettingsSchema } from '../common/schemas';
import { auditTrailFor, getSettings, listAuditLogs, updateSettings } from './audit.service';

export const auditRouter = Router();
auditRouter.use(requireAuth);

const adminOnly = requireRole(Role.ADMIN);

auditRouter.get(
  '/logs',
  adminOnly,
  validate(listAuditSchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json({ data: await listAuditLogs(req.query as never, actorOf(req)) });
  }),
);

auditRouter.get(
  '/logs/:entityType/:entityId',
  adminOnly,
  asyncHandler(async (req, res) => {
    res.json({ data: await auditTrailFor(param(req, 'entityType'), param(req, 'entityId'), actorOf(req)) });
  }),
);

// ------------------------------- settings ---------------------------------

auditRouter.get(
  '/settings',
  asyncHandler(async (req, res) => {
    res.json({ data: await getSettings(actorOf(req)) });
  }),
);

auditRouter.patch(
  '/settings',
  adminOnly,
  validate(updateSettingsSchema),
  asyncHandler(async (req, res) => {
    res.json({ data: await updateSettings(req.body, actorOf(req), req as never) });
  }),
);
