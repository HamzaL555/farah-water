import { describe, expect, it } from 'vitest';
import { api, prisma, fx, auth, key, stockIn, issueStock, makeDelivery } from './setup';

const workerKey = (id: string, waterType = 'FILTERED') => `WORKER:${id}:${waterType}`;

async function balanceOf(workerId: string, waterType = 'FILTERED'): Promise<number> {
  const row = await prisma.inventoryBalance.findUnique({
    where: { key: workerKey(workerId, waterType), waterType: waterType as never },
  });
  return row?.quantity ?? 0;
}

async function requestCorrection(token: string, deliveryId: string, newBottleCount: number, reason = 'Səhv sayılmışdı') {
  return api
    .post('/api/v1/delivery-corrections')
    .set(auth(token))
    .send({ deliveryId, newBottleCount, reason });
}

async function reviewCorrection(token: string, id: string, status: 'APPROVED' | 'REJECTED') {
  return api
    .patch(`/api/v1/delivery-corrections/${id}/review`)
    .set(auth(token))
    .send({ status, reason: 'yoxlanıldı' });
}

describe('worker types and warehouse permissions', () => {
  it('stops a regular worker from receiving stock, handing it out, or seeing the anbar total', async () => {
    const inbound = await api
      .post('/api/v1/inventory/stock-in')
      .set(auth(fx.worker2!.token))
      .send({ bottleCount: 10, waterType: 'FILTERED' });
    expect(inbound.statusCode).toBe(403);

    const distribute = await api
      .post('/api/v1/inventory/distribute')
      .set(auth(fx.worker2!.token))
      .send({ workerId: fx.worker!.id, bottleCount: 5, waterType: 'FILTERED' });
    expect(distribute.statusCode).toBe(403);

    const summary = await api.get('/api/v1/inventory/summary').set(auth(fx.worker2!.token));
    expect(summary.statusCode).toBe(403);

    expect(await prisma.inventoryTransaction.count()).toBe(0);
  });

  it('shows a regular worker only their own balance, never another worker’s', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 40);
    await issueStock(fx.admin!.token, fx.worker2!.id, 7);

    const mine = await api.get('/api/v1/inventory/my-stock').set(auth(fx.worker2!.token));
    expect(mine.statusCode).toBe(200);
    expect(mine.body.data.totalQty).toBe(7);

    // Even asking for another worker's ledger can only return their own rows.
    const rows = await api
      .get(`/api/v1/inventory/transactions?workerId=${fx.worker!.id}`)
      .set(auth(fx.worker2!.token));
    expect(rows.statusCode).toBe(200);
    expect(rows.body.data.items.every((r: { workerId: string }) => r.workerId === fx.worker2!.id)).toBe(true);
  });

  it('allows an admin to inspect every worker’s stock without acting as a keeper', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 12);

    const summary = await api.get('/api/v1/inventory/summary').set(auth(fx.admin!.token));
    expect(summary.statusCode).toBe(200);
    expect(summary.body.data.warehouse.filtered).toBe(88);
    expect(summary.body.data.workers.some((w: { workerId: string; filteredQty: number }) =>
      w.workerId === fx.worker!.id && w.filteredQty === 12)).toBe(true);
  });

  it('lets the anbardar record a return from a named worker', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker2!.id, 20);
    expect(await balanceOf(fx.worker2!.id)).toBe(20);

    const res = await api
      .post('/api/v1/inventory/return')
      .set(auth(fx.worker!.token))
      .send({ workerId: fx.worker2!.id, bottleCount: 5, waterType: 'FILTERED', note: 'İstifadə olunmadı' });
    expect(res.statusCode).toBe(201);

    expect(await balanceOf(fx.worker2!.id)).toBe(15);
    const warehouse = await prisma.inventoryBalance.findUniqueOrThrow({
      where: { key: 'WAREHOUSE:FILTERED', waterType: 'FILTERED' },
    });
    expect(warehouse.quantity).toBe(85);
  });

  it('blocks a regular worker from returning bottles on their own', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker2!.id, 20);

    const res = await api
      .post('/api/v1/inventory/return')
      .set(auth(fx.worker2!.token))
      .send({ bottleCount: 5, waterType: 'FILTERED' });
    expect(res.statusCode).toBe(403);
    expect(await balanceOf(fx.worker2!.id)).toBe(20);
  });
});

