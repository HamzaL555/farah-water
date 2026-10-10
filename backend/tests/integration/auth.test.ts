import { describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { api, prisma, fx, ADMIN_PWD, WORKER_PWD, auth } from './setup';
import { hashRefreshToken } from '../../src/auth/tokens';

describe('authentication', () => {
  it('logs in with username and returns tokens', async () => {
    const res = await api.post('/api/v1/auth/login').send({ identifier: 'worker', password: WORKER_PWD });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.user.username).toBe('worker');
    expect(res.body.data.user.role).toBe(Role.WORKER);
    expect(res.body.data.tokens.accessToken).toBeTruthy();
    expect(res.body.data.tokens.refreshToken).toBeTruthy();
  });

  it('never returns the password hash', async () => {
    const res = await api.post('/api/v1/auth/login').send({ identifier: 'worker', password: WORKER_PWD });
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.text).not.toContain('$2b$');
  });

  it('logs in with the phone number', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'worker' } });
    const res = await api.post('/api/v1/auth/login').send({ identifier: user.phone, password: WORKER_PWD });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a wrong password with a clear message', async () => {
    const res = await api.post('/api/v1/auth/login').send({ identifier: 'worker', password: 'WrongPassword!' });
    expect(res.statusCode).toBe(401);
    expect(res.body.error.message).toMatch(/düzgün deyil/i);
  });

  it('gives the same error for an unknown user (no enumeration)', async () => {
    const res = await api.post('/api/v1/auth/login').send({ identifier: 'ghost', password: 'Whatever123!' });
    expect(res.statusCode).toBe(401);
    expect(res.body.error.message).toMatch(/düzgün deyil/i);
  });

  it('locks the account after repeated failures', async () => {
    const user = await prisma.user.create({
      data: {
        fullName: 'Lock Me',
        username: 'lockme',
        role: Role.WORKER,
        passwordHash: await bcrypt.hash('Correct123!', 4),
        phone: '+994509999111',
      },
    });

    for (let i = 0; i < 5; i++) {
      await api.post('/api/v1/auth/login').send({ identifier: 'lockme', password: 'nope' });
    }

    const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(locked.lockedUntil).not.toBeNull();

    // Even the CORRECT password is refused while the account is locked.
    const res = await api.post('/api/v1/auth/login').send({ identifier: 'lockme', password: 'Correct123!' });
    expect(res.statusCode).toBe(423);
  });

  it('refuses a deactivated account', async () => {
    await prisma.user.create({
      data: {
        fullName: 'Deactivated',
        username: 'deact',
        role: Role.WORKER,
        passwordHash: await bcrypt.hash('Correct123!', 4),
        isActive: false,
        phone: '+994509999222',
      },
    });
    const res = await api.post('/api/v1/auth/login').send({ identifier: 'deact', password: 'Correct123!' });
    expect(res.statusCode).toBe(401);
    expect(res.body.error.message).toMatch(/deaktiv/i);
  });

  it('refreshes a session and rotates the refresh token', async () => {
    const loginRes = await api.post('/api/v1/auth/login').send({ identifier: 'worker', password: WORKER_PWD });
    const { refreshToken } = loginRes.body.data.tokens;

    const first = await api.post('/api/v1/auth/refresh').send({ refreshToken });
    expect(first.statusCode).toBe(200);
    const newRefresh = first.body.data.tokens.refreshToken;
    expect(newRefresh).not.toBe(refreshToken);

    // The old refresh token must no longer work (single-use rotation).
    const reuse = await api.post('/api/v1/auth/refresh').send({ refreshToken });
    expect(reuse.statusCode).toBe(401);
  });

  it('stores only a hash of the refresh token', async () => {
    const loginRes = await api.post('/api/v1/auth/login').send({ identifier: 'worker', password: WORKER_PWD });
    const { refreshToken } = loginRes.body.data.tokens;

    const stored = await prisma.refreshToken.findFirst({ where: { tokenHash: hashRefreshToken(refreshToken) } });
    expect(stored).not.toBeNull();

    const all = await prisma.refreshToken.findMany();
    expect(all.some((t) => t.tokenHash === refreshToken)).toBe(false);
  });

  it('logs out and invalidates the refresh token', async () => {
    const loginRes = await api.post('/api/v1/auth/login').send({ identifier: 'worker', password: WORKER_PWD });
    const { refreshToken } = loginRes.body.data.tokens;

    await api.post('/api/v1/auth/logout').send({ refreshToken });

    const after = await api.post('/api/v1/auth/refresh').send({ refreshToken });
    expect(after.statusCode).toBe(401);
  });

  it('blocks unauthenticated access to protected endpoints', async () => {
    const res = await api.get('/api/v1/deliveries');
    expect(res.statusCode).toBe(401);
  });

  it('blocks a tampered access token', async () => {
    const res = await api.get('/api/v1/deliveries').set(auth(`${fx.worker!.token}tampered`));
    expect(res.statusCode).toBe(401);
  });

  it('blocks a token signed with the wrong secret', async () => {
    const forged = jwt.sign(
      { role: 'ADMIN', username: 'hacker' },
      'not-the-real-secret',
      {
        subject: '00000000-0000-0000-0000-000000000000',
        issuer: 'farah-water',
        audience: 'farah-mobile',
        expiresIn: '1h',
      },
    );
    const res = await api.get('/api/v1/users/stats').set(auth(forged));
    expect(res.statusCode).toBe(401);
  });

  it('revokes access immediately when an account is deactivated', async () => {
    const user = await prisma.user.create({
      data: {
        fullName: 'Temp Worker',
        username: 'tempworker',
        role: Role.WORKER,
        passwordHash: await bcrypt.hash('Temp1234!', 4),
        phone: '+994509999333',
      },
    });
    const loginRes = await api.post('/api/v1/auth/login').send({ identifier: 'tempworker', password: 'Temp1234!' });
    const token = loginRes.body.data.tokens.accessToken;

    const before = await api.get('/api/v1/deliveries').set(auth(token));
    expect(before.statusCode).toBe(200);

    await api.patch(`/api/v1/users/${user.id}`).set(auth(fx.admin!.token)).send({ isActive: false });

    // The token is still cryptographically valid, but must be refused.
    const after = await api.get('/api/v1/deliveries').set(auth(token));
    expect(after.statusCode).toBe(403);
  });

  it('changes a password and invalidates other sessions', async () => {
    await prisma.user.create({
      data: {
        fullName: 'Changer',
        username: 'changer',
        role: Role.WORKER,
        passwordHash: await bcrypt.hash('OldPass123!', 4),
        phone: '+994509999444',
      },
    });
    const loginRes = await api.post('/api/v1/auth/login').send({ identifier: 'changer', password: 'OldPass123!' });
    const token = loginRes.body.data.tokens.accessToken;
    const refreshToken = loginRes.body.data.tokens.refreshToken;

    const res = await api
      .post('/api/v1/auth/change-password')
      .set(auth(token))
      .send({ currentPassword: 'OldPass123!', newPassword: 'BrandNew123!' });
    expect(res.statusCode).toBe(200);

    const refreshed = await api.post('/api/v1/auth/refresh').send({ refreshToken });
    expect(refreshed.statusCode).toBe(401);

    const oldLogin = await api.post('/api/v1/auth/login').send({ identifier: 'changer', password: 'OldPass123!' });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await api.post('/api/v1/auth/login').send({ identifier: 'changer', password: 'BrandNew123!' });
    expect(newLogin.statusCode).toBe(200);
  });

  it('rejects a weak new password', async () => {
    const res = await api
      .post('/api/v1/auth/change-password')
      .set(auth(fx.worker!.token))
      .send({ currentPassword: WORKER_PWD, newPassword: 'short' });
    expect(res.statusCode).toBe(422);
  });

  it('returns the current profile from /me', async () => {
    const res = await api.get('/api/v1/auth/me').set(auth(fx.worker!.token));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.username).toBe('worker');
  });

  it('has no public registration endpoint', async () => {
    const res = await api.post('/api/v1/auth/register').send({
      fullName: 'Hacker',
      username: 'hacker',
      password: 'Hacker123!',
      role: 'ADMIN',
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects an empty login payload', async () => {
    const res = await api.post('/api/v1/auth/login').send({});
    expect(res.statusCode).toBe(422);
  });

  it('generates a login with an unambiguous message for wrong credentials', async () => {
    const res = await api.post('/api/v1/auth/login').send({ identifier: 'worker', password: 'definitely-wrong' });
    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});
