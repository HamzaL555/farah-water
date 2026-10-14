import type { DeliveryStatus, PaymentMethod, InventoryTxType, DebtAdjustmentType } from '../types';

export const AZN = 'AZN';

/** Formats a money amount for display: 1234.5 -> "1 234,50" */
export function formatMoney(value: number | null | undefined, currency = AZN): string {
  const n = Number(value ?? 0);
  const fixed = n.toFixed(2);
  const [intPart, decPart] = fixed.split('.');
  // Azerbaijani locale uses a comma as the decimal separator and a space for
  // thousands grouping.
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${grouped},${decPart} ${currency}`;
}

/** Compact money for tight stat cards: 12345 -> "12,3 min" */
export function formatMoneyShort(value: number | null | undefined, currency = AZN): string {
  const n = Number(value ?? 0);
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} mln ${currency}`;
  if (Math.abs(n) >= 10_000) return `${(n / 1000).toFixed(1)} min ${currency}`;
  return formatMoney(n, currency);
}

/**
 * Baku local time (UTC+4), which has no daylight saving.
 *
 * The offset is applied to the instant and the UTC parts are read from the
 * result. A driver whose phone clock is set to UTC - or to any other zone -
 * still sees the time the delivery was actually recorded at, which is the only
 * time worth showing. The server formats its exports the same way.
 */
const BAKU_OFFSET_MS = 4 * 3600 * 1000;

function baku(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + BAKU_OFFSET_MS);
}

/** Formats an ISO timestamp as DD.MM.YYYY, Baku local time. */
export function formatDate(iso: string | null | undefined): string {
  const b = baku(iso);
  if (!b) return '-';
  const dd = String(b.getUTCDate()).padStart(2, '0');
  const mm = String(b.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${b.getUTCFullYear()}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  const b = baku(iso);
  if (!b) return '-';
  const hh = String(b.getUTCHours()).padStart(2, '0');
  const mm = String(b.getUTCMinutes()).padStart(2, '0');
  return `${formatDate(iso)} ${hh}:${mm}`;
}

/** Today as YYYY-MM-DD on the Baku calendar day (for date inputs). */
export function todayInputValue(): string {
  return new Date(Date.now() + BAKU_OFFSET_MS).toISOString().slice(0, 10);
}

const DAY_NAMES = [
  'Bazar',
  'Bazar ertəsi',
  'Çərşənbə axşamı',
  'Çərşənbə',
  'Cümə axşamı',
  'Cümə',
  'Şənbə',
];

/**
 * YYYY-MM-DD for the Baku day `days` away from today (0 = today, -1 = yesterday).
 *
 * Whole-day arithmetic on a timestamp already shifted into Baku is safe because
 * every Baku day is exactly 24h long - the offset has no daylight saving - so
 * stepping 86400000ms moves exactly one calendar day.
 */
export function dayOffsetIso(days: number): string {
  return new Date(Date.now() + BAKU_OFFSET_MS + days * 86_400_000).toISOString().slice(0, 10);
}

/** "Bu gün" / "Dünən" / the weekday, whichever reads best for that day. */
export function dayRelativeName(iso: string): string {
  if (iso === dayOffsetIso(0)) return 'Bu gün';
  if (iso === dayOffsetIso(-1)) return 'Dünən';
  return DAY_NAMES[new Date(`${iso}T00:00:00Z`).getUTCDay()] ?? iso;
}

/**
 * The days a delivery may be dated to, newest first.
 *
 * A delivery is recorded the day it happens, so today is the answer nearly
 * every time. The two days before it are there for the case that actually
 * happens: a driver finishes a round late, or the phone was out of credit.
 * Typing a date is what this replaces - the old field wanted YYYY-MM-DD by
 * hand, which is a four-finger exercise to get a value you already knew.
 */
export function recentDeliveryDates(): string[] {
  return [dayOffsetIso(0), dayOffsetIso(-1), dayOffsetIso(-2)];
}

export const STATUS_LABEL: Record<DeliveryStatus, string> = {
  UNPAID: 'Borc',
  PARTIAL: 'Qismən ödənilib',
  PAID: 'Ödənilib',
  CANCELLED: 'Ləğv edilib',
};

export const STATUS_COLOR: Record<DeliveryStatus, string> = {
  UNPAID: '#C62828',
  PARTIAL: '#EF6C00',
  PAID: '#2E7D32',
  CANCELLED: '#757575',
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: 'Nağd',
  CARD: 'Kart',
  TRANSFER: 'Köçürmə',
  OTHER: 'Digər',
};

export const INVENTORY_TYPE_LABEL: Record<InventoryTxType, string> = {
  INBOUND: 'Anbara daxil',
  // The worker takes stock for themselves out of the warehouse; nobody hands
  // it to them.
  ISSUE_TO_WORKER: 'Anbardan götürdü',
  OUT_DELIVERY: 'Çatdırılma',
  RETURN_TO_STOCK: 'Anbara qaytarıldı',
  DAMAGE: 'Zədələnmiş',
  LOSS: 'İtmiş',
  CORRECTION: 'Düzəliş',
};

export const ADJUSTMENT_LABEL: Record<DebtAdjustmentType, string> = {
  FORGIVE: 'Güzəşti',
  DECREASE: 'Azaldıldı',
  INCREASE: 'Artırıldı',
};

/**
 * Money input helper: two-decimal string, comma-tolerant.
 *
 * The client only DISPLAYS money and pre-fills the form; the server is the
 * authority for every calculation, so we deliberately avoid float maths here.
 */
export function normalizeMoneyInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.,]/g, '').replace(/,/g, '.');
  const parts = cleaned.split('.');
  if (parts.length === 1) return parts[0];
  return `${parts[0]}.${parts.slice(1).join('').slice(0, 2)}`;
}

/** Parses a user-entered amount to a number for local display only. */
export function parseMoneyInput(raw: string): number {
  const normalized = normalizeMoneyInput(raw);
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

export function pluralizeBottles(count: number): string {
  return `${count} bidon`;
}
