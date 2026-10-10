import type { Request } from 'express';
import { prisma } from '../../prisma';

export interface AuditEntry {
  actorId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  meta?: unknown;
  req?: Request;
}

/**
 * Writes an audit row. Audit failures must never break the business operation
 * that triggered them, so errors are logged and swallowed.
 */
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    let ip: string | undefined;
    let userAgent: string | undefined;
    if (entry.req) {
      ip = (entry.req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || entry.req.ip;
      userAgent = entry.req.headers['user-agent'];
    }
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        actorName: entry.actorName ?? null,
        actorRole: entry.actorRole ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: (entry.before ?? undefined) as never,
        after: (entry.after ?? undefined) as never,
        meta: (entry.meta ?? undefined) as never,
        ip: ip ?? null,
        userAgent: userAgent ?? null,
      },
    });
  } catch (err) {
    console.error('[audit] failed to write audit log', err);
  }
}
