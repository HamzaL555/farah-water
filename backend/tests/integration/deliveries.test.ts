import { describe, expect, it } from 'vitest';
import {
  api,
  prisma,
  fx,
  auth,
  key,
  stockIn,
  issueStock,
  makeCustomer,
  makeDelivery,
  makePayment,
  getDelivery,
  listPayments,
} from './setup';

describe('deliveries, payments and debts', () => {
  it('creates a delivery and computes total, debt and status (10 x 2.00 = 20.00)', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);

    const res = await makeDelivery(fx.worker!.token, { bottleCount: 10, unitPrice: '2.00' });
    expect(res.statusCode).toBe(201);

    const d = res.body.data;
    expect(d.totalAmount).toBe(20);
    expect(d.paidAmount).toBe(0);
    expect(d.debtAmount).toBe(20);
    expect(d.status).toBe('UNPAID');
  });

  it('handles partial payment: 12 of 20 AZN leaves 8 AZN debt', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const delivery = (await makeDelivery(fx.worker!.token)).body.data;

    const pay = await makePayment(fx.worker!.token, delivery.id, '12.00');
    expect(pay.statusCode).toBe(201);

    const detail = (await getDelivery(fx.worker!.token, delivery.id)).body.data;
    expect(detail.paidAmount).toBe(12);
    expect(detail.debtAmount).toBe(8);
    expect(detail.status).toBe('PARTIAL');
    expect(detail.payments).toHaveLength(1);
  });

  it('clears the debt on the final payment and counts revenue exactly once', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const delivery = (await makeDelivery(fx.worker!.token)).body.data;

    await makePayment(fx.worker!.token, delivery.id, '12.00');
    await makePayment(fx.worker!.token, delivery.id, '8.00');

    const detail = (await getDelivery(fx.worker!.token, delivery.id)).body.data;
    expect(detail.paidAmount).toBe(20);
    expect(detail.debtAmount).toBe(0);
    expect(detail.status).toBe('PAID');
    expect(detail.payments).toHaveLength(2);

    const payments = (await listPayments(fx.admin!.token)).body.data;
    expect(payments.totalAmount).toBe(20);
  });

  it('refuses a payment that exceeds the outstanding debt', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const delivery = (await makeDelivery(fx.worker!.token)).body.data;

    const res = await makePayment(fx.worker!.token, delivery.id, '25.00');
    expect(res.statusCode).toBe(400);
    expect(res.body.error.message).toMatch(/20\.00/);
  });

  it('rejects a duplicate payment idempotency key instead of double counting', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const delivery = (await makeDelivery(fx.worker!.token)).body.data;

    const idemKey = key();
    const first = await makePayment(fx.worker!.token, delivery.id, '5.00', { idempotencyKey: idemKey });
    expect(first.statusCode).toBe(201);

    // Replaying the same key (e.g. an offline-queue retry) is a no-op.
    const second = await makePayment(fx.worker!.token, delivery.id, '5.00', { idempotencyKey: idemKey });
    expect(second.statusCode).toBe(200);
    expect(second.body.meta.duplicate).toBe(true);
    expect(second.body.data.id).toBe(first.body.data.id);

    const detail = (await getDelivery(fx.worker!.token, delivery.id)).body.data;
    expect(detail.paidAmount).toBe(5);
    expect(detail.payments).toHaveLength(1);
  });

  it('rejects a duplicate delivery key and does not deduct stock twice', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);

    const idemKey = key();
    const first = await makeDelivery(fx.worker!.token, { idempotencyKey: idemKey });
    expect(first.statusCode).toBe(201);

    const second = await makeDelivery(fx.worker!.token, { idempotencyKey: idemKey });
    expect(second.statusCode).toBe(200);
    expect(second.body.meta.duplicate).toBe(true);

    // The worker must have lost exactly 10 bottles, not 20.
    const stock = (await api.get('/api/v1/inventory/my-stock').set(auth(fx.worker!.token))).body.data;
    expect(stock.quantity).toBe(40);

    expect(await prisma.delivery.count()).toBe(1);
    expect(await prisma.inventoryTransaction.count({ where: { type: 'OUT_DELIVERY' } })).toBe(1);
  });

  it('cannot mark a delivery paid by sending status=PAID', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const delivery = (await makeDelivery(fx.worker!.token)).body.data;

    // A malicious client posts forged financial fields; they are ignored.
    const res = await api
      .post('/api/v1/payments')
      .set(auth(fx.worker!.token))
      .send({
        idempotencyKey: key(),
        deliveryId: delivery.id,
        amount: '0',
        status: 'PAID',
        debtAmount: 0,
      });
    expect(res.statusCode).toBe(400);

    const after = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after.status).toBe('UNPAID');
    expect(Number(after.debtAmount)).toBe(20);
  });

  it('cannot clear debt through a forged delivery payload', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);

    const res = await api
      .post('/api/v1/deliveries')
      .set(auth(fx.worker!.token))
      .send({
        idempotencyKey: key(),
        customerName: 'Test Customer',
        address: 'Test Street 1',
        bottleCount: 10,
        unitPrice: '2.00',
        paidAmount: '0',
        status: 'PAID',
        debtAmount: 0,
        totalAmount: 0,
      });

    expect(res.statusCode).toBe(201);
    const created = await prisma.delivery.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(created.status).toBe('UNPAID');
    expect(Number(created.debtAmount)).toBe(20);
    expect(Number(created.totalAmount)).toBe(20);
  });

  it('records an initial payment made at delivery time', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);

    const res = await makeDelivery(fx.worker!.token, { bottleCount: 10, unitPrice: '2.00', paidAmount: '12.00' });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.paidAmount).toBe(12);
    expect(res.body.data.debtAmount).toBe(8);
    expect(res.body.data.status).toBe('PARTIAL');
  });

  it('rejects an initial payment greater than the total', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);

    const res = await makeDelivery(fx.worker!.token, { paidAmount: '30.00' });
    expect(res.statusCode).toBe(400);
  });

  it('records an admin debt waiver without inflating revenue', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const delivery = (await makeDelivery(fx.worker!.token)).body.data;
    await makePayment(fx.worker!.token, delivery.id, '12.00');

    const adj = await api
      .post('/api/v1/debts/adjustments')
      .set(auth(fx.admin!.token))
      .send({ deliveryId: delivery.id, type: 'FORGIVE', amount: '8.00', reason: 'Müştəri ilə razılaşma' });
    expect(adj.statusCode).toBe(201);

    const detail = (await getDelivery(fx.admin!.token, delivery.id)).body.data;
    expect(detail.debtAmount).toBe(0);
    expect(detail.status).toBe('PAID');
    // `paidAmount` is the SETTLED figure (12 paid + 8 waived = 20), because the
    // database enforces debt = total - paid.
    expect(detail.paidAmount).toBe(20);
    expect(detail.debtAdjustments).toHaveLength(1);
    // But only 12 AZN was actually received: revenue comes from payments only,
    // so the waiver cannot inflate income.
    expect((await listPayments(fx.admin!.token)).body.data.totalAmount).toBe(12);
  });

  it('refuses a worker trying to adjust debt', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const delivery = (await makeDelivery(fx.worker!.token)).body.data;

    const res = await api
      .post('/api/v1/debts/adjustments')
      .set(auth(fx.worker!.token))
      .send({ deliveryId: delivery.id, type: 'FORGIVE', amount: '20.00', reason: 'cheating' });
    expect(res.statusCode).toBe(403);
  });

  it('voids a payment and restores the debt (admin only)', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const delivery = (await makeDelivery(fx.worker!.token)).body.data;
    const payment = (await makePayment(fx.worker!.token, delivery.id, '20.00')).body.data;

    expect((await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe('PAID');

    const workerAttempt = await api
      .post(`/api/v1/payments/${payment.id}/void`)
      .set(auth(fx.worker!.token))
      .send({ reason: 'not mine' });
    expect(workerAttempt.statusCode).toBe(403);

    const voidRes = await api
      .post(`/api/v1/payments/${payment.id}/void`)
      .set(auth(fx.admin!.token))
      .send({ reason: 'Yanlış məbləğ daxil edilib' });
    expect(voidRes.statusCode).toBe(200);

    const after = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after.status).toBe('UNPAID');
    expect(Number(after.debtAmount)).toBe(20);

    // The voided payment must NOT count as revenue.
    expect((await listPayments(fx.admin!.token)).body.data.totalAmount).toBe(0);

    // But it stays visible in the history.
    const withVoided = (await listPayments(fx.admin!.token, '?includeVoided=true')).body.data;
    expect(withVoided.items[0].voidedAt).toBeTruthy();
  });

  it('keeps earlier payments when a new one is added (never overwrites)', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const delivery = (await makeDelivery(fx.worker!.token)).body.data;

    await makePayment(fx.worker!.token, delivery.id, '5.00');
    await makePayment(fx.worker!.token, delivery.id, '5.00');
    await makePayment(fx.worker!.token, delivery.id, '5.00');

    const detail = (await getDelivery(fx.worker!.token, delivery.id)).body.data;
    expect(detail.payments).toHaveLength(3);
    expect(detail.paidAmount).toBe(15);
    expect(detail.debtAmount).toBe(5);
  });

  it('preserves decimal precision with awkward unit prices', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);

    const res = await makeDelivery(fx.worker!.token, { bottleCount: 3, unitPrice: '19.99' });
    expect(res.body.data.totalAmount).toBe(59.97);
  });
});

