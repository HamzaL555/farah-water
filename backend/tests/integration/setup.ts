import { beforeAll, afterAll, beforeEach } from 'vitest';
import type { Express } from 'express';
import bcrypt from 'bcryptjs';
import supertest from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/prisma';
import { Role, WorkerType } from '@prisma/client';
import { key } from '../helpers';
import { assertSafeTestDatabase } from '../helpers/test-db-guard';

// Second line of defence. vitest.config.ts already runs this before the suite
// boots, but resetDb() below truncates the target database, so the check is
// repeated here where the destructive call actually lives.
assertSafeTestDatabase(process.env.DATABASE_URL ?? '');

/**
 * Integration fixtures.
 *
 * Tests drive the real Express app through supertest, so the full middleware
 * chain runs (helmet, CORS, rate limiting, body parsing, auth, error handler).
 */
export const app: Express = createApp();
export const api = supertest(app);

const ROUNDS = 4; // fast for tests; production uses 12

export interface UserFixture {
  id: string;
  username: string;
  password: string;
  token: string;
}

export const fx: { admin?: UserFixture; worker?: UserFixture; worker2?: UserFixture } = {};

/** Tables in dependency order. TRUNCATE bypasses the per-row DELETE triggers. */
const TABLES = [
  'notifications',
  'audit_logs',
  'inventory_transactions',
  'inventory_balances',
  'debt_adjustments',
  'payments',
  'delivery_corrections',
  'deliveries',
  'customer_deposits',
  'customers',
  'price_history',
  'price_change_requests',
  'expenses',
  'login_attempts',
  'refresh_tokens',
  'app_settings',
  'users',
];

export async function resetDb(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE;`,
  );
}

/** Clears transactional state between tests but keeps the user fixtures. */
export async function resetTransactionalData(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "notifications", "audit_logs", "inventory_transactions", "inventory_balances", "debt_adjustments", "payments", "delivery_corrections", "customer_deposits", "deliveries", "customers", "price_history", "price_change_requests", "expenses" RESTART IDENTITY CASCADE;`,
  );
  // A price set by one test must not leak into the next: the company price is
  // part of the fixture, and the default after a reset is 0 (unset).
  await prisma.$executeRaw`
    UPDATE water_prices SET price = 0, "updatedById" = NULL, "effectiveFrom" = NOW()
  `;
  // The balance table is keyed by water type as well, so seed both anbar
  // buckets rather than the pre-split "WAREHOUSE" row. Otherwise a stray
  // zero row could shadow the real total when the summary groups by water type.
  await prisma.$executeRaw`
    INSERT INTO inventory_balances ("key", scope, "workerId", "waterType", quantity, "updatedAt")
    VALUES
      ('WAREHOUSE:FILTERED', 'WAREHOUSE'::"BalanceScope", NULL, 'FILTERED'::"WaterType", 0, NOW()),
      ('WAREHOUSE:SPRING', 'WAREHOUSE'::"BalanceScope", NULL, 'SPRING'::"WaterType", 0, NOW())
    ON CONFLICT ("key") DO NOTHING
  `;
}

async function createUser(
  fullName: string,
  username: string,
  role: Role,
  password: string,
  workerType?: WorkerType,
) {
  return prisma.user.create({
    data: {
      fullName,
      username,
      role,
      workerType,
      passwordHash: await bcrypt.hash(password, ROUNDS),
      isActive: true,
      mustChangePassword: false,
      phone: `+99450${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`,
    },
  });
}

export const ADMIN_PWD = 'AdminPass123!';
export const WORKER_PWD = 'WorkerPass123!';

beforeAll(async () => {
  await resetDb();

  const admin = await createUser('Test Admin', 'admin', Role.ADMIN, ADMIN_PWD);
  const worker = await createUser('Test Worker', 'worker', Role.WORKER, WORKER_PWD, WorkerType.WAREHOUSE_KEEPER);
  const worker2 = await createUser('Other Worker', 'worker2', Role.WORKER, WORKER_PWD);

  const [adminRes, workerRes, worker2Res] = await Promise.all([
    api.post('/api/v1/auth/login').send({ identifier: 'admin', password: ADMIN_PWD }),
    api.post('/api/v1/auth/login').send({ identifier: 'worker', password: WORKER_PWD }),
    api.post('/api/v1/auth/login').send({ identifier: 'worker2', password: WORKER_PWD }),
  ]);

  fx.admin = { id: admin.id, username: 'admin', password: ADMIN_PWD, token: adminRes.body.data.tokens.accessToken };
  fx.worker = { id: worker.id, username: 'worker', password: WORKER_PWD, token: workerRes.body.data.tokens.accessToken };
  fx.worker2 = { id: worker2.id, username: 'worker2', password: WORKER_PWD, token: worker2Res.body.data.tokens.accessToken };
});

beforeEach(async () => {
  await resetTransactionalData();
});

