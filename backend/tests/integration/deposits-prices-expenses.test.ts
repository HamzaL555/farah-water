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
  getDelivery,
} from './setup';

const admin = () => fx.admin!.token;

const deposit = (body: Record<string, unknown>) =>
  api
    .post('/api/v1/deposits')
    .set(auth(admin()))
    .send({ idempotencyKey: key(), ...body });

const summaryOf = (customerId: string) =>
  api.get(`/api/v1/deposits/summary/${customerId}`).set(auth(admin()));

const setPrice = (waterType: 'FILTERED' | 'SPRING', price: string) =>
  api.put(`/api/v1/prices/${waterType}`).set(auth(admin())).send({ price });

const createExpense = (body: Record<string, unknown>) =>
  api
    .post('/api/v1/expenses')
    .set(auth(admin()))
    .send({ idempotencyKey: key(), ...body });

const financeOf = async () => (await api.get('/api/v1/dashboard/admin').set(auth(admin()))).body.data.finance;

describe('customer deposits', () => {
  it('records a deposit, tracks money and bottles separately, and never counts it as revenue', async () => {
    const customer = await makeCustomer(fx.worker!.token, 'Depozit Müştəri', 'Depozit küç. 1');

    const res = await deposit({ customerId: customer.id, type: 'DEPOSIT_IN', amount: '20.00', bottleCount: 2 });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.deposit.amount).toBe(20);
    expect(res.body.data.deposit.bottleCount).toBe(2);
    expect(res.body.data.balance).toBe(20);
    expect(res.body.data.bottleBalance).toBe(2);

    const summary = await summaryOf(customer.id);
    expect(summary.body.data).toMatchObject({ balance: 20, bottleBalance: 2, movements: 1 });

    // The deposit shows on the customer card, but not in the revenue ledger.
    const list = (await api.get('/api/v1/customers?search=Depozit').set(auth(admin()))).body.data.items;
    const row = list.find((c: { id: string }) => c.id === customer.id);
    expect(row.depositBalance).toBe(20);
    expect(row.depositBottleBalance).toBe(2);

    const detail = (await api.get(`/api/v1/customers/${customer.id}`).set(auth(admin()))).body.data;
    expect(detail.depositBalance).toBe(20);
    expect(detail.deposits).toHaveLength(1);

    const finance = await financeOf();
    expect(finance.collectedInRange).toBe(0);
    expect(finance.depositsHeld).toBe(20);
    expect(finance.revenueByWater.total).toBe(0);
  });

  it('refunds part of the deposit and blocks refunding more than is held', async () => {
    const customer = await makeCustomer(fx.worker!.token, 'Depozit Müştəri', 'Depozit küç. 1');
    await deposit({ customerId: customer.id, type: 'DEPOSIT_IN', amount: '20.00', bottleCount: 2 });

    const refund = await deposit({ customerId: customer.id, type: 'DEPOSIT_OUT', amount: '5.00', bottleCount: 1 });
    expect(refund.statusCode).toBe(201);
    expect(refund.body.data.balance).toBe(15);
    expect(refund.body.data.bottleBalance).toBe(1);
    // A refund is stored as a negative signed delta.
    expect(refund.body.data.deposit.amount).toBe(-5);
    expect(refund.body.data.deposit.bottleCount).toBe(-1);

    const tooMuch = await deposit({ customerId: customer.id, type: 'DEPOSIT_OUT', amount: '99.00', bottleCount: 1 });
    expect(tooMuch.statusCode).toBe(400);
    expect(tooMuch.body.error.message).toMatch(/mənfi/);

    const tooManyBottles = await deposit({ customerId: customer.id, type: 'DEPOSIT_OUT', amount: '1.00', bottleCount: 5 });
    expect(tooManyBottles.statusCode).toBe(400);

    const after = await summaryOf(customer.id);
    expect(after.body.data.balance).toBe(15);
    expect(after.body.data.bottleBalance).toBe(1);
  });

  it('is idempotent: replaying the same key does not double the balance', async () => {
    const customer = await makeCustomer(fx.worker!.token, 'Depozit Müştəri', 'Depozit küç. 1');
    const idem = key();
    const body = { customerId: customer.id, type: 'DEPOSIT_IN', amount: '10.00', bottleCount: 1, idempotencyKey: idem };

    const first = await deposit(body);
    expect(first.statusCode).toBe(201);
    const second = await deposit(body);
    expect(second.statusCode).toBe(200);
    expect(second.body.meta.duplicate).toBe(true);
    expect(second.body.data.deposit.id).toBe(first.body.data.deposit.id);

    expect((await summaryOf(customer.id)).body.data.balance).toBe(10);
    expect(await prisma.customerDeposit.count()).toBe(1);
  });

  it('keeps the ledger append-only: a direct UPDATE is refused by the database', async () => {
    const customer = await makeCustomer(fx.worker!.token, 'Depozit Müştəri', 'Depozit küç. 1');
    const row = (await deposit({ customerId: customer.id, type: 'DEPOSIT_IN', amount: '10.00', bottleCount: 1 })).body.data.deposit;

    await expect(
      prisma.$executeRawUnsafe(`UPDATE customer_deposits SET amount = 999 WHERE id = '${row.id}'`),
    ).rejects.toThrow();
    const unchanged = await prisma.customerDeposit.findUniqueOrThrow({ where: { id: row.id } });
    expect(Number(unchanged.amount)).toBe(10);
  });

  it('refuses deposits from a worker', async () => {
    const customer = await makeCustomer(fx.worker!.token, 'Depozit Müştəri', 'Depozit küç. 1');
    const res = await api
      .post('/api/v1/deposits')
      .set(auth(fx.worker!.token))
      .send({ customerId: customer.id, type: 'DEPOSIT_IN', amount: '10.00', bottleCount: 1 });
    expect(res.statusCode).toBe(403);
    expect(await prisma.customerDeposit.count()).toBe(0);
  });
});

