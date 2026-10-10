import bcrypt from 'bcryptjs';
import { Prisma, Role } from '@prisma/client';
import { config } from '../config';
import { prisma } from '../prisma';
import { badRequest, conflict, forbidden, notFound } from '../common/utils/errors';
import { audit } from '../common/utils/audit';
import { paginate, serializeUser } from '../common/utils/serialize';
import { resolveRange, DateRangePreset, startOfLocalDay, endOfLocalDay } from '../common/utils/date';
import { strongPassword } from '../auth/auth.schemas';

export interface Actor {
  id: string;
  role: Role;
  fullName: string;
}

/** Only digits, optional leading +, 7-20 chars. */
function normalizePhone(phone?: string | null): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;
  if (!/^\+?[0-9]{7,20}$/.test(trimmed)) throw badRequest('Telefon nömrəsi düzgün deyil (7-20 rəqəm).');
  return trimmed;
}

function tempPassword(): string {
  // Ambiguous characters removed to survive being read aloud / copied by hand.
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*';
  const all = upper + lower + digits + symbols;
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < 10) chars.push(pick(all));
  // Fisher-Yates so the guaranteed character classes aren't always positions 1-4.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export interface CreateWorkerInput {
  fullName: string;
  username: string;
  phone?: string;
  email?: string;
  password?: string;
}

/**
 * Admin-only worker provisioning.
 *
 * There is NO public registration endpoint anywhere in this API, so nobody can
 * ever make themselves an admin. Passwords are bcrypt-hashed; when the admin
 * lets the system pick one, the worker is forced to change it at next login.
 */
export async function createWorker(input: CreateWorkerInput, actor: Actor, req?: never) {
  if (actor.role !== Role.ADMIN) throw forbidden('Yalnız administrator işçi yarada bilər.');

  const username = input.username?.trim().toLowerCase();
  if (!username || !/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw badRequest('İstifadəçi adı 3-32 simvol olmalıdır (kiçik hərf, rəqəm, . _ -).');
  }
  if (!input.fullName?.trim()) throw badRequest('Ad və soyad tələb olunur.');

  const email = input.email?.trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('E-mail ünvanı düzgün deyil.');

  const phone = normalizePhone(input.phone);
  const generated = !input.password;
  const password = generated ? tempPassword() : input.password!;
  const parsed = strongPassword.safeParse(password);
  if (!parsed.success) throw badRequest(Object.values(parsed.error.flatten().fieldErrors)[0]?.[0] ?? 'Şifrə güclü deyil.');

  const clash = await prisma.user.findFirst({
    where: { OR: [{ username }, ...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] },
    select: { username: true, email: true, phone: true },
  });
  if (clash) throw conflict('Bu istifadəçi adı, e-mail və ya telefon artıq istifadə olunur.');

  const user = await prisma.user.create({
    data: {
      fullName: input.fullName.trim(),
      username,
      phone,
      email,
      passwordHash: await bcrypt.hash(password, config.security.bcryptRounds),
      role: Role.WORKER,
      mustChangePassword: generated,
      isActive: true,
    },
  });

  await audit({
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'user.worker_created',
    entityType: 'user',
    entityId: user.id,
    after: serializeUser(user),
    req,
  });

  // The plaintext password is returned exactly once, to the creating admin.
  return { user: serializeUser(user), temporaryPassword: generated ? password : undefined };
}

