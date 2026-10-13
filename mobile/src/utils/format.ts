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

/** Formats an ISO timestamp as DD.MM.YYYY. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${formatDate(iso)} ${hh}:${mm}`;
}

/** Today as YYYY-MM-DD in the device's local timezone (for date inputs). */
export function todayInputValue(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
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