describe('water prices', () => {
  it('keeps Bulaq and Filtr prices separate and applies the home price on delivery', async () => {
    const prices = (await api.get('/api/v1/prices').set(auth(fx.worker!.token))).body.data;
    expect(prices.map((p: { waterType: string }) => p.waterType).sort()).toEqual(['FILTERED', 'SPRING']);
    expect(prices.every((p: { price: number }) => p.price === 0)).toBe(true);

    expect((await setPrice('FILTERED', '2.50')).statusCode).toBe(200);
    expect((await setPrice('SPRING', '3.00')).statusCode).toBe(200);

    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);

    const home = await api
      .post('/api/v1/deliveries')
      .set(auth(fx.worker!.token))
      .send({ idempotencyKey: key(), customerName: 'Qiymət Müştəri', address: 'Qiymət küç. 1', bottleCount: 4 });
    expect(home.statusCode).toBe(201);
    expect(home.body.data.unitPrice).toBe(2.5);
    expect(home.body.data.totalAmount).toBe(10);

    // Spring stock and its own price: the two never share a number.
    const springIn = await api
      .post('/api/v1/inventory/stock-in')
      .set(auth(fx.worker!.token))
      .send({ waterType: 'SPRING', bottleCount: 50 });
    expect(springIn.statusCode).toBe(201);
    const springIssue = await api
      .post('/api/v1/inventory/distribute')
      .set(auth(fx.worker!.token))
      .send({ waterType: 'SPRING', workerId: fx.worker!.id, bottleCount: 10 });
    expect(springIssue.statusCode).toBe(201);

    const springDelivery = await api
      .post('/api/v1/deliveries')
      .set(auth(fx.worker!.token))
      .send({
        idempotencyKey: key(),
        customerName: 'Bulaq Müştəri',
        address: 'Bulaq küç. 2',
        bottleCount: 2,
        waterType: 'SPRING',
      });
    expect(springDelivery.statusCode).toBe(201);
    expect(springDelivery.body.data.unitPrice).toBe(3);
    expect(springDelivery.body.data.totalAmount).toBe(6);

    const history = (await api.get('/api/v1/prices/history').set(auth(admin()))).body.data;
    expect(history.total).toBe(2);
    expect(history.items.every((h: { source: string }) => h.source === 'ADMIN')).toBe(true);
  });

  it('lets a worker request a price and an admin approve it exactly once', async () => {
    const request = await api
      .post('/api/v1/prices/requests')
      .set(auth(fx.worker!.token))
      .send({ waterType: 'FILTERED', newPrice: '3.00', reason: 'Yeni maya dəyəri' });
    expect(request.statusCode).toBe(201);
    expect(request.body.data.status).toBe('PENDING');
    expect(request.body.data.oldPrice).toBe(0);

    // A second pending request for the same water type is refused.
    const dupe = await api
      .post('/api/v1/prices/requests')
      .set(auth(fx.worker!.token))
      .send({ waterType: 'FILTERED', newPrice: '3.50', reason: 'Yenə' });
    expect(dupe.statusCode).toBe(409);

    // Nothing changed while it waits.
    const before = (await api.get('/api/v1/prices').set(auth(admin()))).body.data.find(
      (p: { waterType: string }) => p.waterType === 'FILTERED',
    );
    expect(before.price).toBe(0);

    const approve = await api
      .patch(`/api/v1/prices/requests/${request.body.data.id}`)
      .set(auth(admin()))
      .send({ action: 'APPROVE', note: 'Qəbul edildi' });
    expect(approve.statusCode).toBe(200);
    expect(approve.body.data.price).toBe(3);

    const after = (await api.get('/api/v1/prices').set(auth(admin()))).body.data.find(
      (p: { waterType: string }) => p.waterType === 'FILTERED',
    );
    expect(after.price).toBe(3);

    // A second decision is impossible, so the price cannot be applied twice.
    const again = await api
      .patch(`/api/v1/prices/requests/${request.body.data.id}`)
      .set(auth(admin()))
      .send({ action: 'APPROVE' });
    expect(again.statusCode).toBe(409);

    const history = (await api.get('/api/v1/prices/history?waterType=FILTERED').set(auth(admin()))).body.data;
    expect(history.items[0]).toMatchObject({ source: 'PRICE_REQUEST', oldPrice: 0, newPrice: 3 });
  });

  it('rejects a request without changing the price', async () => {
    const request = await api
      .post('/api/v1/prices/requests')
      .set(auth(fx.worker!.token))
      .send({ waterType: 'SPRING', newPrice: '4.00', reason: 'Səhv təklif' });
    expect(request.statusCode).toBe(201);

    const reject = await api
      .patch(`/api/v1/prices/requests/${request.body.data.id}`)
      .set(auth(admin()))
      .send({ action: 'REJECT', note: 'Uyğun deyil' });
    expect(reject.statusCode).toBe(200);

    const prices = (await api.get('/api/v1/prices').set(auth(admin()))).body.data;
    expect(prices.find((p: { waterType: string }) => p.waterType === 'SPRING').price).toBe(0);
    expect(await prisma.priceHistory.count()).toBe(0);
  });

  it('blocks a worker from changing a price or reading the history', async () => {
    const put = await api.put('/api/v1/prices/FILTERED').set(auth(fx.worker!.token)).send({ price: '99.00' });
    expect(put.statusCode).toBe(403);
    const history = await api.get('/api/v1/prices/history').set(auth(fx.worker!.token));
    expect(history.statusCode).toBe(403);
  });
});

