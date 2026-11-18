import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { errorHandler, notFoundHandler } from './common/middleware/error';
import { authRouter } from './auth/auth.routes';
import { usersRouter } from './users/users.routes';
import { customersRouter } from './customers/customers.routes';
import { companiesRouter } from './companies/companies.routes';
import { deliveriesRouter } from './deliveries/deliveries.routes';
import { paymentsRouter } from './payments/payments.routes';
import { debtsRouter } from './debts/debts.routes';
import { inventoryRouter } from './inventory/inventory.routes';
import { dashboardRouter } from './dashboard/dashboard.routes';
import { reportsRouter } from './reports/reports.routes';
import { auditRouter } from './audit/audit.routes';
import { deliveryCorrectionsRouter } from './delivery-corrections/delivery-corrections.routes';
import { notificationsRouter } from './notifications/notification.routes';
import { depositsRouter } from './deposits/deposits.routes';
import { pricesRouter } from './prices/prices.routes';
import { expensesRouter } from './expenses/expenses.routes';

export function createApp(): Express {
  const app = express();

  // Behind an nginx/Caddy reverse proxy in production.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // The API serves JSON and downloadable files, never HTML documents.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  const origins = config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((o) => o.trim());
  app.use(cors({ origin: origins, credentials: true }));

  /**
   * Every API response is per-user and must never be stored by a shared cache.
   *
   * Without this the CDN is free to keep a response that carries one origin's
   * `Access-Control-Allow-Origin` value and replay it to a different origin,
   * which breaks the web panel with a CORS error that looks random depending
   * on cache state. It would also risk one user's response being served to
   * another.
   */
  app.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    next();
  });

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  if (!config.isProd) app.use(morgan('dev'));

  // Global safety net. Login has its own tighter limiter in auth.routes.
  app.use(
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: 'RATE_LIMITED', message: 'Çox sayda sorğu göndərildi. Bir az gözləyin.' } },
    }),
  );

  const api = express.Router();
  api.get('/health', (_req, res) => {
    res.json({ data: { status: 'ok', time: new Date().toISOString() } });
  });

  api.use('/auth', authRouter);
  api.use('/users', usersRouter);
  api.use('/customers', customersRouter);
  api.use('/companies', companiesRouter);
  api.use('/deliveries', deliveriesRouter);
  api.use('/payments', paymentsRouter);
  api.use('/debts', debtsRouter);
  api.use('/inventory', inventoryRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/reports', reportsRouter);
  api.use('/audit', auditRouter);
  api.use('/delivery-corrections', deliveryCorrectionsRouter);
  api.use('/notifications', notificationsRouter);
  api.use('/deposits', depositsRouter);
  api.use('/prices', pricesRouter);
  api.use('/expenses', expensesRouter);

  app.use(config.apiPrefix, api);

  // Serve the admin panel static files in production.
  // In development the panel is served by the Vite/dev server or opened directly.
  if (config.isProd) {
    const adminDir = path.join(__dirname, '../public/admin');
    app.use('/admin', express.static(adminDir));
    // SPA fallback: any non-API, non-admin-asset route serves index.html so
    // client-side routing works on refresh. Uses a regex so Express 5
    // path-to-regexp accepts it.
    app.get(/\/admin\/(?!api\/)(.*)/, (_req, res) => {
      res.sendFile(path.join(adminDir, 'index.html'));
    });
  }

  app.get('/', (_req, res) => {
    res.json({ data: { name: 'Farah Water Company API', version: '1.0.0', status: 'running' } });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
