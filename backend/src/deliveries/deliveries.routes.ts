import { Router } from 'express';
import { Role } from '@prisma/client';
import { asyncHandler } from '../common/middleware/error';
import { requireAuth, requireRole } from '../common/middleware/auth';
import { validate } from '../common/middleware/validate';
import { actorOf, param } from '../common/utils/actor';
import {
  uuidParam,
  cancelDeliverySchema,
  confirmDeliverySchema,
  createDeliverySchema,
  listDeliveriesSchema,
  updateDeliverySchema,
} from '../common/schemas';
import {
  cancelDelivery,
  confirmDelivery,
  createDelivery,
  getDeliveryDetail,
  listDeliveries,
  updateDelivery,
} from './delivery.service';

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

// Ayrica tesdiq: stok yalniz bu addimdan sonra balansdan cixir. Admin ve ya
// catdirilmanin oz iscisi cagira biler; tekrar cagiris ikinci defe stok
// cixmir (idempotent).
deliveriesRouter.post(
  '/:id/confirm',
  validate(uuidParam, 'params'),
  validate(confirmDeliverySchema),
  asyncHandler(async (req, res) => {
    const result = await confirmDelivery(param(req, 'id'), actorOf(req), req.body, req as never);
    res.status(200).json({
      data: result.delivery,
      meta: { duplicate: result.duplicate },
    });
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
