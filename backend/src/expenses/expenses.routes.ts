import { Router } from 'express';
import { Role } from '@prisma/client';
import { asyncHandler } from '../common/middleware/error';
import { requireAuth, requireRole } from '../common/middleware/auth';
import { validate } from '../common/middleware/validate';
import { actorOf, param } from '../common/utils/actor';
import {
  createExpenseSchema,
  listExpensesSchema,
  uuidParam,
  voidExpenseSchema,
} from '../common/schemas';
import { parseLocalDateInput } from '../common/utils/date';
import { createExpense, listExpenses, voidExpense } from './expenses.service';

export const expensesRouter = Router();
expensesRouter.use(requireAuth, requireRole(Role.ADMIN));

expensesRouter.get(
  '/',
  validate(listExpensesSchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json({ data: await listExpenses(req.query as never, actorOf(req)) });
  }),
);

expensesRouter.post(
  '/',
  validate(createExpenseSchema),
  asyncHandler(async (req, res) => {
    let spentAt: Date | undefined;
    if (req.body.spentAt) {
      try {
        spentAt = parseLocalDateInput(req.body.spentAt);
      } catch {
        spentAt = undefined;
      }
    }
    const result = await createExpense(
      {
        category: req.body.category,
        waterType: req.body.waterType ?? null,
        amount: req.body.amount,
        spentAt,
        note: req.body.note ?? null,
        idempotencyKey: req.body.idempotencyKey,
      },
      actorOf(req),
      req as never,
    );
    res.status(result.duplicate ? 200 : 201).json({ data: result, meta: { duplicate: result.duplicate } });
  }),
);

expensesRouter.post(
  '/:id/void',
  validate(uuidParam, 'params'),
  validate(voidExpenseSchema),
  asyncHandler(async (req, res) => {
    res.json({ data: await voidExpense(param(req, 'id'), req.body.reason, actorOf(req), req as never) });
  }),
);
