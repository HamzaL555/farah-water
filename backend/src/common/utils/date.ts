/**
 * Date helpers.
 *
 * The company operates on Azerbaijan local time. The server resolves "today",
 * "this month", "last 7 days" etc. into half-open UTC instants [start, end)
 * anchored to a configurable timezone offset, so an admin in Baku and a worker
 * in Ganja see the same business day.
 */

export const DEFAULT_TZ_OFFSET_MINUTES = 240; // Azerbaijan (UTC+4), no DST

export function tzOffsetMinutes(): number {
  const raw = process.env.TZ_OFFSET_MINUTES;
  if (!raw) return DEFAULT_TZ_OFFSET_MINUTES;
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_TZ_OFFSET_MINUTES;
}

function offsetMs(): number {
  return tzOffsetMinutes() * 60_000;
}

/** Shifts a UTC instant into "wall clock" fields of the configured zone. */
function toLocalParts(date: Date): { y: number; m: number; d: number } {
  const local = new Date(date.getTime() + offsetMs());
  return { y: local.getUTCFullYear(), m: local.getUTCMonth(), d: local.getUTCDate() };
}

/** Converts local wall-clock fields back to the corresponding UTC instant. */
function fromLocalParts(y: number, m: number, d: number, endOfDay = false): Date {
  const dayMs = endOfDay ? 86_400_000 - 1 : 0;
  return new Date(Date.UTC(y, m, d) - offsetMs() + dayMs);
}

/** UTC instant corresponding to local midnight of the given instant's day. */
export function startOfLocalDay(date: Date = new Date()): Date {
  const { y, m, d } = toLocalParts(date);
  return fromLocalParts(y, m, d);
}

export function endOfLocalDay(date: Date = new Date()): Date {
  const { y, m, d } = toLocalParts(date);
  // Half-open boundary: the first instant of the NEXT local day.
  return fromLocalParts(y, m, d + 1);
}

export function startOfLocalMonth(date: Date = new Date()): Date {
  const { y, m } = toLocalParts(date);
  return fromLocalParts(y, m, 1);
}

/** First instant of the first day of the next local month. */
export function endOfLocalMonth(date: Date = new Date()): Date {
  const { y, m } = toLocalParts(date);
  return fromLocalParts(y, m + 1, 1);
}

export function startOfLocalYear(date: Date = new Date()): Date {
  const { y } = toLocalParts(date);
  return fromLocalParts(y, 0, 1);
}

/** First instant of 1 January of the next local year. */
export function endOfLocalYear(date: Date = new Date()): Date {
  const { y } = toLocalParts(date);
  return fromLocalParts(y + 1, 0, 1);
}

/**
 * Formats a date as DD.MM.YYYY - the display format required by the spec.
 * Uses the configured local zone so a delivery made late at night is not
 * displayed under the wrong day.
 */
export function formatDDMMYYYY(value: Date | string | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const { y, m, d: day } = toLocalParts(d);
  return `${String(day).padStart(2, '0')}.${String(m + 1).padStart(2, '0')}.${y}`;
}

export type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'last7days'
  | 'last30days'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'all';

/**
 * Parses a client-supplied date into a UTC instant.
 *
 * A date-only string ("2026-06-15") is interpreted as that day in the company's
 * local timezone, not as UTC midnight, so a worker picking today's date in Baku
 * never records yesterday. Full ISO instants are used as-is.
 */
export function parseLocalDateInput(value: string): Date {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid date');
  return dateOnly ? startOfLocalDay(parsed) : parsed;
}

/** Shifts a date by whole days, keeping the local wall-clock day intact. */
function shiftLocalDays(date: Date, days: number): Date {
  const { y, m, d } = toLocalParts(date);
  return fromLocalParts(y, m, d + days);
}

/** Resolves a preset (or an explicit from/to pair) into a half-open UTC range. */
export function resolveRange(
  preset: DateRangePreset | undefined,
  from?: Date | null,
  to?: Date | null,
): { start: Date | null; end: Date | null } {
  const now = new Date();

  switch (preset) {
    case 'today':
      return { start: startOfLocalDay(now), end: endOfLocalDay(now) };
    case 'yesterday': {
      const y = shiftLocalDays(now, -1);
      return { start: startOfLocalDay(y), end: endOfLocalDay(y) };
    }
    case 'last7days':
      return { start: startOfLocalDay(shiftLocalDays(now, -6)), end: endOfLocalDay(now) };
    case 'last30days':
      return { start: startOfLocalDay(shiftLocalDays(now, -29)), end: endOfLocalDay(now) };
    case 'thisMonth':
      return { start: startOfLocalMonth(now), end: endOfLocalMonth(now) };
    case 'lastMonth': {
      const { y, m } = toLocalParts(startOfLocalMonth(now));
      const prevMonthStart = fromLocalParts(y, m - 1, 1);
      return { start: prevMonthStart, end: startOfLocalMonth(now) };
    }
    case 'thisYear':
      return { start: startOfLocalYear(now), end: endOfLocalYear(now) };
    case 'all':
      break;
    default:
      break;
  }

  if (from || to) {
    // An explicit `from`/`to` pair always denotes whole local days, and `to` is
    // inclusive: the range ends at the start of the following local day. This
    // keeps behaviour predictable regardless of the time component supplied.
    return {
      start: from ? startOfLocalDay(from) : null,
      end: to ? endOfLocalDay(to) : null,
    };
  }

  return { start: null, end: null };
}