describe('expenses, revenue and profit', () => {
  it('splits revenue by water type and subtracts only real expenses from profit', async () => {
    // Filtr: 4 bottles at 2.50 = 10.00 paid in full.
    await setPrice('FILTERED', '2.50');
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const filteredDelivery = (
      await makeDelivery(fx.worker!.token, { bottleCount: 4, waterType: 'FILTERED', unitPrice: '2.50' })
    ).body.data;
    await api
      .post('/api/v1/payments')
      .set(auth(admin()))
      .send({ idempotencyKey: key(), deliveryId: filteredDelivery.id, amount: '10.00' });

    // Bulaq: 3 bottles at 3.00 = 9.00, kept in a separate bucket end to end.
    await api
      .post('/api/v1/inventory/stock-in')
      .set(auth(fx.worker!.token))
      .send({ waterType: 'SPRING', bottleCount: 50 });
    await api
      .post('/api/v1/inventory/distribute')
      .set(auth(fx.worker!.token))
      .send({ waterType: 'SPRING', workerId: fx.worker!.id, bottleCount: 10 });
    const springDelivery = (
      await makeDelivery(fx.worker!.token, {
        bottleCount: 3,
        waterType: 'SPRING',
        unitPrice: '3.00',
        customerName: 'Bulaq Müştəri',
        address: 'Bulaq küç. 3',
      })
    ).body.data;
    await api
      .post('/api/v1/payments')
      .set(auth(admin()))
      .send({ idempotencyKey: key(), deliveryId: springDelivery.id, amount: '9.00' });

    // A deposit must not migrate into revenue.
    const customer = await makeCustomer(fx.worker!.token, 'Depozit Müştəri', 'Depozit küç. 1');
    await deposit({ customerId: customer.id, type: 'DEPOSIT_IN', amount: '30.00', bottleCount: 3 });

    const before = await financeOf();
    expect(before.revenueByWater).toMatchObject({ filtered: 10, spring: 9, total: 19 });
    expect(before.expensesByWater.total).toBe(0);
    expect(before.profit.total).toBe(19);
    expect(before.depositsHeld).toBe(30);

    // Filtr-specific expense 4.00, shared expense 5.00.
    const filtrExpense = await createExpense({ category: 'FUEL', waterType: 'FILTERED', amount: '4.00', note: 'Filtr maşını' });
    expect(filtrExpense.statusCode).toBe(201);
    const sharedExpense = await createExpense({ category: 'RENT', amount: '5.00', note: 'Ofis' });
    expect(sharedExpense.statusCode).toBe(201);

    const after = await financeOf();
    expect(after.expensesByWater).toMatchObject({ filtered: 4, spring: 0, shared: 5, total: 9 });
    // Per-water profit subtracts only that type's own expense.
    expect(after.profit.filtered).toBe(6);
    expect(after.profit.spring).toBe(9);
    // Overall profit also carries the unallocated shared cost.
    expect(after.profit.total).toBe(10);
    // Deposits remain held money, outside every profit figure.
    expect(after.revenueByWater.total).toBe(19);

    // Voiding the filtr expense restores that water type's profit.
    const voided = await api
      .post(`/api/v1/expenses/${filtrExpense.body.data.expense.id}/void`)
      .set(auth(admin()))
      .send({ reason: 'Səhv qeyd' });
    expect(voided.statusCode).toBe(200);

    const restored = await financeOf();
    expect(restored.expensesByWater.filtered).toBe(0);
    expect(restored.profit.filtered).toBe(10);
    expect(restored.profit.total).toBe(14);

    // A second void is refused.
    const twice = await api
      .post(`/api/v1/expenses/${filtrExpense.body.data.expense.id}/void`)
      .set(auth(admin()))
      .send({ reason: 'Yenə' });
    expect(twice.statusCode).toBe(409);
  });

  it('is idempotent and refuses negative or worker-created expenses', async () => {
    const idem = key();
    const body = { idempotencyKey: idem, category: 'OTHER', amount: '12.50' };
    const first = await createExpense(body);
    expect(first.statusCode).toBe(201);
    const second = await createExpense(body);
    expect(second.statusCode).toBe(200);
    expect(second.body.meta.duplicate).toBe(true);
    expect(await prisma.expense.count()).toBe(1);

    const negative = await createExpense({ category: 'OTHER', amount: '-3.00' });
    expect(negative.statusCode).toBe(422);

    const workerRes = await api
      .post('/api/v1/expenses')
      .set(auth(fx.worker!.token))
      .send({ category: 'FUEL', amount: '5.00' });
    expect(workerRes.statusCode).toBe(403);

    const workerList = await api.get('/api/v1/expenses').set(auth(fx.worker!.token));
    expect(workerList.statusCode).toBe(403);
  });

  it('includes per-water revenue and profit in the generated report', async () => {
    await setPrice('FILTERED', '2.00');
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const delivery = (await makeDelivery(fx.worker!.token, { bottleCount: 5 })).body.data;
    await api
      .post('/api/v1/payments')
      .set(auth(admin()))
      .send({ idempotencyKey: key(), deliveryId: delivery.id, amount: '10.00' });
    await createExpense({ category: 'SUPPLIES', waterType: 'FILTERED', amount: '3.00' });

    const report = await api
      .get('/api/v1/reports?type=daily&format=json')
      .set(auth(admin()));
    expect(report.statusCode).toBe(200);
    const section = report.body.data.sections.find((s: { heading: string }) => s.heading.startsWith('Su növü üzrə'));
    expect(section).toBeTruthy();
    const flat = section.rows.map((r: (string | number)[]) => r.join('|'));
    expect(flat).toContain('Filtr suyu - gəlir|10');
    expect(flat).toContain('Bulaq suyu - gəlir|0');
    expect(flat).toContain('Filtr suyu - mənfəət|7');
  });
});
