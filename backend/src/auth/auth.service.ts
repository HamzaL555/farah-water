import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../prisma';
import { audit } from '../common/utils/audit';
import { AppError, unauthorized } from '../common/utils/errors';
import { generateRefreshToken, hashRefreshToken, signAccessToken } from './tokens';

export interface AuthContext {
  ip?: string;
  userAgent?: string;
}

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface PublicUser {
  id: string;
  fullName: string;
  username: string;
  phone: string | null;
  email: string | null;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
}

export interface AuthResult {
  user: PublicUser;
  tokens: SessionTokens;
}

/**
 * Whitelist of fields safe to send to a client.
 *
 * This is a security boundary, not a convenience: the caller passes a full
 * Prisma user row (which includes passwordHash), so every field must be
 * listed explicitly. Adding a column to the schema must never silently leak it.
 */
function publicUser(user: {
  id: string;
  fullName: string;
  username: string;
  phone: string | null;
  email: string | null;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
}): PublicUser {
  return {
    id: user.id,
    fullName: user.fullName,
    username: user.username,
    phone: user.phone,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword,
  };
}

async function issueSession(user: PublicUser, ctx: AuthContext): Promise<AuthResult> {
  const accessToken = signAccessToken({ sub: user.id, role: user.role, username: user.username });
  const refresh = generateRefreshToken();

  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: refresh.hash,
      expiresAt: refresh.expiresAt,
      userAgent: ctx.userAgent ?? null,
      ip: ctx.ip ?? null,
    },
  });

  return {
    // Explicit whitelist: never spread the raw row (it holds passwordHash).
    user: publicUser(user),
    tokens: {
      accessToken,
      refreshToken: refresh.token,
      expiresIn: config.jwt.accessTtl,
    },
  };
}

/**
 * Login accepts username, e-mail or phone number in a single "identifier"
 * field, as required by the spec.
 */
export async function login(identifier: string, password: string, ctx: AuthContext): Promise<AuthResult> {
  const normalized = identifier.trim();
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { username: { equals: normalized, mode: 'insensitive' } },
        { email: { equals: normalized, mode: 'insensitive' } },
        { phone: normalized },
      ],
    },
  });

  const fail = async (message: string, reason: string): Promise<never> => {
    await prisma.loginAttempt.create({
      data: { identifier: normalized.slice(0, 120), ip: ctx.ip ?? null, success: false },
    });
    await audit({
      actorId: user?.id ?? null,
      actorName: user?.fullName ?? null,
      action: 'auth.login.failed',
      entityType: 'user',
      entityId: user?.id ?? null,
      meta: { reason, identifier: normalized.slice(0, 120) },
      req: { headers: {}, ip: ctx.ip } as never,
    });
    throw new AppError(401, message, 'INVALID_CREDENTIALS');
  };

  // Uniform error message whether the user exists or not (no user enumeration).
  if (!user) return fail('İstifadəçi adı və ya şifrə düzgün deyil.', 'user-not-found');

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000));
    throw new AppError(
      423,
      `Hesab müvəqqəti bloklanıb. ${minutes} dəqiqə sonra yenidən cəhd edin.`,
      'ACCOUNT_LOCKED',
    );
  }

  if (!user.isActive) return fail('Hesabınız deaktiv edilib. Administratora müraciət edin.', 'inactive');

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const attempts = user.failedLoginAttempts + 1;
    const shouldLock = attempts >= config.security.maxFailedLogins;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil: shouldLock
          ? new Date(Date.now() + config.security.lockMinutes * 60_000)
          : user.lockedUntil,
      },
    });
    const left = config.security.maxFailedLogins - attempts;
    return fail(
      shouldLock
        ? `Hesab bloklandı. ${config.security.lockMinutes} dəqiqə sonra yenidən cəhd edin.`
        : `İstifadəçi adı və ya şifrə düzgün deyil. ${left} cəhd qalıb.`,
      shouldLock ? 'locked' : 'bad-password',
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  await prisma.loginAttempt.create({
    data: { identifier: normalized.slice(0, 120), ip: ctx.ip ?? null, success: true },
  });

  const result = await issueSession(user, ctx);
  await audit({
    actorId: user.id,
    actorName: user.fullName,
    actorRole: user.role,
    action: 'auth.login.success',
    entityType: 'user',
    entityId: user.id,
    req: { headers: {}, ip: ctx.ip } as never,
  });
  return result;
}

/** Rotating refresh: the presented token is revoked and replaced. */
export async function refresh(refreshToken: string, ctx: AuthContext): Promise<AuthResult> {
  if (!refreshToken) throw unauthorized('Refresh token tapılmadı.');
  const hash = hashRefreshToken(refreshToken);

  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hash }, include: { user: true } });
  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    if (stored) {
      await audit({
        actorId: stored.userId,
        action: 'auth.refresh.reuse_detected',
        entityType: 'user',
        entityId: stored.userId,
        meta: { reason: stored.revokedAt ? 'revoked' : 'expired' },
      });
    }
    throw unauthorized('Sessiya bitib. Yenidən daxil olun.');
  }

  if (!stored.user.isActive) throw new AppError(403, 'Hesabınız deaktiv edilib.', 'FORBIDDEN');

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  return issueSession(stored.user, ctx);
}

export async function logout(refreshToken: string | undefined, userId?: string): Promise<void> {
  if (refreshToken) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashRefreshToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  if (userId) {
    await audit({ actorId: userId, action: 'auth.logout', entityType: 'user', entityId: userId });
  }
}

export async function logoutAll(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await audit({ actorId: userId, action: 'auth.logout_all', entityType: 'user', entityId: userId });
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  req?: never,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthorized();

  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) throw new AppError(400, 'Cari şifrə düzgün deyil.', 'BAD_PASSWORD');

  const passwordHash = await bcrypt.hash(newPassword, config.security.bcryptRounds);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash, mustChangePassword: false },
  });
  // Force every other device to re-authenticate after a password change.
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await audit({
    actorId: userId,
    actorName: user.fullName,
    action: 'auth.password.changed',
    entityType: 'user',
    entityId: userId,
    req,
  });
}
