import { beforeAll, afterAll, beforeEach } from 'vitest';
import type { Express } from 'express';
import bcrypt from 'bcryptjs';
import supertest from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/prisma';
import { Role } from '@prisma/client';
import { key } from '../helpers';

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
  'audit_logs',
  'inventory_transactions',
  'inventory_balances',
  'debt_adjustments',
  'payments',
  'deliveries',
  'customers',
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
    `TRUNCATE TABLE "audit_logs", "inventory_transactions", "inventory_balances", "debt_adjustments", "payments", "deliveries", "customers" RESTART IDENTITY CASCADE;`,
  );
  await prisma.$executeRaw`
    INSERT INTO inventory_balances ("key", scope, "workerId", quantity, "updatedAt")
    VALUES ('WAREHOUSE', 'WAREHOUSE'::"BalanceScope", NULL, 0, NOW())
    ON CONFLICT ("key") DO NOTHING
  `;
}

async function createUser(fullName: string, username: string, role: Role, password: string) {
  return prisma.user.create({
    data: {
      fullName,
      username,
      role,
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
  const worker = await createUser('Test Worker', 'worker', Role.WORKER, WORKER_PWD);
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

export const stockIn = (adminToken: string, bottleCount: number, note = 'test') =>
  api.post('/api/v1/inventory/stock-in').set(auth(adminToken)).send({ bottleCount, note });

export const issueStock = (adminToken: string, workerId: string, bottleCount: number, note = 'test issue') =>
  api.post('/api/v1/inventory/issue').set(auth(adminToken)).send({ workerId, bottleCount, note });

export async function makeCustomer(workerToken: string, name = 'Test Customer', address = 'Test Street 1') {
  const res = await api
    .post('/api/v1/customers')
    .set(auth(workerToken))
    .send({ name, address, phone: '+994501112233' });
  return res.body.data.customer as { id: string; name: string; address: string };
}

export interface DeliveryPayload {
  customerId?: string;
  customerName?: string;
  address?: string;
  bottleCount?: number;
  unitPrice?: string;
  paidAmount?: string;
  note?: string;
  idempotencyKey?: string;
  deliveredAt?: string;
}

export const makeDelivery = (workerToken: string, payload: DeliveryPayload = {}) =>
  api
    .post('/api/v1/deliveries')
    .set(auth(workerToken))
    .send({
      idempotencyKey: key(),
      customerName: 'Test Customer',
      address: 'Test Street 1',
      bottleCount: 10,
      unitPrice: '2.00',
      ...payload,
    });

export const makePayment = (workerToken: string, deliveryId: string, amount: string, extra: Record<string, unknown> = {}) =>
  api
    .post('/api/v1/payments')
    .set(auth(workerToken))
    .send({ idempotencyKey: key(), deliveryId, amount, ...extra });

export const getDelivery = (token: string, id: string) =>
  api.get(`/api/v1/deliveries/${id}`).set(auth(token));

export const listPayments = (token: string, query = '') =>
  api.get(`/api/v1/payments${query}`).set(auth(token));

export { prisma, key };
