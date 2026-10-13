import { Router } from 'express';
import { Role } from '@prisma/client';
import { asyncHandler } from '../common/middleware/error';
import { requireAuth, requireRole } from '../common/middleware/auth';
import { validate } from '../common/middleware/validate';
import { actorOf } from '../common/utils/actor';
import { uuidParam, listInventorySchema, returnStockSchema, stockInSchema, takeFromWarehouseSchema, writeOffSchema } from '../common/schemas';
import {
  getMyStock,
  getWarehouseSummary,
  listInventoryTransactions,
  receiveStock,
  reportDamageOrLoss,
  returnToStock,
  takeFromWarehouse,
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

// Receive stock into the warehouse. The worker counts what physically arrived,
// so they post the INBOUND. The admin supervises rather than operates: an
// inbound written from the owner's side would be a second way into the stock
// ledger, which is exactly what the warehouse hand-over removed.
inventoryRouter.post(
  '/stock-in',
  requireRole(Role.WORKER),
  validate(stockInSchema),
  asyncHandler(async (req, res) => {
    const result = await receiveStock(req.body.bottleCount, req.body.note ?? null, actorOf(req), req as never, req.body.idempotencyKey);
    res.status(result.duplicate ? 200 : 201).json({ data: result, meta: { duplicate: result.duplicate } });
  }),
);

// Worker: take bottles out of the warehouse into their own hands.
// The admin watches the totals instead of dispensing stock, so there is no
// workerId here - a worker can only ever move stock to themselves.
inventoryRouter.post(
  '/issue',
  requireRole(Role.WORKER),
  validate(takeFromWarehouseSchema),
  asyncHandler(async (req, res) => {
    const result = await takeFromWarehouse(req.body.bottleCount, req.body.note ?? null, actorOf(req), req as never, req.body.idempotencyKey);
    res.status(result.duplicate ? 200 : 201).json({ data: result, meta: { duplicate: result.duplicate } });
  }),
);

// Worker: return unsold bottles from their own hands.
// The admin is not offered this: with the warehouse run by the worker, watching
// is the whole of the admin's role there.
inventoryRouter.post(
  '/return',
  requireRole(Role.WORKER),
  validate(returnStockSchema),
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const result = await returnToStock(req.body.bottleCount, req.body.note ?? null, actor, req as never, req.body.idempotencyKey);
    res.status(result.duplicate ? 200 : 201).json({ data: result, meta: { duplicate: result.duplicate } });
  }),
);

// Damaged / lost write-off, from the worker's own hands. Worker-only, for the
// same reason as the other warehouse movements.
inventoryRouter.post(
  '/write-off',
  requireRole(Role.WORKER),
  validate(writeOffSchema),
  asyncHandler(async (req, res) => {
    const result = await reportDamageOrLoss(
      req.body.type,
      req.body.bottleCount,
      req.body.note,
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
