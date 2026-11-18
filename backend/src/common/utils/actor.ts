import type { Request } from 'express';
import type { Role, WorkerType } from '@prisma/client';

/**
 * The authenticated caller, as the services read it.
 *
 * `workerType` decides warehouse access: WAREHOUSE_KEEPER runs the anbar,
 * REGULAR only ever sees their own balance, ADMIN sees and does everything.
 */
export function actorOf(req: Request): {
  id: string;
  role: Role;
  fullName: string;
  workerType: WorkerType | null;
} {
  return {
    id: req.user!.id,
    role: req.user!.role,
    fullName: req.user!.fullName,
    workerType: req.user!.workerType ?? null,
  };
}

/**
 * Express 5 types a route param as `string | string[]` (path-to-regexp 8 can
 * produce repeatable segments). Every param in this API is a single segment,
 * so normalise it here rather than casting at every call site.
 */
export function param(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}
