import { Router } from 'express';
import { Role } from '@prisma/client';
import { asyncHandler } from '../common/middleware/error';
import { requireAuth, requireRole } from '../common/middleware/auth';
import { validate } from '../common/middleware/validate';
import { actorOf } from '../common/utils/actor';
import {
  uuidParam,
  listInventorySchema,
  returnStockSchema,
  stockInSchema,
  takeFromWarehouseSchema,
  writeOffSchema,
  distributeToWorkerSchema,
} from '../common/schemas';
import {
  getMyStock,
  getWarehouseSummary,
  listInventoryTransactions,
  receiveStock,
  reportDamageOrLoss,
  returnToStock,
  takeFromWarehouse,
  distributeToWorker,
  writeOffWarehouse,
} from './inventory.operations';

export const inventoryRouter = Router();

// Authorisation lives in the operations, not here: the service knows the
// difference between anbardar, adi isci and admin, and one route-level
// requireRole cannot express "anbardar OR admin" on its own anyway.

inventoryRouter.get(
  '/summary',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ data: await getWarehouseSummary(actorOf(req)) });
  }),
);

inventoryRouter.get(
  '/my-stock',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ data: await getMyStock(actorOf(req)) });
  }),
);

inventoryRouter.get(
  '/transactions',
  requireAuth,
  validate(listInventorySchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json({ data: await listInventoryTransactions(req.query as never, actorOf(req)) });
  }),
);

// Receive stock into the warehouse. Water type is specified in the body.
inventoryRouter.post(
  '/stock-in',
  requireAuth,
  requireRole(Role.WORKER),
  validate(stockInSchema),
  asyncHandler(async (req, res) => {
    const result = await receiveStock(
      req.body.waterType,
      req.body.bottleCount,
      req.body.note ?? null,
      actorOf(req),
      req as never,
      req.body.idempotencyKey,
    );
    res.status(result.duplicate ? 200 : 201).json({ data: result, meta: { duplicate: result.duplicate } });
  }),
);

// Worker: take bottles out of the warehouse into their own hands.
inventoryRouter.post(
  '/issue',
  requireAuth,
  requireRole(Role.WORKER),
  validate(takeFromWarehouseSchema),
  asyncHandler(async (req, res) => {
    const result = await takeFromWarehouse(
      req.body.waterType,
      req.body.bottleCount,
      req.body.note ?? null,
      actorOf(req),
      req as never,
      req.body.idempotencyKey,
    );
    res.status(result.duplicate ? 200 : 201).json({ data: result, meta: { duplicate: result.duplicate } });
  }),
);

// Worker: return unsold bottles from their own hands.
inventoryRouter.post(
  '/return',
  requireAuth,
  requireRole(Role.WORKER),
  validate(returnStockSchema),
  asyncHandler(async (req, res) => {
    const actor = actorOf(req);
    const result = await returnToStock(
      req.body.waterType,
      req.body.bottleCount,
      req.body.note ?? null,
      actor,
      req as never,
      req.body.idempotencyKey,
      req.body.workerId ?? null,
    );
    res.status(result.duplicate ? 200 : 201).json({ data: result, meta: { duplicate: result.duplicate } });
  }),
);

// Damaged / lost write-off, from the worker's own hands.
inventoryRouter.post(
  '/write-off',
  requireAuth,
  requireRole(Role.WORKER),
  validate(writeOffSchema),
  asyncHandler(async (req, res) => {
    const result = await reportDamageOrLoss(
      req.body.type,
      req.body.waterType,
      req.body.bottleCount,
      req.body.note,
      actorOf(req),
      req as never,
      req.body.idempotencyKey,
    );
    res.status(result.duplicate ? 200 : 201).json({ data: result, meta: { duplicate: result.duplicate } });
  }),
);

// Damaged / lost write-off directly from the WAREHOUSE. The reason is required
// by the schema; an anbar total can never be reduced silently.
inventoryRouter.post(
  '/warehouse-write-off',
  requireAuth,
  requireRole(Role.WORKER),
  validate(writeOffSchema),
  asyncHandler(async (req, res) => {
    const result = await writeOffWarehouse(
      req.body.type,
      req.body.waterType,
      req.body.bottleCount,
      req.body.note,
      actorOf(req),
      req as never,
      req.body.idempotencyKey,
    );
    res.status(result.duplicate ? 200 : 201).json({ data: result, meta: { duplicate: result.duplicate } });
  }),
);

// Anbardar or admin: the service checks warehouse access. The route only has
// to keep unauthenticated callers out.
inventoryRouter.post(
  '/distribute',
  requireAuth,
  requireRole(Role.ADMIN, Role.WORKER),
  validate(distributeToWorkerSchema),
  asyncHandler(async (req, res) => {
    const result = await distributeToWorker(
      req.body.waterType,
      req.body.workerId,
      req.body.bottleCount,
      req.body.note ?? null,
      actorOf(req),
      req as never,
      req.body.idempotencyKey,
    );
    res.status(result.duplicate ? 200 : 201).json({ data: result, meta: { duplicate: result.duplicate } });
  }),
);

inventoryRouter.get(
  '/worker/:id',
  requireAuth,
  validate(uuidParam, 'params'),
  requireRole(Role.ADMIN, Role.WORKER),
  asyncHandler(async (req, res) => {
    const data = await getWarehouseSummary(actorOf(req));
    const w = data.workers.find((w) => w.workerId === req.params.id);
    res.json({ data: w ?? { workerId: req.params.id, filteredQty: 0, springQty: 0, totalQty: 0 } });
  }),
);