export async function updateWorker(
  id: string,
  patch: { fullName?: string; phone?: string | null; email?: string | null; isActive?: boolean },
  actor: Actor,
  req?: never,
) {
  if (actor.role !== Role.ADMIN) throw forbidden('Yalnız administrator hesabı redaktə edə bilər.');

  const before = await prisma.user.findUnique({ where: { id } });
  if (!before) throw notFound('İşçi tapılmadı.');

  const data: Prisma.UserUpdateInput = {};
  if (patch.fullName !== undefined) {
    if (!patch.fullName.trim()) throw badRequest('Ad və soyad boş ola bilməz.');
    data.fullName = patch.fullName.trim();
  }
  if (patch.phone !== undefined) data.phone = normalizePhone(patch.phone);
  if (patch.email !== undefined) {
    const email = patch.email?.trim().toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('E-mail ünvanı düzgün deyil.');
    data.email = email;
  }
  if (patch.isActive !== undefined) {
    // Guard against an admin locking themselves (and any other admin) out.
    if (before.role === Role.ADMIN && !patch.isActive) {
      throw forbidden('Administrator hesabını deaktiv etmək mümkün deyil.');
    }
    data.isActive = patch.isActive;
    if (!patch.isActive) {
      // Revoke sessions immediately so the worker is locked out at once.
      await prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await prisma.user.update({ where: { id }, data: { lockedUntil: null, failedLoginAttempts: 0 } });
    }
  }

  let user;
  try {
    user = await prisma.user.update({ where: { id }, data });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw conflict('Bu telefon və ya e-mail artıq istifadə olunur.');
    }
    throw err;
  }

  await audit({
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'user.updated',
    entityType: 'user',
    entityId: id,
    before: serializeUser(before),
    after: serializeUser(user),
    meta: { changes: Object.keys(patch) },
    req,
  });

  return serializeUser(user);
}

