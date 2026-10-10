import type { Request } from 'express';
import type { Role } from '@prisma/client';

export function actorOf(req: Request): { id: string; role: Role; fullName: string } {
  return { id: req.user!.id, role: req.user!.role, fullName: req.user!.fullName };
}

/**
 * Express 5 types a route param as `string | string[]` (path-to-regexp 8 can
 * produce repeatable segments). Every param in this API is a single segment,
 * so normalise it here instead of casting at every call site.
 */
export function param(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}
