import { Router } from 'express';
import { Role } from '@prisma/client';
import { asyncHandler } from '../common/middleware/error';
import { requireAuth, requireRole } from '../common/middleware/auth';
import { validate } from '../common/middleware/validate';
import { actorOf, param } from '../common/utils/actor';
import {
  uuidParam,
  cancelDeliverySchema,
  createDeliverySchema,
  listDeliveriesSchema,
  updateDeliverySchema,
} from '../common/schemas';
import { cancelDelivery, createDelivery, getDeliveryDetail, listDeliveries, updateDelivery } from './delivery.service';

export const deliveriesRouter = Router();
deliveriesRouter.use(requireAuth);

deliveriesRouter.get(
  '/',
  validate(listDeliveriesSchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json({ data: await listDeliveries(req.query as never, actorOf(req)) });
  }),
);

deliveriesRouter.post(
  '/',
  validate(createDeliverySchema),
  asyncHandler(async (req, res) => {
    const result = await createDelivery(req.body, actorOf(req));
    res.status(result.duplicate ? 200 : 201).json({
      data: result.delivery,
      meta: { duplicate: result.duplicate },
    });
  }),
);

deliveriesRouter.get(
  '/:id',
  validate(uuidParam, 'params'),
  asyncHandler(async (req, res) => {
    res.json({ data: await getDeliveryDetail(param(req, 'id'), actorOf(req)) });
  }),
);

deliveriesRouter.patch(
  '/:id',
  requireRole(Role.ADMIN),
  validate(uuidParam, 'params'),
  validate(updateDeliverySchema),
  asyncHandler(async (req, res) => {
    res.json({ data: await updateDelivery(param(req, 'id'), req.body, actorOf(req), req as never) });
  }),
);

deliveriesRouter.post(
  '/:id/cancel',
  requireRole(Role.ADMIN),
  validate(uuidParam, 'params'),
  validate(cancelDeliverySchema),
  asyncHandler(async (req, res) => {
    res.json({ data: await cancelDelivery(param(req, 'id'), req.body.reason, actorOf(req), req as never) });
  }),
);