export async function resetWorkerPassword(id: string, actor: Actor, req?: never) {
  if (actor.role !== Role.ADMIN) throw forbidden('Yalnız administrator şifrə sıfırlaya bilər.');
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw notFound('İşçi tapılmadı.');

  const password = tempPassword();
  await prisma.user.update({
    where: { id },
    data: {
      passwordHash: await bcrypt.hash(password, config.security.bcryptRounds),
      mustChangePassword: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });
  // Force the worker out of every existing session.
  await prisma.refreshToken.updateMany({
    where: { userId: id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await audit({
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'user.password_reset',
    entityType: 'user',
    entityId: id,
    meta: { targetUsername: user.username },
    req,
  });

  return { temporaryPassword: password };
}

export async function listWorkers(
  query: { search?: string; isActive?: boolean; page?: number; pageSize?: number; preset?: DateRangePreset },
  actor: Actor,
) {
  if (actor.role !== Role.ADMIN) throw forbidden('İşçi siyahısına yalnız administrator baxa bilər.');

  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));

  const where: Prisma.UserWhereInput = {
    role: Role.WORKER,
    ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    ...(query.search
      ? {
          OR: [
            { fullName: { contains: query.search, mode: 'insensitive' } },
            { username: { contains: query.search, mode: 'insensitive' } },
            { phone: { contains: query.search } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { fullName: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.user.count({ where }),
  ]);

  return paginate(rows.map(serializeUser), total, page, pageSize);
}

/**
 * Worker list enriched with the operating numbers the admin dashboard needs.
 * Every figure is a real aggregate over PostgreSQL, not a cached counter.
 */
export async function listWorkersWithStats(actor: Actor) {
  if (actor.role !== Role.ADMIN) throw forbidden('Bu məlumatı yalnız administrator görə bilər.');

  const dayStart = startOfLocalDay();
  const dayEnd = endOfLocalDay();

  const workers = await prisma.user.findMany({ where: { role: Role.WORKER }, orderBy: { fullName: 'asc' } });
  if (workers.length === 0) return [];

  const ids = workers.map((w) => w.id);

  const [balances, todayDeliveries, todayPayments, totalDeliveries, debtAgg] = await Promise.all([
    prisma.inventoryBalance.findMany({ where: { workerId: { in: ids } } }),
    prisma.delivery.groupBy({
      by: ['workerId'],
      where: { workerId: { in: ids }, deliveredAt: { gte: dayStart, lt: dayEnd } },
      _sum: { bottleCount: true },
      _count: { _all: true },
    }),
    prisma.payment.groupBy({
      by: ['workerId'],
      where: { workerId: { in: ids }, voidedAt: null, paidAt: { gte: dayStart, lt: dayEnd } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.delivery.groupBy({
      by: ['workerId'],
      where: { workerId: { in: ids }, status: { not: 'CANCELLED' } },
      _count: { _all: true },
      _sum: { bottleCount: true },
    }),
    prisma.delivery.groupBy({
      by: ['workerId'],
      where: { workerId: { in: ids }, debtAmount: { gt: 0 }, status: { not: 'CANCELLED' } },
      _sum: { debtAmount: true },
    }),
  ]);

  const map = <T extends { workerId: string }>(arr: T[]) => new Map(arr.map((r) => [r.workerId, r]));

  return workers.map((w) => {
    const d = map(todayDeliveries).get(w.id);
    const p = map(todayPayments).get(w.id);
    const t = map(totalDeliveries).get(w.id);
    const debt = map(debtAgg).get(w.id);
    const balance = balances.find((b) => b.workerId === w.id);
    return {
      ...serializeUser(w),
      todayBottles: d?._sum.bottleCount ?? 0,
      todayDeliveries: d?._count._all ?? 0,
      todayCollected: Number((p?._sum.amount ?? new Prisma.Decimal(0)).toFixed(2)),
      todayPayments: p?._count._all ?? 0,
      assignedBottles: balance?.quantity ?? 0,
      totalDeliveries: t?._count._all ?? 0,
      totalBottles: t?._sum.bottleCount ?? 0,
      outstandingDebt: Number((debt?._sum.debtAmount ?? new Prisma.Decimal(0)).toFixed(2)),
    };
  });
}

/** Everything the admin needs to audit one worker's activity. */
export async function getWorkerDetail(id: string, actor: Actor) {
  if (actor.role !== Role.ADMIN && actor.id !== id) {
    throw forbidden('Bu profili görə bilməzsiniz.');
  }
  const worker = await prisma.user.findUnique({ where: { id } });
  if (!worker) throw notFound('İşçi tapılmadı.');

  const balance = await prisma.inventoryBalance.findUnique({ where: { key: `WORKER:${id}` } });
  const debt = await prisma.delivery.aggregate({
    where: { workerId: id, debtAmount: { gt: 0 }, status: { not: 'CANCELLED' } },
    _sum: { debtAmount: true },
  });

  return {
    ...serializeUser(worker),
    stockInHand: balance?.quantity ?? 0,
    outstandingDebt: Number((debt._sum.debtAmount ?? new Prisma.Decimal(0)).toFixed(2)),
  };
}

/** A worker may edit their own contact details only. */
export async function updateMyProfile(
  id: string,
  patch: { fullName?: string; phone?: string | null; email?: string | null },
  req?: never,
) {
  const before = await prisma.user.findUnique({ where: { id } });
  if (!before) throw notFound('İstifadəçi tapılmadı.');

  const data: Prisma.UserUpdateInput = {};
  if (patch.fullName !== undefined) {
    if (!patch.fullName.trim()) throw badRequest('Ad və soyad boş ola bilməz.');
    data.fullName = patch.fullName.trim();
  }
  if (patch.phone !== undefined) data.phone = normalizePhone(patch.phone);
  if (patch.email !== undefined) {
    const email = patch.email?.trim().toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('E-mail ünvanı düzgün deyil.');
    data.email = email;
  }

  let user;
  try {
    user = await prisma.user.update({ where: { id }, data });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw conflict('Bu telefon və ya e-mail artıq istifadə olunur.');
    }
    throw err;
  }

  await audit({
    actorId: id,
    actorName: user.fullName,
    action: 'user.profile_updated',
    entityType: 'user',
    entityId: id,
    before: serializeUser(before),
    after: serializeUser(user),
    req,
  });

  return serializeUser(user);
}
