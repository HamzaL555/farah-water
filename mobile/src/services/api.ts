import { API_BASE_URL, ApiError, type ApiEnvelope } from './types';
import { clearTokens, loadTokens, saveTokens } from './secureStorage';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

const REQUEST_TIMEOUT_MS = 20_000;

export interface ApiClientOptions {
  baseUrl?: string;
  onUnauthorized?: () => void;
}

/**
 * Single HTTP client for the whole app.
 *
 * Responsibilities:
 *  - attach the bearer access token,
 *  - transparently refresh an expired token ONCE and replay the request,
 *  - normalise every error into `ApiError` so the UI never sees raw fetch output.
 *
 * The server is the authority for money and inventory: this client only ever
 * forwards what the user typed and renders what came back.
 */
export class ApiClient {
  private baseUrl: string;
  /** Public so the app can swap in a handler after construction. */
  onUnauthorized?: () => void;
  /** De-duplicates concurrent refreshes so a burst of 401s triggers one call. */
  private refreshInFlight: Promise<boolean> | null = null;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? API_BASE_URL;
    this.onUnauthorized = options.onUnauthorized;
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private async request<T>(
    method: Method,
    path: string,
    body?: unknown,
    options: { auth?: boolean; retryOn401?: boolean } = {},
  ): Promise<{ data: T; meta?: { duplicate?: boolean } }> {
    const { auth = true, retryOn401 = true } = options;
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    if (auth) {
      const tokens = await loadTokens();
      if (tokens) headers.Authorization = `Bearer ${tokens.accessToken}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      // status 0 marks a transport failure (offline, server down, timeout),
      // which the offline queue treats as retryable.
      const aborted = err instanceof Error && err.name === 'AbortError';
      throw new ApiError(
        0,
        aborted
          ? 'Sorğu vaxtında cavab vermədi. Şəbəkəni yoxlayın.'
          : 'Serverə qoşulma mümkün olmadı. İnternet bağlantısını yoxlayın.',
        aborted ? 'TIMEOUT' : 'NETWORK',
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 && auth && retryOn401) {
      const refreshed = await this.refreshTokens();
      if (refreshed) {
        return this.request<T>(method, path, body, { auth, retryOn401: false });
      }
      await clearTokens();
      this.onUnauthorized?.();
    }

    return this.parseResponse<T>(response);
  }

  private async parseResponse<T>(response: Response): Promise<{ data: T; meta?: { duplicate?: boolean } }> {
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const err = (payload as { error?: { message?: string; code?: string; details?: Record<string, string> } })?.error;
      throw new ApiError(
        response.status,
        err?.message ?? `Server xətası (${response.status}).`,
        err?.code ?? 'ERROR',
        err?.details,
      );
    }

    const envelope = payload as ApiEnvelope<T>;
    return { data: envelope.data, meta: envelope.meta };
  }

  /** Rotating refresh. Concurrent callers share one in-flight request. */
  private async refreshTokens(): Promise<boolean> {
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = (async () => {
      try {
        const tokens = await loadTokens();
        if (!tokens?.refreshToken) return false;

        const response = await fetch(`${this.baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ refreshToken: tokens.refreshToken }),
        });

        if (!response.ok) return false;

        const body = (await response.json()) as ApiEnvelope<{
          user: unknown;
          tokens: { accessToken: string; refreshToken: string; expiresIn: string };
        }>;

        await saveTokens({
          accessToken: body.data.tokens.accessToken,
          refreshToken: body.data.tokens.refreshToken,
        });
        return true;
      } catch {
        return false;
      } finally {
        this.refreshInFlight = null;
      }
    })();

    return this.refreshInFlight;
  }

  // ----------------------------- verbs -------------------------------------

  get<T>(path: string, params?: Record<string, unknown>): Promise<{ data: T }> {
    return this.request<T>('GET', withQuery(path, params));
  }

  post<T>(path: string, body?: unknown, opts?: { auth?: boolean }): Promise<{ data: T; meta?: { duplicate?: boolean } }> {
    return this.request<T>('POST', path, body, opts);
  }

  patch<T>(path: string, body?: unknown): Promise<{ data: T }> {
    return this.request<T>('PATCH', path, body);
  }

  delete<T>(path: string): Promise<{ data: T }> {
    return this.request<T>('DELETE', path);
  }

  /** Auth endpoints must not send a stale bearer token. */
  postPublic<T>(path: string, body?: unknown): Promise<{ data: T }> {
    return this.request<T>('POST', path, body, { auth: false });
  }
}

/** Builds a query string, dropping empty values and expanding arrays. */
export function withQuery(path: string, params?: Record<string, unknown>): string {
  if (!params) return path;
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item));
    } else {
      search.append(key, String(value));
    }
  }

  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

export const apiClient = new ApiClient();
