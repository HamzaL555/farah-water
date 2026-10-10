import { Router } from 'express';
import { Role } from '@prisma/client';
import { asyncHandler } from '../common/middleware/error';
import { requireAuth, requireRole } from '../common/middleware/auth';
import { validate } from '../common/middleware/validate';
import { actorOf } from '../common/utils/actor';
import { uuidParam, issueToWorkerSchema, listInventorySchema, returnStockSchema, stockInSchema, writeOffSchema } from '../common/schemas';
import {
  getMyStock,
  getWarehouseSummary,
  issueToWorker,
  listInventoryTransactions,
  receiveStock,
  reportDamageOrLoss,
  returnToStock,
  returnWorkerStock,
} from './inventory.operations';

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth);

inventoryRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    res.json({ data: await getWarehouseSummary(actorOf(req)) });
  }),
);

inventoryRouter.get(
  '/my-stock',
  asyncHandler(async (req, res) => {
    res.json({ data: await getMyStock(actorOf(req)) });
  }),
);

inventoryRouter.get(
  '/transactions',
  validate(listInventorySchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json({ data: await listInventoryTransactions(req.query as never, actorOf(req)) });
  }),
);

// Admin: receive stock into the warehouse.
inventoryRouter.post(
  '/stock-in',
  requireRole(Role.ADMIN),
  validate(stockInSchema),
  asyncHandler(async (req, res) => {
    const result = await receiveStock(req.body.bottleCount, req.body.note ?? null, actorOf(req), req as never, req.body.idempotencyKey);
    res.status(result.duplicate ? 200 : 201).json({ data: result, meta: { duplicate: result.duplicate } });
  }),
);

// Admin: hand bottles to a worker.
inventoryRouter.post(
  '/issue',
  requireRole(Role.ADMIN),
  validate(issueToWorkerSchema),
  asyncHandler(async (req, res) => {
    const result = await issueToWorker(req.body.workerId, req.body.bottleCount, req.body.note ?? null, actorOf(req), req as never, req.body.idempotencyKey);
    res.status(result.duplicate ? 200 : 201).json({ data: result, meta: { duplicate: result.duplicate } });
  }),
);

// Worker: return unsold bottles from their own hands.
inventoryRouter.post(
  '/return',
  validate(returnStockSchema),
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const result =
      actor.role === Role.ADMIN
        ? await returnWorkerStock(req.body.workerId!, req.body.bottleCount, req.body.note ?? null, actor, req as never, req.body.idempotencyKey)
        : await returnToStock(req.body.bottleCount, req.body.note ?? null, actor, req as never, req.body.idempotencyKey);
    res.status(result.duplicate ? 200 : 201).json({ data: result, meta: { duplicate: result.duplicate } });
  }),
);

// Damaged / lost write-off (from the worker's own stock, or the warehouse for admin).
inventoryRouter.post(
  '/write-off',
  validate(writeOffSchema),
  asyncHandler(async (req, res) => {
    const result = await reportDamageOrLoss(
      req.body.type,
      req.body.bottleCount,
      req.body.note,
      req.body.workerId ?? null,
      actorOf(req),
      req as never,
      req.body.idempotencyKey,
    );
    res.status(result.duplicate ? 200 : 201).json({ data: result, meta: { duplicate: result.duplicate } });
  }),
);

inventoryRouter.get(
  '/worker/:id',
  validate(uuidParam, 'params'),
  requireRole(Role.ADMIN),
  asyncHandler(async (req, res) => {
    const data = await getWarehouseSummary(actorOf(req));
    res.json({ data: data.workers.find((w) => w.workerId === req.params.id) ?? { quantity: 0 } });
  }),
);
