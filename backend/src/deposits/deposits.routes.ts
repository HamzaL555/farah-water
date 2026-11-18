import { Router } from 'express';
import { Role } from '@prisma/client';
import { asyncHandler } from '../common/middleware/error';
import { requireAuth, requireRole } from '../common/middleware/auth';
import { validate } from '../common/middleware/validate';
import { actorOf, param } from '../common/utils/actor';
import { createDepositSchema, listDepositsSchema, uuidParam } from '../common/schemas';
import { parseLocalDateInput } from '../common/utils/date';
import { createDepositTx, getCustomerDepositSummary, listDeposits } from './deposits.service';

export const depositsRouter = Router();
depositsRouter.use(requireAuth, requireRole(Role.ADMIN));

// Customer deposit balance, read from the ledger - never from a stored field.
depositsRouter.get(
  '/summary/:id',
  validate(uuidParam, 'params'),
  asyncHandler(async (req, res) => {
    res.json({ data: await getCustomerDepositSummary(param(req, 'id')) });
  }),
);

depositsRouter.get(
  '/',
  validate(listDepositsSchema, 'query'),
  asyncHandler(async (req, res) => {
    res.json({ data: await listDeposits(req.query as never, actorOf(req)) });
  }),
);

// Take or refund a deposit. Admin-only by route and by service guard.
depositsRouter.post(
  '/',
  validate(createDepositSchema),
  asyncHandler(async (req, res) => {
    let occurredAt: Date | undefined;
    if (req.body.occurredAt) {
      try {
        occurredAt = parseLocalDateInput(req.body.occurredAt);
      } catch {
        occurredAt = undefined;
      }
    }
    const result = await createDepositTx(
      {
        customerId: req.body.customerId,
        type: req.body.type,
        amount: req.body.amount,
        bottleCount: req.body.bottleCount,
        note: req.body.note ?? null,
        occurredAt,
        idempotencyKey: req.body.idempotencyKey,
      },
      actorOf(req),
      req as never,
    );
    res.status(result.duplicate ? 200 : 201).json({ data: result, meta: { duplicate: result.duplicate } });
  }),
);
