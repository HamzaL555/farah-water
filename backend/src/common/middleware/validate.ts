import { NextFunction, Request, Response } from 'express';
import { ZodError, ZodType } from 'zod';
import { AppError } from '../utils/errors';

/**
 * Zod request validation. `req.body` is replaced by the parsed (coerced,
 * stripped) value so handlers only ever see trusted, typed data.
 */
export function validate(
  schema: ZodType,
  source: 'body' | 'query' | 'params' = 'body',
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = formatZodError(result.error);
      return next(new AppError(422, 'Məlumatlar düzgün deyil.', 'VALIDATION_ERROR', details));
    }
    if (source === 'query') {
      // Express 4 exposes req.query as a getter-only property on some versions.
      Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true });
    } else {
      req[source] = result.data;
    }
    next();
  };
}

export function formatZodError(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