describe('approved delivery corrections move bottles', () => {
  it('deducts the difference when the corrected count is higher', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker2!.id, 50);

    const delivery = (await makeDelivery(fx.worker2!.token, { bottleCount: 10 })).body.data;
    expect(await balanceOf(fx.worker2!.id)).toBe(40);

    const asked = await requestCorrection(fx.worker2!.token, delivery.id, 15);
    expect(asked.statusCode).toBe(201);

    const reviewed = await reviewCorrection(fx.admin!.token, asked.body.data.id, 'APPROVED');
    expect(reviewed.statusCode).toBe(200);
    expect(await balanceOf(fx.worker2!.id)).toBe(35);

    const after = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(after.bottleCount).toBe(15);

    const movement = await prisma.inventoryTransaction.findFirst({
      where: { type: 'OUT_DELIVERY', deliveryId: delivery.id, reference: { startsWith: 'delivery:correction:' } },
    });
    expect(movement).not.toBeNull();
    expect(movement?.bottleCount).toBe(5);
    expect(movement?.beforeBalance).toBe(40);
    expect(movement?.afterBalance).toBe(35);
  });

  it('returns bottles when the corrected count is lower', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker2!.id, 50);

    const delivery = (await makeDelivery(fx.worker2!.token, { bottleCount: 10 })).body.data;
    expect(await balanceOf(fx.worker2!.id)).toBe(40);

    const asked = await requestCorrection(fx.worker2!.token, delivery.id, 4);
    expect(asked.statusCode).toBe(201);

    const reviewed = await reviewCorrection(fx.admin!.token, asked.body.data.id, 'APPROVED');
    expect(reviewed.statusCode).toBe(200);
    expect(await balanceOf(fx.worker2!.id)).toBe(46);
  });

  it('never applies the same correction twice', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker2!.id, 50);
    const delivery = (await makeDelivery(fx.worker2!.token, { bottleCount: 10 })).body.data;

    const asked = await requestCorrection(fx.worker2!.token, delivery.id, 12);
    const first = await reviewCorrection(fx.admin!.token, asked.body.data.id, 'APPROVED');
    expect(first.statusCode).toBe(200);
    expect(await balanceOf(fx.worker2!.id)).toBe(38);

    const replay = await reviewCorrection(fx.admin!.token, asked.body.data.id, 'APPROVED');
    expect(replay.statusCode).toBe(400);
    expect(await balanceOf(fx.worker2!.id)).toBe(38);

    // Two ledger legs at most: the original delivery and the one correction.
    expect(await prisma.inventoryTransaction.count({
      where: { deliveryId: delivery.id, type: 'OUT_DELIVERY' },
    })).toBe(2);
  });

  it('rolls back a correction the worker cannot cover, leaving the delivery untouched', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker2!.id, 10);
    const delivery = (await makeDelivery(fx.worker2!.token, { bottleCount: 10 })).body.data;
    expect(await balanceOf(fx.worker2!.id)).toBe(0);

    const asked = await requestCorrection(fx.worker2!.token, delivery.id, 15);
    const reviewed = await reviewCorrection(fx.admin!.token, asked.body.data.id, 'APPROVED');
    expect(reviewed.statusCode).toBe(409);

    expect(await balanceOf(fx.worker2!.id)).toBe(0);
    expect((await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } })).bottleCount).toBe(10);

    const pending = await prisma.deliveryCorrection.findUniqueOrThrow({ where: { id: asked.body.data.id } });
    expect(pending.status).toBe('PENDING');
  });

  it('keeps the correction in the water type that was delivered', async () => {
    await api.post('/api/v1/inventory/stock-in').set(auth(fx.worker!.token))
      .send({ bottleCount: 40, waterType: 'SPRING' });
    const handover = await api.post('/api/v1/inventory/distribute').set(auth(fx.worker!.token))
      .send({ workerId: fx.worker2!.id, bottleCount: 20, waterType: 'SPRING' });
    expect(handover.statusCode).toBe(201);

    const delivery = (await makeDelivery(fx.worker2!.token, { bottleCount: 5, waterType: 'SPRING' })).body.data;
    expect(await balanceOf(fx.worker2!.id, 'SPRING')).toBe(15);

    const asked = await requestCorrection(fx.worker2!.token, delivery.id, 8);
    await reviewCorrection(fx.admin!.token, asked.body.data.id, 'APPROVED');

    expect(await balanceOf(fx.worker2!.id, 'SPRING')).toBe(12);
    expect(await balanceOf(fx.worker2!.id, 'FILTERED')).toBe(0);
  });

  it('survives repeated delivery edits without losing a movement or double-deducting', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const delivery = (await makeDelivery(fx.worker!.token, { bottleCount: 10 })).body.data;
    expect(await balanceOf(fx.worker!.id)).toBe(40);

    const edit = (count: number) =>
      api.patch(`/api/v1/deliveries/${delivery.id}`).set(auth(fx.admin!.token)).send({ bottleCount: count });

    expect((await edit(12)).statusCode).toBe(200);
    expect(await balanceOf(fx.worker!.id)).toBe(38);
    expect((await edit(14)).statusCode).toBe(200);
    expect(await balanceOf(fx.worker!.id)).toBe(36);
    // Back down, then up the same path again: the reference must not collide.
    expect((await edit(12)).statusCode).toBe(200);
    expect(await balanceOf(fx.worker!.id)).toBe(38);
    expect((await edit(14)).statusCode).toBe(200);
    expect(await balanceOf(fx.worker!.id)).toBe(36);
  });

  it('rejects one of two concurrent edits instead of moving bottles twice', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 50);
    const delivery = (await makeDelivery(fx.worker!.token, { bottleCount: 10 })).body.data;

    const [a, b] = await Promise.all([
      api.patch(`/api/v1/deliveries/${delivery.id}`).set(auth(fx.admin!.token)).send({ bottleCount: 12 }),
      api.patch(`/api/v1/deliveries/${delivery.id}`).set(auth(fx.admin!.token)).send({ bottleCount: 13 }),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 409]);

    const saved = await prisma.delivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(await balanceOf(fx.worker!.id)).toBe(50 - saved.bottleCount);
  });
});

