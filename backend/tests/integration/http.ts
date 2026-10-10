import { createServer, type Server } from 'node:http';
import type { Express } from 'express';

/**
 * Minimal supertest-compatible client.
 *
 * We drive the real HTTP server (rather than Express internals) so tests
 * exercise the full middleware chain: helmet, CORS, rate limiting, body
 * parsing, auth and the error handler.
 */

export interface Res {
  status: number;
  body: any;
  headers: Record<string, string>;
  text: string;
}

export interface ReqSpec {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

let server: Server | null = null;
let origin = '';

export async function listen(target: Express): Promise<string> {
  if (!server) {
    server = createServer(target);
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (addr && typeof addr === 'object') origin = `http://127.0.0.1:${addr.port}`;
  }
  return origin;
}

export async function close(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
}

export async function inject(spec: ReqSpec): Promise<Res> {
  const base = await listen(appRef);
  const headers: Record<string, string> = { ...(spec.headers ?? {}) };

  let payload: string | undefined;
  if (spec.body !== undefined) {
    payload = JSON.stringify(spec.body);
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(Buffer.byteLength(payload));
  }

  const response = await fetch(`${base}${spec.url}`, {
    method: spec.method,
    headers,
    body: payload,
  });

  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  const headerMap: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    headerMap[name] = value;
  });

  return { status: response.status, body, headers: headerMap, text };
}

// Bound by `bind()` at import time in setup.ts.
let appRef: Express;
export function bind(target: Express): void {
  appRef = target;
}
