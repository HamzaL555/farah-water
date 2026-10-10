import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

function str(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return v;
}

function num(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Environment variable ${key} must be a number`);
  return n;
}

const nodeEnv = str('NODE_ENV', 'development');

export const config = {
  env: nodeEnv,
  isProd: nodeEnv === 'production',
  port: num('PORT', 4000),
  apiPrefix: str('API_PREFIX', '/api/v1'),

  jwt: {
    accessSecret: str('JWT_ACCESS_SECRET', 'dev-only-access-secret-change-me-0123456789'),
    refreshSecret: str('JWT_REFRESH_SECRET', 'dev-only-refresh-secret-change-me-9876543210'),
    accessTtl: str('ACCESS_TOKEN_TTL', '30m'),
    refreshTtlDays: num('REFRESH_TOKEN_TTL_DAYS', 30),
  },

  security: {
    bcryptRounds: num('BCRYPT_ROUNDS', 12),
    maxFailedLogins: num('MAX_FAILED_LOGINS', 5),
    lockMinutes: num('LOCK_MINUTES', 15),
    // The integration suite performs many logins (including deliberate
    // failures) against one in-process app, so the throttle is lifted there.
    // Account lockout still applies and is tested on its own.
    loginRateLimitMax: nodeEnv === 'test' ? 10_000 : num('LOGIN_RATE_LIMIT_MAX', 10),
    loginRateLimitWindowMin: num('LOGIN_RATE_LIMIT_WINDOW_MIN', 15),
  },

  corsOrigin: str('CORS_ORIGIN', '*'),

  business: {
    defaultBottlePrice: str('DEFAULT_BOTTLE_PRICE', '2.00'),
    currency: str('CURRENCY', 'AZN'),
  },

  bootstrapAdmin: {
    username: str('INITIAL_ADMIN_USERNAME', 'admin'),
    password: str('INITIAL_ADMIN_PASSWORD', ''),
    fullName: str('INITIAL_ADMIN_FULL_NAME', 'Farah Su Şirkəti Admin'),
    phone: str('INITIAL_ADMIN_PHONE', ''),
  },
} as const;

export type AppConfig = typeof config;
