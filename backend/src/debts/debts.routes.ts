import { Router } from 'express';
import { asyncHandler } from '../common/middleware/error';
import { requireAuth } from '../common/middleware/auth';
import { validate } from '../common/middleware/validate';
import { actorOf, param } from '../common/utils/actor';
import { uuidParam, createAdjustmentSchema, listDebtsSchema } from '../common/schemas';
import { createAdjustment, debtSummaryByCustomer, listAdjustments, listDebts } from './debt.service';

export const debtsRouter = Router();
debtsRouter.use(requireAuth);

debtsRouter.get(
  '/',
  validate(listDebtsSchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json({ data: await listDebts(req.query as never, actorOf(req)) });
  }),
);

debtsRouter.get(
  '/summary',
  validate(listDebtsSchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json({ data: await debtSummaryByCustomer(req.query as never, actorOf(req)) });
  }),
);

debtsRouter.get(
  '/delivery/:id/adjustments',
  validate(uuidParam, 'params'),
  asyncHandler(async (req, res) => {
    res.json({ data: await listAdjustments(param(req, 'id'), actorOf(req)) });
  }),
);

debtsRouter.post(
  '/adjustments',
  validate(createAdjustmentSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ data: await createAdjustment(req.body, actorOf(req), req as never) });
  }),
);
