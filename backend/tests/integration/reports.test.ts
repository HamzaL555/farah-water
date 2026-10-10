import { describe, expect, it } from 'vitest';
import {
  api,
  prisma,
  fx,
  auth,
  stockIn,
  issueStock,
  makeDelivery,
  makePayment,
  getDelivery,
} from './setup';

/** Seeds one delivery of 10 x 2.00 = 20.00 AZN with an optional payment. */
async function seedDelivery(paidAmount?: string) {
  await stockIn(fx.admin!.token, 1000);
  await issueStock(fx.admin!.token, fx.worker!.id, 500);
  const delivery = (await makeDelivery(fx.worker!.token, { bottleCount: 10, unitPrice: '2.00' })).body.data;
  if (paidAmount) await makePayment(fx.worker!.token, delivery.id, paidAmount);
  return delivery;
}

describe('revenue and reports', () => {
  it('counts only actually received cash as revenue', async () => {
    const d = await seedDelivery('12.00');

    const dash = (await api.get('/api/v1/dashboard/admin?preset=today').set(auth(fx.admin!.token))).body.data;

    // 12 AZN was really collected...
    expect(dash.finance.todayCollected).toBe(12);
    expect(dash.finance.todayPayments).toBe(1);
    // ...while 20 AZN was invoiced. These must never be conflated.
    expect(dash.finance.billedInRange).toBe(20);
    expect(dash.finance.totalOutstandingDebt).toBe(8);
    expect(d.id).toBeTruthy();
  });

  it('never reports unpaid debt as revenue', async () => {
    await seedDelivery(); // no payment at all

    const dash = (await api.get('/api/v1/dashboard/admin?preset=today').set(auth(fx.admin!.token))).body.data;
    expect(dash.finance.todayCollected).toBe(0);
    expect(dash.finance.billedInRange).toBe(20);
    expect(dash.finance.totalOutstandingDebt).toBe(20);
    expect(dash.finance.debtorCustomers).toBe(1);
  });

  it('counts a debt paid today as today cash and month cash exactly once', async () => {
    const delivery = await seedDelivery('12.00');
    // The remaining 8 AZN arrives today, for an old debt.
    await makePayment(fx.worker!.token, delivery.id, '8.00');

    const dash = (await api.get('/api/v1/dashboard/admin?preset=today').set(auth(fx.admin!.token))).body.data;

    expect(dash.finance.todayCollected).toBe(20);
    expect(dash.finance.todayPayments).toBe(2);
    expect(dash.finance.monthCollected).toBe(20);
    expect(dash.finance.totalOutstandingDebt).toBe(0);

    // The same payment is not double counted in the payments ledger.
    const payments = (await api.get('/api/v1/payments?preset=thisMonth').set(auth(fx.admin!.token))).body.data;
    expect(payments.totalAmount).toBe(20);
    expect(payments.total).toBe(2);
  });

  it('excludes a voided payment from revenue but keeps it in history', async () => {
    const delivery = await seedDelivery('20.00');
    const payment = (await api.get(`/api/v1/payments/delivery/${delivery.id}`).set(auth(fx.admin!.token))).body.data[0];

    await api
      .post(`/api/v1/payments/${payment.id}/void`)
      .set(auth(fx.admin!.token))
      .send({ reason: 'Test düzəliş' });

    const dash = (await api.get('/api/v1/dashboard/admin?preset=today').set(auth(fx.admin!.token))).body.data;
    expect(dash.finance.todayCollected).toBe(0);

    const history = (await api.get(`/api/v1/payments/delivery/${delivery.id}`).set(auth(fx.admin!.token))).body.data;
    expect(history).toHaveLength(1);
    expect(history[0].voidedAt).toBeTruthy();
  });

  it('splits revenue by payment method', async () => {
    const delivery = await seedDelivery();
    await makePayment(fx.worker!.token, delivery.id, '5.00', { method: 'CASH' });
    await makePayment(fx.worker!.token, delivery.id, '5.00', { method: 'CARD' });
    await makePayment(fx.worker!.token, delivery.id, '10.00', { method: 'TRANSFER' });

    const res = (await api.get('/api/v1/dashboard/revenue?preset=today').set(auth(fx.admin!.token))).body.data;

    const cash = res.byMethod.find((m: { method: string }) => m.method === 'CASH');
    const card = res.byMethod.find((m: { method: string }) => m.method === 'CARD');
    const transfer = res.byMethod.find((m: { method: string }) => m.method === 'TRANSFER');

    expect(cash.amount).toBe(5);
    expect(card.amount).toBe(5);
    expect(transfer.amount).toBe(10);
    expect(res.byWorker[0].amount).toBe(20);
  });

  it('reports warehouse and worker stock on the admin dashboard', async () => {
    await seedDelivery();
    const dash = (await api.get('/api/v1/dashboard/admin?preset=today').set(auth(fx.admin!.token))).body.data;

    expect(dash.inventory.warehouseQuantity).toBe(500);
    expect(dash.inventory.inWorkersHands).toBe(490);
    expect(dash.inventory.todayInbound).toBe(1000);
    expect(dash.deliveries.todayCount).toBe(1);
    expect(dash.deliveries.todayBottles).toBe(10);
  });

  it('shows the worker only their own dashboard figures', async () => {
    await seedDelivery('12.00');

    const dash = (await api.get('/api/v1/dashboard/worker').set(auth(fx.worker!.token))).body.data;
    expect(dash.todayBottles).toBe(10);
    expect(dash.todayDeliveries).toBe(1);
    expect(dash.todayCollected).toBe(12);
    expect(dash.outstandingDebt).toBe(8);
    expect(dash.outstandingDeliveryCount).toBe(1);
    expect(dash.stockInHand).toBe(490);

    // The other worker sees none of it.
    const other = (await api.get('/api/v1/dashboard/worker').set(auth(fx.worker2!.token))).body.data;
    expect(other.todayBottles).toBe(0);
    expect(other.todayCollected).toBe(0);
    expect(other.outstandingDebt).toBe(0);
    expect(other.stockInHand).toBe(0);
  });

  it('produces a daily report with money, deliveries and payments sections', async () => {
    await seedDelivery('12.00');

    const res = await api.get('/api/v1/reports?type=daily&preset=today&format=json').set(auth(fx.admin!.token));
    expect(res.statusCode).toBe(200);

    const report = res.body.data;
    expect(report.sections.length).toBeGreaterThan(0);

    const summary = report.sections.find((s: { heading: string }) => s.heading === 'Maliyyə xülasəsi');
    const rows = summary.rows.map((r: unknown[]) => r[0]);
    expect(rows).toContain('Faktiki daxil olan ödəniş (gəlir)');
    expect(rows).toContain('Çatdırılmış məbləğ ( faktura)');
    expect(rows).toContain('Qalan borc');

    const financeRow = summary.rows.find((r: unknown[]) => r[0] === 'Faktiki daxil olan ödəniş (gəlir)');
    expect(financeRow[1]).toBe(12);
  });

  it('exports a report as CSV', async () => {
    await seedDelivery('12.00');

    const res = await api.get('/api/v1/reports?type=daily&preset=today&format=csv').set(auth(fx.admin!.token));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    // UTF-8 BOM so Excel renders Azerbaijani characters correctly.
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    expect(res.text).toContain('Günlük hesabat');
    expect(res.text).toContain('Maliyyə xülasəsi');
  });

  it('exports a report as a valid PDF', async () => {
    await seedDelivery('12.00');

    const res = await api.get('/api/v1/reports?type=daily&preset=today&format=pdf').set(auth(fx.admin!.token));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);

    const body = res.body as Buffer;
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(body.length).toBeGreaterThan(1000);
    // PDF magic number.
    expect(body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('renders Azerbaijani characters in the PDF without crashing', async () => {
    await makeDelivery(fx.worker!.token, {
      customerName: 'Əliyev Rzağa',
      address: 'Bakı şəhəri, Nizami rayonu, küçə Əhməd Əli 15',
    });

    const res = await api.get('/api/v1/reports?type=period&format=pdf').set(auth(fx.admin!.token));
    expect(res.statusCode).toBe(200);
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('builds a customer debt rollup', async () => {
    // Two deliveries to the SAME customer (same name+address): one partly paid,
    // one unpaid. The rollup must merge them into a single row.
    const d1 = await seedDelivery('12.00');
    await makeDelivery(fx.worker!.token, { bottleCount: 5, unitPrice: '2.00', paidAmount: '0' });

    const res = (await api.get('/api/v1/debts/summary').set(auth(fx.admin!.token))).body.data;
    expect(Array.isArray(res)).toBe(true);

    const owing = res.find((r: { customerName: string }) => r.debtAmount > 0);
    expect(owing).toBeTruthy();
    // 20 - 12 paid = 8 debt, plus a second 10 AZN delivery still fully unpaid.
    expect(owing.debtAmount).toBe(18);
    expect(owing.totalAmount).toBe(30);
    expect(owing.paidAmount).toBe(12);
    expect(owing.deliveryCount).toBe(2);
    expect(d1.id).toBeTruthy();
  });

  it('lists only outstanding debts', async () => {
    await seedDelivery('12.00');
    await seedDelivery('20.00'); // fully paid

    const res = (await api.get('/api/v1/debts').set(auth(fx.admin!.token))).body.data;
    expect(res.total).toBe(1);
    expect(res.items[0].debtAmount).toBe(8);
    expect(res.totalDebt).toBe(8);
  });

  it('filters deliveries by status and by text search', async () => {
    await stockIn(fx.admin!.token, 200);
    await issueStock(fx.admin!.token, fx.worker!.id, 100);
    await makeDelivery(fx.worker!.token, { customerName: 'Axtarılan Adam', address: 'Qələm ünvanı', bottleCount: 10 });
    await makeDelivery(fx.worker!.token, { customerName: 'Başqa Adam', address: 'Digər ünvan', bottleCount: 5 });

    const byStatus = (await api.get('/api/v1/deliveries?status=UNPAID').set(auth(fx.admin!.token))).body.data;
    expect(byStatus.total).toBe(2);

    const bySearch = (await api.get('/api/v1/deliveries?search=Axtarılan').set(auth(fx.admin!.token))).body.data;
    expect(bySearch.total).toBe(1);
    expect(bySearch.items[0].customerName).toBe('Axtarılan Adam');

    const byAddress = (await api.get('/api/v1/deliveries?search=Qələm').set(auth(fx.admin!.token))).body.data;
    expect(byAddress.total).toBe(1);
  });

  it('paginates deliveries', async () => {
    await stockIn(fx.admin!.token, 500);
    await issueStock(fx.admin!.token, fx.worker!.id, 200);
    for (let i = 0; i < 5; i++) {
      await makeDelivery(fx.worker!.token, { bottleCount: 1, customerName: `Cust ${i}`, address: `Addr ${i}` });
    }

    const page1 = (await api.get('/api/v1/deliveries?page=1&pageSize=2').set(auth(fx.admin!.token))).body.data;
    expect(page1.items).toHaveLength(2);
    expect(page1.total).toBe(5);
    expect(page1.hasMore).toBe(true);

    const page3 = (await api.get('/api/v1/deliveries?page=3&pageSize=2').set(auth(fx.admin!.token))).body.data;
    expect(page3.items).toHaveLength(1);
    expect(page3.hasMore).toBe(false);
  });

  it('sorts deliveries by the requested column', async () => {
    await stockIn(fx.admin!.token, 500);
    await issueStock(fx.admin!.token, fx.worker!.id, 200);
    // Backdated so both rows land inside the same explicit range.
    const today = new Date().toISOString();
    await makeDelivery(fx.worker!.token, { bottleCount: 10, customerName: 'Big', address: 'Addr A1', deliveredAt: today });
    await makeDelivery(fx.worker!.token, { bottleCount: 2, customerName: 'Small', address: 'Addr A2', deliveredAt: today });

    const desc = (
      await api.get('/api/v1/deliveries?sortBy=bottleCount&sortDir=desc').set(auth(fx.admin!.token))
    ).body.data;
    expect(desc.items[0].bottleCount).toBe(10);

    const asc = (
      await api.get('/api/v1/deliveries?sortBy=bottleCount&sortDir=asc').set(auth(fx.admin!.token))
    ).body.data;
    expect(asc.items[0].bottleCount).toBe(2);
  });

  it('writes an audit log for every financial action', async () => {
    const delivery = await seedDelivery('12.00');
    const payment = (await getDelivery(fx.admin!.token, delivery.id)).body.data.payments[0];

    await api
      .post(`/api/v1/payments/${payment.id}/void`)
      .set(auth(fx.admin!.token))
      .send({ reason: 'audit test' });

    const actions = await prisma.auditLog.findMany({ select: { action: true, actorId: true } });
    const names = actions.map((a) => a.action);

    expect(names).toContain('delivery.created');
    expect(names).toContain('payment.created');
    expect(names).toContain('payment.voided');
    expect(actions.every((a) => a.actorId)).toBe(true);
  });

  it('exposes the audit log to admins only', async () => {
    await seedDelivery('12.00');
    const admin = await api.get('/api/v1/audit/logs').set(auth(fx.admin!.token));
    expect(admin.statusCode).toBe(200);
    expect(admin.body.data.items.length).toBeGreaterThan(0);

    const worker = await api.get('/api/v1/audit/logs').set(auth(fx.worker!.token));
    expect(worker.statusCode).toBe(403);
  });
});