afterAll(async () => {
  await prisma.$disconnect();
});

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// ------------------------------ call helpers -------------------------------

/**
 * Stock-in is run by the anbardar (the keeper fixture).
 *
 * The parameter still reads as `_callerToken` because that is who used to call
 * it; the helper fetches the keeper token from the fixture inside.
 */
const workerTokenOf = () => fx.worker!.token;

export const stockIn = (_callerToken: string, bottleCount: number, note = 'test') =>
  api.post('/api/v1/inventory/stock-in').set(auth(workerTokenOf())).send({ bottleCount, waterType: 'FILTERED', note });

/**
 * Hands warehouse stock to a named worker, the way the anbardar does in the
 * product. A regular worker cannot take stock directly any more, so tests that
 * need worker2 to hold bottles must go through /distribute.
 */
export const issueStock = (_callerToken: string, workerId: string, bottleCount: number, note = 'test issue') =>
  api
    .post('/api/v1/inventory/distribute')
    .set(auth(workerTokenOf()))
    .send({ bottleCount, waterType: 'FILTERED', note, workerId });

export async function makeCustomer(workerToken: string, name = 'Test Customer', address = 'Test Street 1') {
  const res = await api
    .post('/api/v1/customers')
    .set(auth(workerToken))
    .send({ name, address, phone: '+994501112233' });
  return res.body.data.customer as { id: string; name: string; address: string };
}

/**
 * The spec's worked example: 10 bottles at 2.00. Applied by the admin after
 * creation, because a worker no longer sends a price.
 */
const DEFAULT_PRICE = '2.00';

export interface DeliveryPayload {
  customerId?: string;
  customerName?: string;
  address?: string;
  bottleCount?: number;
  /**
   * No longer sent by the client - the worker does not set prices. The helper
   * still accepts it so a test can state the price it wants, and applies it
   * afterwards as the admin would.
   */
  unitPrice?: string;
  /** Same: applied by the admin afterwards, not sent at creation. */
  paidAmount?: string;
  note?: string;
  idempotencyKey?: string;
  deliveredAt?: string;
  waterType?: 'FILTERED' | 'SPRING';
  destinationType?: 'HOME' | 'COMPANY';
  companyId?: string;
  officeId?: string;
}

/**
 * Creates a delivery as the worker, then applies the price (and any paid
 * amount) the test asked for using the admin token.
 *
 * A delivery is born at 0.00 now, because the worker does not set prices. Every
 * arithmetic test therefore needs the admin step; doing it here keeps the tests
 * describing business outcomes instead of API choreography, and keeps the
 * 10 x 2.00 = 20.00 worked example from the spec as the default.
 *
 * The returned object keeps the POST's status code, so callers can still assert
 * "created" (201), while `body.data` is the settled delivery.
 */
export const makeDelivery = async (workerToken: string, payload: DeliveryPayload = {}) => {
  const { unitPrice = DEFAULT_PRICE, paidAmount, ...body } = payload;

  const res = await api
    .post('/api/v1/deliveries')
    .set(auth(workerToken))
    .send({
      idempotencyKey: key(),
      customerName: 'Test Customer',
      address: 'Test Street 1',
      bottleCount: 10,
      ...body,
    });

  // A rejection, or a duplicate replay: hand it back untouched so the caller
  // still sees the real status and the `meta.duplicate` flag.
  if (res.statusCode !== 201) return res;

  const deliveryId = res.body.data.id as string;
  const patch = await api
    .patch(`/api/v1/deliveries/${deliveryId}`)
    .set(auth(fx.admin!.token))
    .send({ unitPrice, paidAmount: paidAmount ?? '0', reason: 'test setup' });

  // The settling step is part of what the caller asked for. If it is rejected -
  // say, a paid amount larger than the total - report that failure rather than
  // returning a delivery that quietly has a different shape than requested.
  if (patch.statusCode >= 400) return patch;

  const settled = (await api.get(`/api/v1/deliveries/${deliveryId}`).set(auth(workerToken))).body.data;
  return { ...res, body: { ...res.body, data: settled } };
};

/**
 * Records a payment as the ADMIN.
 *
 * Payments are admin-only by design, so the worker token argument is kept only
 * to name the delivery's owner in a failure message. Tests that assert the
 * restriction itself call the endpoint directly.
 */
export const makePayment = (_workerToken: string, deliveryId: string, amount: string, extra: Record<string, unknown> = {}) =>
  api
    .post('/api/v1/payments')
    .set(auth(fx.admin!.token))
    .send({ idempotencyKey: key(), deliveryId, amount, ...extra });

export const getDelivery = (token: string, id: string) =>
  api.get(`/api/v1/deliveries/${id}`).set(auth(token));

export const listPayments = (token: string, query = '') =>
  api.get(`/api/v1/payments${query}`).set(auth(token));

export { prisma, key };
