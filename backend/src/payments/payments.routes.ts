import { Router } from 'express';
import { Role } from '@prisma/client';
import { asyncHandler } from '../common/middleware/error';
import { requireAuth, requireRole } from '../common/middleware/auth';
import { validate } from '../common/middleware/validate';
import { actorOf, param } from '../common/utils/actor';
import { uuidParam, createPaymentSchema, listPaymentsSchema, voidPaymentSchema } from '../common/schemas';
import { createPayment, listPayments, paymentHistoryForDelivery, voidPayment } from './payment.service';

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

paymentsRouter.get(
  '/',
  validate(listPaymentsSchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json({ data: await listPayments(req.query as never, actorOf(req)) });
  }),
);

paymentsRouter.post(
  '/',
  requireRole(Role.ADMIN),
  validate(createPaymentSchema),
  asyncHandler(async (req, res) => {
    const result = await createPayment(req.body, actorOf(req), req as never);
    res.status(result.duplicate ? 200 : 201).json({
      data: result.payment,
      meta: { duplicate: result.duplicate },
    });
  }),
);

paymentsRouter.get(
  '/delivery/:id',
  validate(uuidParam, 'params'),
  asyncHandler(async (req, res) => {
    res.json({ data: await paymentHistoryForDelivery(param(req, 'id'), actorOf(req)) });
  }),
);

paymentsRouter.post(
  '/:id/void',
  requireRole(Role.ADMIN),
  validate(uuidParam, 'params'),
  validate(voidPaymentSchema),
  asyncHandler(async (req, res) => {
    res.json({ data: await voidPayment(param(req, 'id'), req.body.reason, actorOf(req), req as never) });
  }),
);