describe('admin notifications', () => {
  it('report every movement with actor, water type and before/after balances', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 30);

    const res = await api.get('/api/v1/notifications?pageSize=100').set(auth(fx.admin!.token));
    expect(res.statusCode).toBe(200);

    const inbound = res.body.data.items.find((n: { action: string }) => n.action === 'INBOUND');
    expect(inbound).toMatchObject({
      actorName: 'Test Worker',
      waterType: 'FILTERED',
      bottleCount: 100,
      beforeBalance: 0,
      afterBalance: 100,
    });
    expect(inbound.createdAt).toBeTruthy();

    const issue = res.body.data.items.find((n: { action: string }) => n.action === 'ISSUE_TO_WORKER');
    expect(issue).toMatchObject({
      actorName: 'Test Worker',
      waterType: 'FILTERED',
      bottleCount: 30,
      beforeBalance: 100,
      afterBalance: 70,
    });
  });

  it('report a delivery spending a worker’s bottles and its cancellation', async () => {
    await stockIn(fx.admin!.token, 100);
    await issueStock(fx.admin!.token, fx.worker!.id, 20);
    const delivery = (await makeDelivery(fx.worker!.token, { bottleCount: 5 })).body.data;

    let res = await api.get('/api/v1/notifications?pageSize=100').set(auth(fx.admin!.token));
    const spent = res.body.data.items.find((n: { action: string }) => n.action === 'OUT_DELIVERY');
    expect(spent).toMatchObject({ bottleCount: 5, beforeBalance: 20, afterBalance: 15 });

    await api.post(`/api/v1/deliveries/${delivery.id}/cancel`).set(auth(fx.admin!.token))
      .send({ reason: 'Müştəri yox idi' });

    res = await api.get('/api/v1/notifications?pageSize=100').set(auth(fx.admin!.token));
    const returned = res.body.data.items.find((n: { action: string }) => n.action === 'RETURN_TO_STOCK');
    expect(returned).toMatchObject({ bottleCount: 5, beforeBalance: 15, afterBalance: 20 });
  });

  it('are visible only to administrators', async () => {
    const res = await api.get('/api/v1/notifications').set(auth(fx.worker2!.token));
    expect(res.statusCode).toBe(403);
  });

  it('are not duplicated when an idempotent operation is replayed', async () => {
    const idem = key();
    const first = await api.post('/api/v1/inventory/stock-in').set(auth(fx.worker!.token))
      .send({ bottleCount: 25, waterType: 'FILTERED', idempotencyKey: idem });
    expect(first.statusCode).toBe(201);

    const replay = await api.post('/api/v1/inventory/stock-in').set(auth(fx.worker!.token))
      .send({ bottleCount: 25, waterType: 'FILTERED', idempotencyKey: idem });
    expect(replay.statusCode).toBe(200);
    expect(replay.body.meta.duplicate).toBe(true);

    expect(await prisma.inventoryTransaction.count({ where: { type: 'INBOUND' } })).toBe(1);
    expect(await prisma.notification.count({ where: { action: 'INBOUND' } })).toBe(1);
  });
});

describe('append-only warehouse ledger', () => {
  it('refuses an UPDATE of a recorded movement, not just a DELETE', async () => {
    await stockIn(fx.admin!.token, 10);
    const tx = await prisma.inventoryTransaction.findFirstOrThrow();

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE inventory_transactions SET "bottleCount" = 1 WHERE id = '${tx.id}'`,
      ),
    ).rejects.toThrow(/deyisdirile bilmez/i);

    const untouched = await prisma.inventoryTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(untouched.bottleCount).toBe(10);
  });
});
