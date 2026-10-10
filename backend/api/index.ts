/**
 * Vercel serverless entry point.
 *
 * Vercel does not run our Docker image on the Hobby plan, so the same Express
 * app is exposed as a Node serverless function instead. Everything the app does
 * (routes, auth, Prisma, PostgreSQL via Neon) is unchanged - only the way it is
 * started differs: instead of `app.listen()`, the platform passes req/res.
 */
import type { ServerlessRequest, ServerlessResponse } from '@vercel/node';

import { createApp } from '../src/app';

const app = createApp();

export default function handler(req: ServerlessRequest, res: ServerlessResponse): void {
  // Vercel rewrites every path to this function, so req.url still carries the
  // original /api/v1/... prefix that our Express router expects.
  app(req as never, res as never);
}
