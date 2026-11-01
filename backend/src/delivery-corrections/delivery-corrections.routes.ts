import { Router } from 'express';
import { Role } from '@prisma/client';
import { asyncHandler } from '../common/middleware/error';
import { requireAuth, requireRole } from '../common/middleware/auth';
import { validate } from '../common/middleware/validate';
import { param, actorOf } from '../common/utils/actor';
import { uuidParam } from '../common/schemas';
import {
  createDeliveryCorrectionSchema,
  reviewDeliveryCorrectionSchema,
  listDeliveryCorrectionsSchema,
} from './delivery-corrections.schema';
import {
  requestCorrection,
  listCorrections,
  reviewCorrection,
  getCorrection,
} from './delivery-corrections.service';

export const deliveryCorrectionsRouter = Router();
deliveryCorrectionsRouter.use(requireAuth);

/**
 * Worker requests a bottle count correction on their own delivery.
 * Reason is mandatory.
 */
deliveryCorrectionsRouter.post(
  '/',
  validate(createDeliveryCorrectionSchema),
  asyncHandler(async (req, res) => {
    const result = await requestCorrection(req.body, actorOf(req));
    res.status(201).json({ data: result });
  }),
);

/**
 * Admin lists correction requests.
 */
deliveryCorrectionsRouter.get(
  '/',
  requireRole(Role.ADMIN),
  validate(listDeliveryCorrectionsSchema, 'query'),
  asyncHandler(async (req, res) => {
    const { status, deliveryId, page = 1, pageSize = 25 } = req.query as never;
    const result = await listCorrections(
      { status, deliveryId, page, pageSize },
      actorOf(req),
    );
    res.json({ data: result });
  }),
);

/**
 * Worker gets their own corrections; admin sees all.
 */
deliveryCorrectionsRouter.get(
  '/:id',
  validate(uuidParam, 'params'),
  asyncHandler(async (req, res) => {
    const result = await getCorrection(param(req, 'id'), actorOf(req));
    res.json({ data: result });
  }),
);

/**
 * Admin approves or rejects a correction request.
 */
deliveryCorrectionsRouter.patch(
  '/:id/review',
  requireRole(Role.ADMIN),
  validate(uuidParam, 'params'),
  validate(reviewDeliveryCorrectionSchema),
  asyncHandler(async (req, res) => {
    const result = await reviewCorrection(param(req, 'id'), req.body, actorOf(req));
    res.json({ data: result });
  }),
);
