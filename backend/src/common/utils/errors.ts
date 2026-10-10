/** Typed application errors mapped to clean HTTP responses by the error handler. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string = 'APP_ERROR',
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new AppError(400, msg, 'BAD_REQUEST', details);

export const unauthorized = (msg = 'İcazəniz yoxdur. Yenidən daxil olun.') =>
  new AppError(401, msg, 'UNAUTHORIZED');

export const forbidden = (msg = 'Bu əməliyyat üçün icazəniz yoxdur.') =>
  new AppError(403, msg, 'FORBIDDEN');

export const notFound = (msg = 'Məlumat tapılmadı.') => new AppError(404, msg, 'NOT_FOUND');

export const conflict = (msg: string, details?: unknown) => new AppError(409, msg, 'CONFLICT', details);

export const unprocessable = (msg: string, details?: unknown) =>
  new AppError(422, msg, 'UNPROCESSABLE', details);
