import { NextFunction, Request, Response } from 'express';
import { Role, WorkerType } from '@prisma/client';
import { verifyAccessToken } from '../../auth/tokens';
import { prisma } from '../../prisma';
import { forbidden, unauthorized } from '../utils/errors';

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: Role; username: string; fullName: string; workerType: WorkerType | null };
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return next(unauthorized('Daxil olmaq üçün token tapılmadı.'));
    }
    const token = header.slice(7).trim();
    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      return next(unauthorized('Sessiyanın vaxtı bitib. Yenidən daxil olun.'));
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, username: true, fullName: true, workerType: true, isActive: true },
    });
    if (!user) return next(unauthorized('İstifadəçi tapılmadı.'));
    if (!user.isActive) return next(forbidden('Hesabınız deaktiv edilib. Administratora müraciət edin.'));

    req.user = {
      id: user.id,
      role: user.role,
      username: user.username,
      fullName: user.fullName,
      workerType: user.workerType ?? null,
    };
    next();
  } catch (err) {
    next(err);
  }
}

export function canManageWarehouse(user: { role: Role; workerType: WorkerType | null } | undefined): boolean {
  if (!user) return false;
  return user.role === Role.ADMIN || user.workerType === WorkerType.WAREHOUSE_KEEPER;
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(forbidden('Bu bölməyə yalnız administratorun girişi var.'));
    }
    next();
  };
}

export function canAccessOwner(req: Request, ownerId: string): boolean {
  if (!req.user) return false;
  return req.user.role === 'ADMIN' || req.user.id === ownerId;
}