describe('role separation', () => {
  it('stops a worker reading another worker deliveries', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    await issueStock(fx.admin!.token, fx.worker2!.id, 50);

    const d1 = (await makeDelivery(fx.worker!.token, { address: 'Worker1 Street' })).body.data;

    const peek = await api.get(`/api/v1/deliveries/${d1.id}`).set(auth(fx.worker2!.token));
    expect(peek.statusCode).toBe(403);
  });

  it('limits a worker list to their own deliveries even when filtering by another worker', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    await issueStock(fx.admin!.token, fx.worker2!.id, 50);

    await makeDelivery(fx.worker!.token, { address: 'Mine' });
    await makeDelivery(fx.worker2!.token, { customerName: 'Other', address: 'Theirs' });

    const res = await api.get(`/api/v1/deliveries?workerId=${fx.worker2!.id}`).set(auth(fx.worker!.token));
    expect(res.statusCode).toBe(200);
    const items = res.body.data.items;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((d: { address: string }) => d.address === 'Mine')).toBe(true);
  });

  it('blocks workers from admin-only endpoints', async () => {
    const endpoints: Array<['get' | 'post' | 'patch', string]> = [
      ['get', '/api/v1/dashboard/admin'],
      ['get', '/api/v1/dashboard/revenue'],
      ['get', '/api/v1/users'],
      ['get', '/api/v1/users/stats'],
      ['get', '/api/v1/audit/logs'],
    ];

    for (const [method, url] of endpoints) {
      const res = await api[method](url).set(auth(fx.worker!.token));
      expect(res.statusCode, `${method.toUpperCase()} ${url} must be admin-only`).toBe(403);
    }
  });

  it('lets a worker record bottles arriving, but keeps issuing admin-only', async () => {
    // Workers physically count what arrives, so INBOUND is open to them.
    const inbound = await api
      .post('/api/v1/inventory/stock-in')
      .set(auth(fx.worker!.token))
      .send({ bottleCount: 100, note: 'Sayım' });
    expect(inbound.statusCode).toBe(201);

    // Handing stock to another worker stays an admin responsibility.
    const issue = await api
      .post('/api/v1/inventory/issue')
      .set(auth(fx.worker!.token))
      .send({ workerId: fx.worker2!.id, bottleCount: 10 });
    expect(issue.statusCode).toBe(403);

    // And the warehouse ledger must attribute the entry to the worker.
    const ledger = await api.get('/api/v1/inventory/transactions?pageSize=50').set(auth(fx.admin!.token));
    const entry = ledger.body.data.items.find(
      (t: { createdById: string; type: string }) => t.createdById === fx.worker!.id && t.type === 'INBOUND',
    );
    expect(entry?.createdByRole, 'the warehouse ledger must attribute the entry').toBe('WORKER');
    expect(entry?.createdByName, 'and must show who recorded it').toBeTruthy();
  });

  it('lists every worker account for the admin handover picker', async () => {
    // worker2 has never received stock, so it has no balance row; it must
    // still appear with quantity 0 instead of being missing.
    const res = await api.get('/api/v1/inventory/summary').set(auth(fx.admin!.token));
    const ids: string[] = res.body.data.workers.map((w: { workerId: string }) => w.workerId);
    expect(ids).toContain(fx.worker2!.id);
    const row = res.body.data.workers.find((w: { workerId: string }) => w.workerId === fx.worker2!.id);
    expect(row.quantity).toBe(0);
  });

  it('blocks a worker from creating another user', async () => {
    const res = await api
      .post('/api/v1/users')
      .set(auth(fx.worker!.token))
      .send({ fullName: 'Fake Admin', username: 'fakeadmin', password: 'FakePass123!' });
    expect(res.statusCode).toBe(403);
  });

  it('allows an admin to see all deliveries', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    await issueStock(fx.admin!.token, fx.worker2!.id, 50);
    await makeDelivery(fx.worker!.token, { customerName: 'Cust A', address: 'Addr A' });
    await makeDelivery(fx.worker2!.token, { customerName: 'Cust B', address: 'Addr B' });

    const res = await api.get('/api/v1/deliveries').set(auth(fx.admin!.token));
    expect(res.body.data.items.length).toBe(2);
  });
});

