import { describe, expect, it } from 'vitest';
import { api, fx, auth } from './setup';

/**
 * Customer identity and its address pin.
 *
 * The pin is what the Maps button navigates to, so it must be validated and it
 * must stay an administrator's decision: a worker correcting a phone number
 * cannot silently move every future delivery to another building.
 */
const admin = () => fx.admin!.token;
const worker = () => fx.worker!.token;

const createCustomer = (body: Record<string, unknown>) =>
  api.post('/api/v1/customers').set(auth(admin())).send(body);

describe('customer address and pin', () => {
  it('stores coordinates and lets an admin rewrite the address and pin', async () => {
    const created = await createCustomer({
      name: 'Pin Müştəri',
      address: 'Bakı, Nizami küçəsi 10',
      phone: '+994501110000',
      latitude: 40.37767,
      longitude: 49.83609,
    });
    expect(created.statusCode).toBe(201);
    expect(created.body.data.customer.latitude).toBeCloseTo(40.37767, 5);
    expect(created.body.data.customer.longitude).toBeCloseTo(49.83609, 5);

    const id = created.body.data.customer.id;
    const updated = await api
      .patch(`/api/v1/customers/${id}`)
      .set(auth(admin()))
      .send({ address: 'Bakı, Nizami küçəsi 12', latitude: 40.37801, longitude: null });
    expect(updated.statusCode).toBe(200);
    expect(updated.body.data.address).toBe('Bakı, Nizami küçəsi 12');
    expect(updated.body.data.latitude).toBeCloseTo(40.37801, 5);
    expect(updated.body.data.longitude).toBeNull();

    // The new address is what the next delivery snapshot will copy.
    const detail = await api.get(`/api/v1/customers/${id}`).set(auth(admin()));
    expect(detail.body.data.address).toBe('Bakı, Nizami küçəsi 12');
  });

  it('refuses an out-of-range pin', async () => {
    const res = await createCustomer({
      name: 'Səhv Pin',
      address: 'Bakı, Test küçəsi 1',
      latitude: 123,
      longitude: 49,
    });
    expect(res.statusCode).toBe(422);
  });

  it('lets a worker fix a phone but not the address or pin', async () => {
    const created = await createCustomer({
      name: 'İşçi Yoxlaması',
      address: 'Bakı, Əsl ünvan 5',
      phone: '+994501110001',
      latitude: 40.4,
      longitude: 49.8,
    });
    const id = created.body.data.customer.id;

    const workerTry = await api
      .patch(`/api/v1/customers/${id}`)
      .set(auth(worker()))
      .send({ address: 'Başqa ünvan 99', latitude: 1, longitude: 1 });
    expect(workerTry.statusCode).toBe(403);

    const phoneOnly = await api
      .patch(`/api/v1/customers/${id}`)
      .set(auth(worker()))
      .send({ phone: '+994551112233', note: 'İşçi qeydi' });
    expect(phoneOnly.statusCode).toBe(200);
    expect(phoneOnly.body.data.phone).toBe('+994551112233');
    expect(phoneOnly.body.data.address).toBe('Bakı, Əsl ünvan 5');
    expect(phoneOnly.body.data.latitude).toBeCloseTo(40.4, 5);
  });

  it('hides deposit money from a worker viewing a customer', async () => {
    const created = await createCustomer({ name: 'Depozit Gizli', address: 'Bakı, Gizli küçə 3' });
    const id = created.body.data.customer.id;

    const workerView = await api.get(`/api/v1/customers/${id}`).set(auth(worker()));
    expect(workerView.statusCode).toBe(200);
    expect(workerView.body.data).not.toHaveProperty('depositBalance');
    expect(workerView.body.data).not.toHaveProperty('depositByType');
    expect(workerView.body.data.deposits).toBeUndefined();

    const adminView = await api.get(`/api/v1/customers/${id}`).set(auth(admin()));
    expect(adminView.body.data).toHaveProperty('depositByType');
    expect(adminView.body.data.deposits).toEqual([]);
  });
});
