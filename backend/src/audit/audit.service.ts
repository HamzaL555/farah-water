import { Prisma, Role } from '@prisma/client';
import { prisma } from '../prisma';
import { forbidden } from '../common/utils/errors';
import { paginate } from '../common/utils/serialize';
import { resolveRange, DateRangePreset } from '../common/utils/date';
import { audit } from '../common/utils/audit';
import { Actor } from '../users/users.service';

export interface ListAuditQuery {
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  preset?: DateRangePreset;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/** Audit trail is admin-only: it can contain operational detail about staff. */
export async function listAuditLogs(query: ListAuditQuery, actor: Actor) {
  if (actor.role !== Role.ADMIN) throw forbidden('Audit jurnalına yalnız administrator baxa bilər.');

  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));
  const { start, end } = resolveRange(query.preset, query.from ? new Date(query.from) : null, query.to ? new Date(query.to) : null);

  const where: Prisma.AuditLogWhereInput = {
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
    ...(query.entityType ? { entityType: query.entityType } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(start || end ? { createdAt: { ...(start ? { gte: start } : {}), ...(end ? { lt: end } : {}) } } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return paginate(
    rows.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      actorName: r.actorName,
      actorRole: r.actorRole,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      before: r.before,
      after: r.after,
      meta: r.meta,
      ip: r.ip,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
  );
}

/** Full history for one record, e.g. an admin investigating a bad entry. */
export async function auditTrailFor(entityType: string, entityId: string, actor: Actor) {
  if (actor.role !== Role.ADMIN) throw forbidden('Audit jurnalına yalnız administrator baxa bilər.');
  const rows = await prisma.auditLog.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return rows.map((r) => ({
    id: r.id,
    actorName: r.actorName,
    action: r.action,
    before: r.before,
    after: r.after,
    meta: r.meta,
    createdAt: r.createdAt.toISOString(),
  }));
}

export const DEFAULT_SETTINGS = {
  companyName: 'Farah Su Şirkəti',
  currency: 'AZN',
  defaultBottlePrice: '2.00',
  dateFormat: 'DD.MM.YYYY',
  timezoneOffsetMinutes: 240,
};

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof typeof DEFAULT_SETTINGS)[];

export async function getSettings(actor: Actor) {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: SETTING_KEYS } } });
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const [k, v] of stored) {
    merged[k] = typeof v === 'object' && v !== null && 'value' in (v as object) ? (v as { value: unknown }).value : v;
  }
  merged.defaultBottlePrice = Number(merged.defaultBottlePrice ?? DEFAULT_SETTINGS.defaultBottlePrice);
  return merged;
}

export async function updateSettings(patch: Record<string, unknown>, actor: Actor, req?: never) {
  if (actor.role !== Role.ADMIN) throw forbidden('Yalnız administrator parametrləri dəyişə bilər.');

  const keys = Object.keys(patch).filter((k) => SETTING_KEYS.includes(k as never));
  if (keys.length === 0) throw forbidden('Dəyişdirilə bilən parametr tapılmadı.');

  for (const key of keys) {
    await prisma.appSetting.upsert({
      where: { key },
      update: { value: { value: patch[key] } as never, updatedById: actor.id },
      create: { key, value: { value: patch[key] } as never, updatedById: actor.id },
    });
  }

  await audit({
    actorId: actor.id,
    actorName: actor.fullName,
    actorRole: actor.role,
    action: 'settings.updated',
    entityType: 'app_settings',
    after: patch,
    req,
  });

  return getSettings(actor);
}
