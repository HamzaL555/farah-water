import crypto from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '../config';

export interface AccessTokenPayload {
  sub: string;
  role: 'ADMIN' | 'WORKER';
  username: string;
}

const ISSUER = 'farah-water';

export function signAccessToken(payload: AccessTokenPayload): string {
  const options: SignOptions = {
    expiresIn: config.jwt.accessTtl as SignOptions['expiresIn'],
    issuer: ISSUER,
    audience: 'farah-mobile',
  };
  return jwt.sign({ role: payload.role, username: payload.username }, config.jwt.accessSecret, {
    ...options,
    subject: payload.sub,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, config.jwt.accessSecret, {
    issuer: ISSUER,
    audience: 'farah-mobile',
  }) as jwt.JwtPayload;

  if (!decoded.sub || typeof decoded.role !== 'string' || typeof decoded.username !== 'string') {
    throw new Error('Malformed access token payload');
  }
  return { sub: decoded.sub, role: decoded.role as 'ADMIN' | 'WORKER', username: decoded.username };
}

/**
 * Refresh tokens are opaque random strings, NOT JWTs. Only their SHA-256 hash
 * is stored, which means a database leak cannot be replayed as a login and the
 * admin can revoke any session. Tokens rotate on every use.
 */
export function generateRefreshToken(): { token: string; hash: string; expiresAt: Date } {
  const token = crypto.randomBytes(48).toString('base64url');
  return {
    token,
    hash: hashRefreshToken(token),
    expiresAt: refreshTokenExpiry(),
  };
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiry(): Date {
  return new Date(Date.now() + config.jwt.refreshTtlDays * 86_400_000);
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