describe('customers', () => {
  it('creates a customer', async () => {
    const res = await api
      .post('/api/v1/customers')
      .set(auth(fx.worker!.token))
      .send({ name: 'Ali Məmmədov', address: 'Bakı, Nizami küç. 12', phone: '+994501234567' });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.customer.name).toBe('Ali Məmmədov');
  });

  it('reuses an existing customer for the same name and address', async () => {
    const first = await makeCustomer(fx.worker!.token, 'Repeated Person', 'Same Address 1');
    const second = await api
      .post('/api/v1/customers')
      .set(auth(fx.worker!.token))
      .send({ name: 'Repeated Person', address: 'Same Address 1' });
    expect(second.body.data.created).toBe(false);
    expect(second.body.data.customer.id).toBe(first.id);
  });

  it('validates the customer payload', async () => {
    const res = await api.post('/api/v1/customers').set(auth(fx.worker!.token)).send({ name: '', address: '' });
    expect(res.statusCode).toBe(422);
  });
});

describe('input validation', () => {
  it('rejects a zero or negative bottle count', async () => {
    expect((await makeDelivery(fx.worker!.token, { bottleCount: 0 })).statusCode).toBe(422);
    expect((await makeDelivery(fx.worker!.token, { bottleCount: -5 })).statusCode).toBe(422);
  });

  it('rejects a non-numeric bottle count', async () => {
    const res = await makeDelivery(fx.worker!.token, { bottleCount: 'abc' as never });
    expect(res.statusCode).toBe(422);
  });

  it('rejects a negative unit price', async () => {
    const res = await makeDelivery(fx.worker!.token, { unitPrice: '-5.00' });
    expect(res.statusCode).toBe(422);
  });

  it('rejects a future delivery date', async () => {
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const res = await makeDelivery(fx.worker!.token, { deliveredAt: future });
    expect(res.statusCode).toBe(400);
  });

  it('accepts a plain YYYY-MM-DD delivery date', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);

    const res = await makeDelivery(fx.worker!.token, { deliveredAt: '2026-06-15' });
    expect(res.statusCode).toBe(201);
    // Must land on the local day, not shifted to the previous day by UTC parsing.
    expect(new Date(res.body.data.deliveredAt).toISOString()).toBe('2026-06-14T20:00:00.000Z');
  });

  it('rejects a malformed id in the path', async () => {
    const res = await api.get('/api/v1/deliveries/not-a-uuid').set(auth(fx.worker!.token));
    expect(res.statusCode).toBe(422);
  });

  it('returns 404 for a well-formed but unknown id', async () => {
    const res = await api
      .get('/api/v1/deliveries/11111111-1111-4111-8111-111111111111')
      .set(auth(fx.worker!.token));
    expect(res.statusCode).toBe(404);
  });

  it('rejects a payment with no amount', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const delivery = (await makeDelivery(fx.worker!.token)).body.data;

    const res = await api
      .post('/api/v1/payments')
      .set(auth(fx.worker!.token))
      .send({ idempotencyKey: key(), deliveryId: delivery.id });
    expect(res.statusCode).toBe(422);
  });
});
