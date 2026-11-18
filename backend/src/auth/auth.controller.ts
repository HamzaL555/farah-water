import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { changePassword, login, logout, logoutAll, refresh } from './auth.service';
import { asyncHandler } from '../common/middleware/error';

function ctxOf(req: Request) {
  return {
    ip: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip,
    userAgent: req.headers['user-agent'],
  };
}

export const loginController = asyncHandler(async (req: Request, res: Response) => {
  const { identifier, password } = req.body;
  const result = await login(identifier, password, ctxOf(req));
  res.json({ data: result });
});

export const refreshController = asyncHandler(async (req: Request, res: Response) => {
  const result = await refresh(req.body.refreshToken, ctxOf(req));
  res.json({ data: result });
});

export const logoutController = asyncHandler(async (req: Request, res: Response) => {
  await logout(req.body?.refreshToken, req.user?.id);
  res.json({ data: { success: true } });
});

export const logoutAllController = asyncHandler(async (req: Request, res: Response) => {
  await logoutAll(req.user!.id);
  res.json({ data: { success: true } });
});

export const changePasswordController = asyncHandler(async (req: Request, res: Response) => {
  await changePassword(req.user!.id, req.body.currentPassword, req.body.newPassword, req as never);
  res.json({ data: { success: true } });
});

export const meController = asyncHandler(async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      id: true,
      fullName: true,
      username: true,
      phone: true,
      email: true,
      role: true,
      workerType: true,
      isActive: true,
      mustChangePassword: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });
  res.json({ data: { ...user, lastLoginAt: user?.lastLoginAt?.toISOString() ?? null } });
});
