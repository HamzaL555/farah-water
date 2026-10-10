import { Router } from 'express';
import { Role } from '@prisma/client';
import { asyncHandler } from '../common/middleware/error';
import { requireAuth, requireRole } from '../common/middleware/auth';
import { validate } from '../common/middleware/validate';
import { actorOf, param } from '../common/utils/actor';
import { uuidParam, createWorkerSchema, updateWorkerSchema, updateProfileSchema, listWorkersSchema } from '../common/schemas';
import {
  createWorker,
  getWorkerDetail,
  listWorkers,
  listWorkersWithStats,
  resetWorkerPassword,
  updateMyProfile,
  updateWorker,
} from './users.service';

export const usersRouter = Router();

usersRouter.use(requireAuth);

// ------------------------------ my profile -------------------------------
usersRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const detail = await getWorkerDetail(req.user!.id, actorOf(req));
    res.json({ data: detail });
  }),
);

usersRouter.patch(
  '/me',
  validate(updateProfileSchema),
  asyncHandler(async (req, res) => {
    const data = await updateMyProfile(req.user!.id, req.body, req as never);
    res.json({ data });
  }),
);

// ------------------------------ admin only --------------------------------
const adminOnly = requireRole(Role.ADMIN);

usersRouter.get(
  '/',
  adminOnly,
  validate(listWorkersSchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json({ data: await listWorkers(req.query as never, actorOf(req)) });
  }),
);

usersRouter.get(
  '/stats',
  adminOnly,
  asyncHandler(async (req, res) => {
    res.json({ data: await listWorkersWithStats(actorOf(req)) });
  }),
);

usersRouter.post(
  '/',
  adminOnly,
  validate(createWorkerSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ data: await createWorker(req.body, actorOf(req), req as never) });
  }),
);

usersRouter.get(
  '/:id',
  validate(uuidParam, 'params'),
  asyncHandler(async (req, res) => {
    res.json({ data: await getWorkerDetail(param(req, 'id'), actorOf(req)) });
  }),
);

usersRouter.patch(
  '/:id',
  adminOnly,
  validate(uuidParam, 'params'),
  validate(updateWorkerSchema),
  asyncHandler(async (req, res) => {
    res.json({ data: await updateWorker(param(req, 'id'), req.body, actorOf(req), req as never) });
  }),
);

usersRouter.post(
  '/:id/reset-password',
  adminOnly,
  validate(uuidParam, 'params'),
  asyncHandler(async (req, res) => {
    res.json({ data: await resetWorkerPassword(param(req, 'id'), actorOf(req), req as never) });
  }),
);
