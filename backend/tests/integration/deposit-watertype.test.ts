import { describe, expect, it } from 'vitest';
import { api, prisma, fx, auth, key, makeCustomer } from './setup';

/**
 * Contract for the per-water-type customer deposit ledger.
 *
 * Bulaq and Filtr bottles are physically different objects with different
 * deposit values, so they must never share a balance. A refund of Bulaq
 * bottles cannot be covered by Filtr bottles the customer still holds.
 */
const admin = () => fx.admin!.token;

const deposit = (body: Record<string, unknown>) =>
  api
    .post('/api/v1/deposits')
    .set(auth(admin()))
    .send({ idempotencyKey: key(), ...body });

const summaryOf = (customerId: string) =>
  api.get(`/api/v1/deposits/summary/${customerId}`).set(auth(admin()));

const setDepositPrices = (body: Record<string, unknown>) =>
  api.put('/api/v1/deposits/settings').set(auth(admin())).send(body);

describe('deposits per water type', () => {
  it('keeps Bulaq and Filtr bottle accounts separate', async () => {
    const customer = await makeCustomer(fx.worker!.token, 'Su Növü Müştəri', 'İki su küç. 5');

    await deposit({ customerId: customer.id, type: 'DEPOSIT_IN', waterType: 'FILTERED', amount: '4.00', bottleCount: 2 });
    await deposit({ customerId: customer.id, type: 'DEPOSIT_IN', waterType: 'SPRING', amount: '6.00', bottleCount: 1 });

    const s1 = await summaryOf(customer.id);
    expect(s1.statusCode).toBe(200);
    expect(s1.body.data.byType.FILTERED).toEqual({ balance: 4, bottleBalance: 2 });
    expect(s1.body.data.byType.SPRING).toEqual({ balance: 6, bottleBalance: 1 });
    expect(s1.body.data.bottleBalance).toBe(3);
    expect(s1.body.data.balance).toBe(10);

    // Returning the only Bulaq bottle is fine...
    const outSpring = await deposit({
      customerId: customer.id, type: 'DEPOSIT_OUT', waterType: 'SPRING', amount: '6.00', bottleCount: 1,
    });
    expect(outSpring.statusCode).toBe(201);
    expect(outSpring.body.data.deposit.waterType).toBe('SPRING');

    // ...but a second one is refused even though Filtr bottles remain.
    const outSpringAgain = await deposit({
      customerId: customer.id, type: 'DEPOSIT_OUT', waterType: 'SPRING', amount: '6.00', bottleCount: 1,
    });
    expect(outSpringAgain.statusCode).toBe(400);
    expect(outSpringAgain.body.error.message).toContain('Bulaq');

    const s2 = await summaryOf(customer.id);
    expect(s2.body.data.byType.SPRING).toEqual({ balance: 0, bottleBalance: 0 });
    expect(s2.body.data.byType.FILTERED).toEqual({ balance: 4, bottleBalance: 2 });
  });

  it('prices a deposit from the configured per-bottle price when amount is omitted', async () => {
    const customer = await makeCustomer(fx.worker!.token, 'Qiymət Müştəri', 'Qiymət küç. 7');

    const settings = await setDepositPrices({ FILTERED: '2.50', SPRING: '4.00' });
    expect(settings.statusCode).toBe(200);
    expect(settings.body.data).toEqual({ FILTERED: 2.5, SPRING: 4 });

    const autoFiltered = await deposit({
      customerId: customer.id, type: 'DEPOSIT_IN', waterType: 'FILTERED', bottleCount: 4,
    });
    expect(autoFiltered.statusCode).toBe(201);
    expect(autoFiltered.body.data.deposit.amount).toBe(10);

    const autoSpring = await deposit({
      customerId: customer.id, type: 'DEPOSIT_IN', waterType: 'SPRING', bottleCount: 2,
    });
    expect(autoSpring.statusCode).toBe(201);
    expect(autoSpring.body.data.deposit.amount).toBe(8);
  });

  it('filters the ledger by water type and reports per-type totals', async () => {
    const customer = await makeCustomer(fx.worker!.token, 'Filtr Müştəri', 'Filtr küç. 9');

    await deposit({ customerId: customer.id, type: 'DEPOSIT_IN', waterType: 'FILTERED', amount: '3.00', bottleCount: 3 });
    await deposit({ customerId: customer.id, type: 'DEPOSIT_IN', waterType: 'SPRING', amount: '5.00', bottleCount: 1 });

    const springOnly = await api
      .get('/api/v1/deposits?waterType=SPRING&pageSize=50')
      .set(auth(admin()));
    expect(springOnly.statusCode).toBe(200);
    expect(springOnly.body.data.items).toHaveLength(1);
    expect(springOnly.body.data.items[0].waterType).toBe('SPRING');
    expect(springOnly.body.data.totals.byType.SPRING).toEqual({ amount: 5, bottleCount: 1 });
    expect(springOnly.body.data.totals.byType.FILTERED).toEqual({ amount: 0, bottleCount: 0 });
  });

  it('refuses deposit price changes from a worker', async () => {
    const res = await api
      .put('/api/v1/deposits/settings')
      .set(auth(fx.worker!.token))
      .send({ FILTERED: '9', SPRING: '9' });
    expect(res.statusCode).toBe(403);
  });

  it('stores the deposit settings in app_settings so a restart keeps them', async () => {
    await setDepositPrices({ FILTERED: '1.75', SPRING: '3.25' });
    const row = await prisma.appSetting.findUnique({ where: { key: 'depositPrice' } });
    expect(row).not.toBeNull();
    expect(row!.value).toEqual({ FILTERED: 1.75, SPRING: 3.25 });
  });
});
