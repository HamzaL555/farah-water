import { describe, expect, it } from 'vitest';
import { api, prisma, fx, auth, key, stockIn, issueStock } from './setup';

/**
 * Iki mərhələli çatdırılma.
 *
 * A delivery is recorded first; the bottles only leave the worker's balance
 * when it is explicitly confirmed. These tests pin the whole contract: no
 * movement before confirmation, exactly one movement on confirmation, no
 * double-apply on repeat, stock restored only when a confirmed row is
 * cancelled, and pending rows kept out of every financial aggregate.
 */

const WAREHOUSE = 'WAREHOUSE:FILTERED';
const workerKey = (id: string, waterType = 'FILTERED') => `WORKER:${id}:${waterType}`;

async function balances() {
  const rows = await prisma.inventoryBalance.findMany();
  const map: Record<string, number> = {};
  for (const r of rows) map[r.key] = r.quantity;
  return map;
}

const record = (token: string, body: Record<string, unknown> = {}) =>
  api
    .post('/api/v1/deliveries')
    .set(auth(token))
    .send({
      idempotencyKey: key(),
      customerName: 'Test Customer',
      address: 'Test Street 1',
      bottleCount: 10,
      ...body,
    });

const confirm = (token: string, id: string) =>
  api.post(`/api/v1/deliveries/${id}/confirm`).set(auth(token)).send({});

const cancel = (token: string, id: string, reason = 'test cancel') =>
  api.post(`/api/v1/deliveries/${id}/cancel`).set(auth(token)).send({ reason });

