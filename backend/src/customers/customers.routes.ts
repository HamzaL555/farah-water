import { Router } from 'express';
import { asyncHandler } from '../common/middleware/error';
import { requireAuth } from '../common/middleware/auth';
import { validate } from '../common/middleware/validate';
import { actorOf, param } from '../common/utils/actor';
import { uuidParam, createCustomerSchema, listCustomersSchema, updateCustomerSchema } from '../common/schemas';
import { createCustomer, getCustomerDetail, listCustomers, updateCustomer } from './customers.service';

export const customersRouter = Router();
customersRouter.use(requireAuth);

customersRouter.get(
  '/',
  validate(listCustomersSchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json({ data: await listCustomers(req.query as never, actorOf(req)) });
  }),
);

customersRouter.post(
  '/',
  validate(createCustomerSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json({ data: await createCustomer(req.body, actorOf(req), req as never) });
  }),
);

customersRouter.get(
  '/:id',
  validate(uuidParam, 'params'),
  asyncHandler(async (req, res) => {
    res.json({ data: await getCustomerDetail(param(req, 'id'), actorOf(req)) });
  }),
);

customersRouter.patch(
  '/:id',
  validate(uuidParam, 'params'),
  validate(updateCustomerSchema),
  asyncHandler(async (req, res) => {
    res.json({ data: await updateCustomer(param(req, 'id'), req.body, actorOf(req), req as never) });
  }),
);
