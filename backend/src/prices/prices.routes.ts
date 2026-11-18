import { Router } from 'express';
import { Role, WaterType } from '@prisma/client';
import { z } from 'zod';
import { asyncHandler } from '../common/middleware/error';
import { requireAuth, requireRole } from '../common/middleware/auth';
import { validate } from '../common/middleware/validate';
import { actorOf, param } from '../common/utils/actor';
import {
  listPriceRequestsSchema,
  priceHistorySchema,
  requestPriceSchema,
  reviewPriceRequestSchema,
  setPriceSchema,
  uuidParam,
} from '../common/schemas';
import {
  getPrices,
  listPriceHistory,
  listPriceRequests,
  requestPriceChange,
  reviewPriceRequest,
  updatePrice,
} from './prices.service';

const waterTypeParam = z.object({ waterType: z.nativeEnum(WaterType) });

export const pricesRouter = Router();
pricesRouter.use(requireAuth);

// Current price per water type. Readable by every role; only the admin writes.
pricesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ data: await getPrices() });
  }),
);

// Price history is admin-only history, not a worker's business.
pricesRouter.get(
  '/history',
  requireRole(Role.ADMIN),
  validate(priceHistorySchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json({ data: await listPriceHistory(req.query as never, actorOf(req)) });
  }),
);

// Admin: change a price directly. No approval step.
pricesRouter.put(
  '/:waterType',
  requireRole(Role.ADMIN),
  validate(waterTypeParam, 'params'),
  validate(setPriceSchema),
  asyncHandler(async (req, res) => {
    res.json({
      data: await updatePrice(
        param(req, 'waterType') as WaterType,
        req.body.price,
        req.body.note ?? null,
        actorOf(req),
        req as never,
      ),
    });
  }),
);

// Worker: ask for a change. Admin may read all requests, worker only their own.
pricesRouter.get(
  '/requests',
  validate(listPriceRequestsSchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json({ data: await listPriceRequests(req.query as never, actorOf(req)) });
  }),
);

pricesRouter.post(
  '/requests',
  requireRole(Role.WORKER),
  validate(requestPriceSchema),
  asyncHandler(async (req, res) => {
    const data = await requestPriceChange(
      req.body.waterType,
      req.body.newPrice,
      req.body.reason,
      actorOf(req),
      req as never,
    );
    res.status(201).json({ data });
  }),
);

// Admin: approve or reject. A request can only be decided once.
pricesRouter.patch(
  '/requests/:id',
  requireRole(Role.ADMIN),
  validate(uuidParam, 'params'),
  validate(reviewPriceRequestSchema),
  asyncHandler(async (req, res) => {
    res.json({
      data: await reviewPriceRequest(
        param(req, 'id'),
        req.body.action,
        req.body.note ?? null,
        actorOf(req),
        req as never,
      ),
    });
  }),
);