describe('delivery confirmation', () => {
  it('does not move stock when a delivery is only recorded', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);

    const res = await record(fx.worker!.token);
    expect(res.statusCode).toBe(201);
    expect(res.body.data.isConfirmed).toBe(false);
    expect(res.body.data.confirmedAt).toBeNull();

    // The bottles stay in the worker's hands until the separate confirmation.
    expect((await balances())[workerKey(fx.worker!.id)]).toBe(50);
    expect((await balances())[WAREHOUSE]).toBe(50);
    expect(await prisma.inventoryTransaction.count({ where: { type: 'OUT_DELIVERY' } })).toBe(0);
  });

  it('moves stock exactly once on confirmation and is idempotent on repeat', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const delivery = (await record(fx.worker!.token)).body.data;

    const first = await confirm(fx.worker!.token, delivery.id);
    expect(first.statusCode).toBe(200);
    expect(first.body.data.isConfirmed).toBe(true);
    expect(first.body.meta.duplicate).toBe(false);
    expect((await balances())[workerKey(fx.worker!.id)]).toBe(40);
    expect(await prisma.inventoryTransaction.count({ where: { type: 'OUT_DELIVERY' } })).toBe(1);

    // A second click (or an offline retry) must not deduct again.
    const second = await confirm(fx.worker!.token, delivery.id);
    expect(second.statusCode).toBe(200);
    expect(second.body.meta.duplicate).toBe(true);
    expect((await balances())[workerKey(fx.worker!.id)]).toBe(40);
    expect(await prisma.inventoryTransaction.count({ where: { type: 'OUT_DELIVERY' } })).toBe(1);
  });

  it('lets only the owning worker or an admin confirm', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const delivery = (await record(fx.worker!.token)).body.data;

    const byOther = await confirm(fx.worker2!.token, delivery.id);
    expect(byOther.statusCode).toBe(403);
    expect((await balances())[workerKey(fx.worker!.id)]).toBe(50);

    // The admin may confirm on the worker's behalf.
    const byAdmin = await confirm(fx.admin!.token, delivery.id);
    expect(byAdmin.statusCode).toBe(200);
    expect((await balances())[workerKey(fx.worker!.id)]).toBe(40);
  });

  it('cancelling a pending delivery does not invent stock', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const delivery = (await record(fx.worker!.token)).body.data;

    const res = await cancel(fx.admin!.token, delivery.id);
    expect(res.statusCode).toBe(200);

    // Nothing had left the worker, so nothing may come back.
    expect((await balances())[workerKey(fx.worker!.id)]).toBe(50);
    expect(await prisma.inventoryTransaction.count({ where: { type: 'RETURN_TO_STOCK' } })).toBe(0);

    const stored = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(stored.status).toBe('CANCELLED');
    expect(Number(stored.debtAmount)).toBe(0);
  });

  it('cancelling a confirmed delivery restores stock once', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const delivery = (await record(fx.worker!.token)).body.data;
    await confirm(fx.worker!.token, delivery.id);
    expect((await balances())[workerKey(fx.worker!.id)]).toBe(40);

    const res = await cancel(fx.admin!.token, delivery.id);
    expect(res.statusCode).toBe(200);
    expect((await balances())[workerKey(fx.worker!.id)]).toBe(50);
    expect(await prisma.inventoryTransaction.count({ where: { type: 'RETURN_TO_STOCK' } })).toBe(1);

    // A repeated cancel is a no-op, not a second return.
    const again = await cancel(fx.admin!.token, delivery.id);
    expect(again.statusCode).toBe(200);
    expect((await balances())[workerKey(fx.worker!.id)]).toBe(50);
    expect(await prisma.inventoryTransaction.count({ where: { type: 'RETURN_TO_STOCK' } })).toBe(1);
  });

  it('refuses payments and debt adjustments until the delivery is confirmed', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const delivery = (await record(fx.worker!.token)).body.data;

    // Price it while pending (allowed); room for a real payment afterwards.
    const priced = await api
      .patch(`/api/v1/deliveries/${delivery.id}`)
      .set(auth(fx.admin!.token))
      .send({ unitPrice: '2.00' });
    expect(priced.statusCode).toBe(200);

    const payment = await api
      .post('/api/v1/payments')
      .set(auth(fx.admin!.token))
      .send({ idempotencyKey: key(), deliveryId: delivery.id, amount: '5.00' });
    expect(payment.statusCode).toBe(400);
    expect(payment.body.error.message).toMatch(/təsdiqlənməmiş/i);

    const adjustment = await api
      .post('/api/v1/debts/adjustments')
      .set(auth(fx.admin!.token))
      .send({ deliveryId: delivery.id, type: 'FORGIVE', amount: '5.00', reason: '' });
    expect(adjustment.statusCode).toBe(400);
    expect(adjustment.body.error.message).toMatch(/təsdiqlənməmiş/i);

    // After confirmation the normal money flow works again.
    await confirm(fx.worker!.token, delivery.id);
    const paid = await api
      .post('/api/v1/payments')
      .set(auth(fx.admin!.token))
      .send({ idempotencyKey: key(), deliveryId: delivery.id, amount: '5.00' });
    expect(paid.statusCode).toBe(201);
  });

  it('keeps pending deliveries out of debts and billed totals until confirmed', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const delivery = (await record(fx.worker!.token)).body.data;

    // The admin prices it while it is still pending; money may not be recorded
    // yet, but the amount is what will be owed once it is accepted.
    const priced = await api
      .patch(`/api/v1/deliveries/${delivery.id}`)
      .set(auth(fx.admin!.token))
      .send({ unitPrice: '2.00' });
    expect(priced.statusCode).toBe(200);
    expect(priced.body.data.totalAmount).toBe(20);

    const pendingDebts = await api.get('/api/v1/debts').set(auth(fx.admin!.token));
    expect(pendingDebts.statusCode).toBe(200);
    expect(pendingDebts.body.data.totalDebt).toBe(0);
    expect(pendingDebts.body.data.items).toHaveLength(0);

    const pendingDash = await api.get('/api/v1/dashboard/admin?preset=all').set(auth(fx.admin!.token));
    expect(pendingDash.body.data.finance.totalOutstandingDebt).toBe(0);
    expect(pendingDash.body.data.finance.billedInRange).toBe(0);
    expect(pendingDash.body.data.deliveries.inRangeCount).toBe(0);

    await confirm(fx.worker!.token, delivery.id);

    const debts = await api.get('/api/v1/debts').set(auth(fx.admin!.token));
    expect(debts.body.data.totalDebt).toBe(20);
    expect(debts.body.data.items).toHaveLength(1);

    const dash = await api.get('/api/v1/dashboard/admin?preset=all').set(auth(fx.admin!.token));
    expect(dash.body.data.finance.totalOutstandingDebt).toBe(20);
    expect(dash.body.data.finance.billedInRange).toBe(20);
    expect(dash.body.data.deliveries.inRangeCount).toBe(1);
  });

  it('exposes the two confirmation states as list filters', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const first = (await record(fx.worker!.token, { address: 'Pending Street' })).body.data;
    const second = (await record(fx.worker!.token, { address: 'Confirmed Street' })).body.data;
    await confirm(fx.worker!.token, second.id);

    const pending = await api
      .get('/api/v1/deliveries?confirmation=PENDING')
      .set(auth(fx.admin!.token));
    expect(pending.statusCode).toBe(200);
    expect(pending.body.data.items.map((d: { id: string }) => d.id)).toEqual([first.id]);

    const confirmed = await api
      .get('/api/v1/deliveries?confirmation=CONFIRMED')
      .set(auth(fx.admin!.token));
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.body.data.items.map((d: { id: string }) => d.id)).toContain(second.id);
    expect(confirmed.body.data.items.map((d: { id: string }) => d.id)).not.toContain(first.id);
  });

  /**
   * Release safety: the migration runs while the old build is still serving.
   * A row it creates after the migration has its stock already out but no
   * `confirmedAt`. These two tests pin the exact state so neither confirming
   * nor cancelling it can corrupt the balance.
   */
  it('does not deduct twice when a legacy row already has its stock out', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const delivery = (await record(fx.worker!.token)).body.data;
    await confirm(fx.worker!.token, delivery.id);
    expect((await balances())[workerKey(fx.worker!.id)]).toBe(40);

    // Roll the flag back: this is precisely what rows written by the previous
    // build look like. The OUT_DELIVERY ledger leg is still there.
    await prisma.$executeRawUnsafe(
      `UPDATE deliveries SET "confirmedAt" = NULL, "confirmedById" = NULL WHERE id = '${delivery.id}'`,
    );

    const again = await confirm(fx.admin!.token, delivery.id);
    expect(again.statusCode).toBe(200);
    expect(again.body.data.isConfirmed).toBe(true);
    expect((await balances())[workerKey(fx.worker!.id)]).toBe(40);
    expect(await prisma.inventoryTransaction.count({ where: { type: 'OUT_DELIVERY' } })).toBe(1);
  });

  it('restores stock when a legacy pending row is cancelled', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const delivery = (await record(fx.worker!.token)).body.data;
    await confirm(fx.worker!.token, delivery.id);
    expect((await balances())[workerKey(fx.worker!.id)]).toBe(40);

    await prisma.$executeRawUnsafe(
      `UPDATE deliveries SET "confirmedAt" = NULL, "confirmedById" = NULL WHERE id = '${delivery.id}'`,
    );

    const res = await cancel(fx.admin!.token, delivery.id);
    expect(res.statusCode).toBe(200);
    expect((await balances())[workerKey(fx.worker!.id)]).toBe(50);
    expect(await prisma.inventoryTransaction.count({ where: { type: 'RETURN_TO_STOCK' } })).toBe(1);
  });
});
