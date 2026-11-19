import { describe, expect, it } from 'vitest';
import { api, prisma, fx, auth, key, stockIn, issueStock, makeDelivery, makePayment } from './setup';

const WAREHOUSE = 'WAREHOUSE:FILTERED';
const workerKey = (id: string, waterType = 'FILTERED') => `WORKER:${id}:${waterType}`;

async function balances() {
  const rows = await prisma.inventoryBalance.findMany();
  const map: Record<string, number> = {};
  for (const r of rows) map[r.key] = r.quantity;
  return map;
}

describe('inventory and stock accounting', () => {
  it('receives stock into the warehouse', async () => {
    const res = await stockIn(fx.admin!.token, 200);
    expect(res.statusCode).toBe(201);
    expect((await balances())[WAREHOUSE]).toBe(200);
  });

  it('issues stock to a worker, moving bottles warehouse -> worker', async () => {
    await stockIn(fx.admin!.token, 200);
    const res = await issueStock(fx.admin!.token, fx.worker!.id, 50);
    expect(res.statusCode).toBe(201);

    const b = await balances();
    expect(b[WAREHOUSE]).toBe(150);
    expect(b[workerKey(fx.worker!.id)]).toBe(50);
  });

  it('deducts bottles from the worker when a delivery is confirmed', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);

    await makeDelivery(fx.worker!.token, { bottleCount: 10, unitPrice: '2.00' });

    const b = await balances();
    expect(b[workerKey(fx.worker!.id)]).toBe(40);
    expect(b[WAREHOUSE]).toBe(50); // unchanged by the delivery itself
  });

  it('refuses to confirm a delivery that exceeds the worker stock in hand', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 10);

    // Recording the drop is harmless: no stock moves until confirmation.
    const created = await api
      .post('/api/v1/deliveries')
      .set(auth(fx.worker!.token))
      .send({ idempotencyKey: key(), customerName: 'Test Customer', address: 'Test Street 1', bottleCount: 25 });
    expect(created.statusCode).toBe(201);
    expect(created.body.data.isConfirmed).toBe(false);
    expect((await balances())[workerKey(fx.worker!.id)]).toBe(10);

    // Confirming is where the balance is checked. It must refuse and leave the
    // row pending rather than deducting what is not there.
    const res = await api
      .post(`/api/v1/deliveries/${created.body.data.id}/confirm`)
      .set(auth(fx.worker!.token))
      .send({});
    expect(res.statusCode).toBe(409);
    expect(res.body.error.message).toMatch(/kifayət qədər/i);

    // Nothing moved: no ledger entry, stock unchanged, still pending.
    expect(await prisma.inventoryTransaction.count({ where: { type: 'OUT_DELIVERY' } })).toBe(0);
    expect((await balances())[workerKey(fx.worker!.id)]).toBe(10);
    const stored = await prisma.delivery.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(stored.confirmedAt).toBeNull();
  });

  it('refuses to issue more stock than the warehouse holds', async () => {
    await stockIn(fx.admin!.token, 30);
    const res = await issueStock(fx.admin!.token, fx.worker!.id, 50);
    expect(res.statusCode).toBe(409);
    expect((await balances())[WAREHOUSE]).toBe(30);
  });

  it('never lets stock go negative under concurrent deliveries', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 10);

    // 5 simultaneous attempts to spend 4 bottles each from a stock of 10.
    const attempts = await Promise.all(
      Array.from({ length: 5 }, () => makeDelivery(fx.worker!.token, { bottleCount: 4 })),
    );

    const ok = attempts.filter((r) => r.statusCode === 201).length;
    const failed = attempts.filter((r) => r.statusCode === 409).length;

    expect(ok).toBe(2); // exactly two 4-bottle deliveries fit into 10
    expect(failed).toBe(3);

    const b = await balances();
    expect(b[workerKey(fx.worker!.id)]).toBe(2); // 10 - 8, never negative
    expect(b[workerKey(fx.worker!.id)]).toBeGreaterThanOrEqual(0);
  });

  it('never oversells the warehouse under concurrent issues', async () => {
    await stockIn(fx.admin!.token, 20);

    const attempts = await Promise.all([
      issueStock(fx.admin!.token, fx.worker!.id, 8),
      issueStock(fx.admin!.token, fx.worker2!.id, 8),
      issueStock(fx.admin!.token, fx.worker!.id, 8),
    ]);

    const ok = attempts.filter((r) => r.statusCode === 201).length;
    expect(ok).toBe(2);
    expect((await balances())[WAREHOUSE]).toBe(4);
  });

  it('is idempotent: replaying a stock-in does not double the count', async () => {
    const idemKey = key();
    const first = await api
      .post('/api/v1/inventory/stock-in')
      .set(auth(fx.worker!.token))
      .send({ bottleCount: 100, idempotencyKey: idemKey });
    expect(first.statusCode).toBe(201);

    const replay = await api
      .post('/api/v1/inventory/stock-in')
      .set(auth(fx.worker!.token))
      .send({ bottleCount: 100, idempotencyKey: idemKey });
    expect(replay.statusCode).toBe(200);
    expect(replay.body.meta.duplicate).toBe(true);

    expect((await balances())[WAREHOUSE]).toBe(100);
    expect(await prisma.inventoryTransaction.count()).toBe(1);
  });

  it('lets a worker return unsold bottles to the warehouse', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 30);

    const res = await api.post('/api/v1/inventory/return').set(auth(fx.worker!.token)).send({ bottleCount: 8 });
    expect(res.statusCode).toBe(201);

    const b = await balances();
    expect(b[workerKey(fx.worker!.id)]).toBe(22);
    expect(b[WAREHOUSE]).toBe(78);
  });

  it('refuses a return larger than the worker holds', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 10);

    const res = await api.post('/api/v1/inventory/return').set(auth(fx.worker!.token)).send({ bottleCount: 25 });
    expect(res.statusCode).toBe(409);
    expect((await balances())[workerKey(fx.worker!.id)]).toBe(10);
  });

  it('records damaged bottles as a write-off', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 20);

    const res = await api
      .post('/api/v1/inventory/write-off')
      .set(auth(fx.worker!.token))
      .send({ type: 'DAMAGE', bottleCount: 3, note: 'Qutular dağıldı' });
    expect(res.statusCode).toBe(201);

    expect((await balances())[workerKey(fx.worker!.id)]).toBe(17);

    const tx = await prisma.inventoryTransaction.findFirst({ where: { type: 'DAMAGE' } });
    expect(tx?.direction).toBe(-1);
    expect(tx?.note).toBe('Qutular dağıldı');
  });

  it('records lost bottles separately from damage', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 20);

    await api
      .post('/api/v1/inventory/write-off')
      .set(auth(fx.worker!.token))
      .send({ type: 'LOSS', bottleCount: 2, note: 'İtdi' });

    const lost = await prisma.inventoryTransaction.findFirst({ where: { type: 'LOSS' } });
    expect(lost).not.toBeNull();
    expect((await balances())[workerKey(fx.worker!.id)]).toBe(18);
  });

  it('rejects a write-off that is not DAMAGE or LOSS', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 20);

    // As the worker, so the request gets past the role check and actually
    // reaches validation.
    const res = await api
      .post('/api/v1/inventory/write-off')
      .set(auth(fx.worker!.token))
      .send({ type: 'INBOUND', bottleCount: 3, note: 'cheating' });
    expect(res.statusCode).toBe(422);
  });

  it('keeps the ledger consistent: sum of movements equals the balance', async () => {
    await stockIn(fx.admin!.token, 500);
    await issueStock(fx.admin!.token, fx.worker!.id, 200);
    await makeDelivery(fx.worker!.token, { bottleCount: 30, unitPrice: '2.00' });
    await api.post('/api/v1/inventory/return').set(auth(fx.worker!.token)).send({ bottleCount: 10 });
    await api
      .post('/api/v1/inventory/write-off')
      .set(auth(fx.worker!.token))
      .send({ type: 'DAMAGE', bottleCount: 5, note: 'zədələnmiş' });

    const all = await prisma.inventoryTransaction.findMany();
    const sum = (key: string) =>
      all.filter((t) => t.balanceKey === key).reduce((s, t) => s + t.direction * t.bottleCount, 0);

    const b = await balances();
    expect(sum(WAREHOUSE)).toBe(b[WAREHOUSE]);
    expect(sum(workerKey(fx.worker!.id))).toBe(b[workerKey(fx.worker!.id)]);
  });

  it('shows per-worker stock in the warehouse summary', async () => {
    await stockIn(fx.admin!.token, 300);
    await issueStock(fx.admin!.token, fx.worker!.id, 60);
    await issueStock(fx.admin!.token, fx.worker2!.id, 40);

    const res = await api.get('/api/v1/inventory/summary').set(auth(fx.admin!.token));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.warehouse.filtered).toBe(200);
    expect(res.body.data.inWorkersHands).toBe(100);
    expect(res.body.data.totalSystemQuantity).toBe(300);

    const names = res.body.data.workers.map((w: { workerName: string }) => w.workerName);
    expect(names).toContain('Test Worker');
    expect(names).toContain('Other Worker');
  });

  it('shows a worker only their own stock', async () => {
    await stockIn(fx.admin!.token, 300);
    await issueStock(fx.admin!.token, fx.worker!.id, 60);
    // The anbardar hands worker2 their own bottles; a regular worker never
    // reaches into the warehouse for them.
    await issueStock(fx.admin!.token, fx.worker2!.id, 40);

    const res = await api.get('/api/v1/inventory/my-stock').set(auth(fx.worker!.token));
    expect(res.body.data.totalQty).toBe(60);
  });

  it('prevents hard deletion of inventory history at the database level', async () => {
    await stockIn(fx.admin!.token, 10);
    const tx = await prisma.inventoryTransaction.findFirst();

    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM inventory_transactions WHERE id = '${tx!.id}'`),
    ).rejects.toThrow(/siline bilmez/i);
  });

  it('prevents a negative balance written directly to the database', async () => {
    await stockIn(fx.admin!.token, 10);
    await expect(
      prisma.$executeRawUnsafe(`UPDATE inventory_balances SET quantity = -5 WHERE "key" = 'WAREHOUSE:FILTERED'`),
    ).rejects.toThrow(/inventory_balances_quantity_non_negative/);
  });

  it('returns bottles to the worker when an admin cancels a delivery', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);

    const delivery = (await makeDelivery(fx.worker!.token, { bottleCount: 10 })).body.data;
    expect((await balances())[workerKey(fx.worker!.id)]).toBe(40);

    const cancel = await api
      .post(`/api/v1/deliveries/${delivery.id}/cancel`)
      .set(auth(fx.admin!.token))
      .send({ reason: 'Müştəri mövcud deyildi' });
    expect(cancel.statusCode).toBe(200);

    // Bottles are back in the worker's hands.
    expect((await balances())[workerKey(fx.worker!.id)]).toBe(50);

    const after = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after.status).toBe('CANCELLED');
    expect(Number(after.debtAmount)).toBe(0);
  });

  it('refuses to cancel a delivery that has a payment', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const delivery = (await makeDelivery(fx.worker!.token, { bottleCount: 10 })).body.data;
    await makePayment(fx.worker!.token, delivery.id, '5.00');

    const res = await api
      .post(`/api/v1/deliveries/${delivery.id}/cancel`)
      .set(auth(fx.admin!.token))
      .send({ reason: 'cancel attempt' });
    expect(res.statusCode).toBe(409);
    expect(res.body.error.message).toMatch(/ödəniş/i);
  });

  it('refuses to cancel a delivery as a worker', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const delivery = (await makeDelivery(fx.worker!.token, { bottleCount: 10 })).body.data;

    const res = await api
      .post(`/api/v1/deliveries/${delivery.id}/cancel`)
      .set(auth(fx.worker!.token))
      .send({ reason: 'my mistake' });
    expect(res.statusCode).toBe(403);
  });

  it('records a full audit trail of inventory movements', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 20);

    const logs = await prisma.auditLog.findMany({ where: { entityType: 'inventory_transaction' } });
    expect(logs.length).toBeGreaterThanOrEqual(2);
    expect(logs.some((l) => l.action === 'inventory.inbound')).toBe(true);
    expect(logs.some((l) => l.action === 'inventory.issue_to_worker')).toBe(true);
  });

  it('keeps Bulaq and Filtr stock completely separate', async () => {
    await api.post('/api/v1/inventory/stock-in').set(auth(fx.worker!.token))
      .send({ bottleCount: 100, waterType: 'SPRING' });
    await api.post('/api/v1/inventory/stock-in').set(auth(fx.worker!.token))
      .send({ bottleCount: 60, waterType: 'FILTERED' });

    const b = await balances();
    expect(b['WAREHOUSE:SPRING'], 'Bulaq').toBe(100);
    expect(b['WAREHOUSE:FILTERED'], 'Filtr').toBe(60);

    const s = await api.get('/api/v1/inventory/summary').set(auth(fx.admin!.token));
    expect(s.body.data.warehouse.spring).toBe(100);
    expect(s.body.data.warehouse.filtered).toBe(60);
    expect(s.body.data.warehouse.total).toBe(160);
  });

  it('hands one water type to a worker and a delivery spends only that type', async () => {
    await api.post('/api/v1/inventory/stock-in').set(auth(fx.worker!.token))
      .send({ bottleCount: 100, waterType: 'SPRING' });
    await api.post('/api/v1/inventory/stock-in').set(auth(fx.worker!.token))
      .send({ bottleCount: 100, waterType: 'FILTERED' });

    const handover = await api.post('/api/v1/inventory/distribute').set(auth(fx.worker!.token))
      .send({ workerId: fx.worker2!.id, bottleCount: 20, waterType: 'SPRING', note: 'Bulaq təhvili' });
    expect(handover.statusCode).toBe(201);

    let b = await balances();
    expect(b['WAREHOUSE:SPRING']).toBe(80);
    expect(b['WAREHOUSE:FILTERED']).toBe(100);
    expect(b[workerKey(fx.worker2!.id, 'SPRING')]).toBe(20);
    expect(b[workerKey(fx.worker2!.id, 'FILTERED')] ?? 0).toBe(0);

    await makeDelivery(fx.worker2!.token, { waterType: 'SPRING', bottleCount: 5 });

    b = await balances();
    expect(b[workerKey(fx.worker2!.id, 'SPRING')]).toBe(15);
    expect(b[workerKey(fx.worker2!.id, 'FILTERED')] ?? 0).toBe(0);
  });

  it('refuses a delivery from a water type the worker does not hold', async () => {
    await stockIn(fx.admin!.token, 100); // FILTERED only
    await issueStock(fx.admin!.token, fx.worker!.id, 20);

    const res = await makeDelivery(fx.worker!.token, { waterType: 'SPRING', bottleCount: 5 });
    expect(res.statusCode).toBe(409);
    expect(res.body.error.message).toMatch(/bulaq suyu/i);
  });

  it('stops a regular worker from taking stock out of the warehouse', async () => {
    await stockIn(fx.admin!.token, 100);

    const res = await api.post('/api/v1/inventory/issue').set(auth(fx.worker2!.token))
      .send({ bottleCount: 5, waterType: 'FILTERED' });
    expect(res.statusCode).toBe(403);
    expect((await balances())[WAREHOUSE]).toBe(100);
  });

  it('writes stock off from the warehouse with a written reason', async () => {
    await stockIn(fx.admin!.token, 50);

    const res = await api.post('/api/v1/inventory/warehouse-write-off').set(auth(fx.worker!.token))
      .send({ type: 'DAMAGE', bottleCount: 5, note: 'Anbarda qablar sındı', waterType: 'FILTERED' });
    expect(res.statusCode).toBe(201);
    expect((await balances())[WAREHOUSE]).toBe(45);

    const tx = await prisma.inventoryTransaction.findFirst({
      where: { type: 'DAMAGE', balanceKey: WAREHOUSE },
    });
    expect(tx).not.toBeNull();
    expect(tx?.note).toBe('Anbarda qablar sındı');
    expect(tx?.createdById).toBe(fx.worker!.id);
    expect(tx?.beforeBalance).toBe(50);
    expect(tx?.afterBalance).toBe(45);
  });

  it('requires a reason before reducing the warehouse by hand', async () => {
    await stockIn(fx.admin!.token, 50);

    const res = await api.post('/api/v1/inventory/warehouse-write-off').set(auth(fx.worker!.token))
      .send({ type: 'LOSS', bottleCount: 5, note: '', waterType: 'FILTERED' });
    expect(res.statusCode).toBe(422);
    expect((await balances())[WAREHOUSE]).toBe(50);
  });
});
