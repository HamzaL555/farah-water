/**
 * Vercel serverless entry point.
 *
 * Vercel does not run our Docker image on the Hobby plan, so the same Express
 * app is exposed as a Node serverless function instead. Everything the app does
 * (routes, auth, Prisma, PostgreSQL via Neon) is unchanged - only the way it is
 * started differs: instead of `app.listen()`, the platform passes req/res.
 *
 * Types come from Express rather than @vercel/node: the request/response objects
 * Vercel hands us ARE Express-compatible (Node's http.IncomingMessage /
 * ServerResponse), so reusing our own types avoids a dependency mismatch.
 */
import type { Request, Response } from 'express';

import { createApp } from '../src/app';

const app = createApp();

export default function handler(req: Request, res: Response): void {
  // vercel.json rewrites every path here, so req.url keeps the original
  // /api/v1/... prefix that our Express router expects.
  app(req, res);
}
