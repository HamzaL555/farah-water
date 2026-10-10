import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config';
import { requireAuth } from '../common/middleware/auth';
import { validate } from '../common/middleware/validate';

import {
  changePasswordController,
  loginController,
  logoutAllController,
  logoutController,
  meController,
  refreshController,
} from './auth.controller';
import { changePasswordSchema, loginSchema, logoutSchema, refreshSchema } from './auth.schemas';

export const authRouter = Router();

/** Extra brute-force throttle in front of the per-account lockout. */
const loginLimiter = rateLimit({
  windowMs: config.security.loginRateLimitWindowMin * 60_000,
  limit: config.security.loginRateLimitMax,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Çox sayda cəhd edildi. Bir az gözləyin.' } },
});

authRouter.post('/login', loginLimiter, validate(loginSchema), loginController);
authRouter.post('/refresh', validate(refreshSchema), refreshController);
authRouter.post('/logout', validate(logoutSchema), logoutController);

authRouter.get('/me', requireAuth, meController);
authRouter.post('/logout-all', requireAuth, logoutAllController);
authRouter.post('/change-password', requireAuth, validate(changePasswordSchema), changePasswordController);
