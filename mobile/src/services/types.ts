import type {
  AdminDashboard,
  AppSettings,
  AuditLogEntry,
  Customer,
  CustomerDetail,
  DateRangePreset,
  DebtAdjustmentType,
  DebtSummaryRow,
  Delivery,
  DeliveryDetail,
  DeliveryStatus,
  InventorySummary,
  InventoryTransaction,
  InventoryTxType,
  Paginated,
  PaginatedAmounts,
  Payment,
  PaymentMethod,
  Report,
  RevenueBreakdown,
  User,
  WorkerDashboard,
  WorkerStats,
} from '../types';

/**
 * Base API host.
 *
 * IMPORTANT: `localhost` refers to the phone itself, not your computer. Use:
 *   - Android emulator  -> http://10.0.2.2:4000/api/v1
 *   - Real device (Wi-Fi)-> http://<your-computer-LAN-IP>:4000/api/v1
 *   - Production        -> https://your-domain.com/api/v1
 * See README.md ("Server ünvanını dəyişmək").
 */
export const API_BASE_URL = 'https://farah-water.vercel.app/api/v1';

export interface ApiEnvelope<T> {
  data: T;
  meta?: { duplicate?: boolean };
}

/**
 * Base64 encoder for binary payloads (used to share exported PDFs).
 * React Native's Hermes runtime provides `btoa` but it is not in the TS DOM
 * lib, so we declare it and keep a pure-JS fallback for safety.
 */
export function base64Encode(bytes: Uint8Array): string {
  const g = globalThis as unknown as { btoa?: (s: string) => string };
  if (typeof g.btoa === 'function') return g.btoa(binaryStringFrom(bytes));

  // Pure-JS fallback (no dependency on a host implementation).
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : alphabet[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : alphabet[b2 & 0x3f];
  }
  return out;
}

function binaryStringFrom(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return out;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code: string = 'ERROR',
    public readonly details?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when retrying later could plausibly succeed (offline queue). */
  get isRetryable(): boolean {
    return this.status === 0 || this.status >= 500 || this.status === 429;
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }
}

// ------------------------------- auth -------------------------------------

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: string;
}

export interface AuthResult {
  user: User;
  tokens: AuthTokens;
}

// ------------------------------ payloads ----------------------------------

export interface CreateDeliveryPayload {
  /** Client-generated UUID. Makes the request idempotent (offline replay safe). */
  idempotencyKey: string;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  address: string;
  contactPhone?: string;
  bottleCount: number;
  unitPrice: string;
  paidAmount?: string;
  paymentMethod?: PaymentMethod;
  workerId?: string;
  deliveredAt?: string;
  note?: string;
}

export interface CreatePaymentPayload {
  idempotencyKey: string;
  deliveryId: string;
  amount: string;
  method?: PaymentMethod;
  paidAt?: string;
  note?: string;
}

export interface ListDeliveriesParams {
  workerId?: string;
  customerId?: string;
  status?: DeliveryStatus;
  search?: string;
  preset?: DateRangePreset;
  from?: string;
  to?: string;
  onlyDebts?: boolean;
  page?: number;
  pageSize?: number;
  sortBy?: 'deliveredAt' | 'totalAmount' | 'debtAmount' | 'bottleCount';
  sortDir?: 'asc' | 'desc';
}

export interface ListPaymentsParams {
  deliveryId?: string;
  workerId?: string;
  customerId?: string;
  method?: PaymentMethod;
  preset?: DateRangePreset;
  from?: string;
  to?: string;
  search?: string;
  includeVoided?: boolean;
  page?: number;
  pageSize?: number;
}

export interface ListCustomersParams {
  search?: string;
  onlyDebtors?: boolean;
  preset?: DateRangePreset;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateWorkerPayload {
  fullName: string;
  username: string;
  phone?: string;
  email?: string;
  password?: string;
}

export interface CreateCustomerPayload {
  name: string;
  address: string;
  phone?: string;
  note?: string;
}

export interface StockMovementPayload {
  bottleCount: number;
  note?: string;
  idempotencyKey?: string;
}

export interface CreateAdjustmentPayload {
  deliveryId: string;
  type: DebtAdjustmentType;
  amount: string;
  reason: string;
}

export interface RangeParams {
  preset?: DateRangePreset;
  from?: string;
  to?: string;
}

export interface ReportParams extends RangeParams {
  type: 'daily' | 'period' | 'worker' | 'customer' | 'inventory' | 'payments' | 'deliveries';
  workerId?: string;
  customerId?: string;
  format?: 'json' | 'csv' | 'pdf';
}

export interface ListInventoryParams {
  type?: InventoryTxType;
  workerId?: string;
  deliveryId?: string;
  preset?: DateRangePreset;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

// ------------------------------ API surface --------------------------------

/** Shape of the backend's route table, used to build the typed client. */
export interface ApiSurface {
  login: { POST: [AuthResult] };
  refresh: { POST: [AuthResult] };
  logout: { POST: [{ success: boolean }] };
  me: { GET: [User] };
  changePassword: { POST: [{ success: boolean }] };
  updateProfile: { PATCH: [User] };

  dashboardWorker: { GET: [WorkerDashboard] };
  dashboardAdmin: { GET: [AdminDashboard] };
  revenue: { GET: [RevenueBreakdown] };

  workersList: { GET: [Paginated<User>] };
  workersStats: { GET: [WorkerStats[]] };
  workerCreate: { POST: [{ user: User; temporaryPassword?: string }] };
  workerUpdate: { PATCH: [User] };
  workerReset: { POST: [{ temporaryPassword: string }] };
  workerDetail: { GET: [User & { stockInHand: number; outstandingDebt: number }] };

  customersList: { GET: [Paginated<Customer>] };
  customerCreate: { POST: [{ customer: Customer; created: boolean }] };
  customerDetail: { GET: [CustomerDetail] };
  customerUpdate: { PATCH: [Customer] };

  deliveriesList: { GET: [Paginated<Delivery>] };
  deliveryCreate: { POST: [Delivery] };
  deliveryDetail: { GET: [DeliveryDetail] };
  deliveryUpdate: { PATCH: [Delivery] };
  deliveryCancel: { POST: [Delivery] };

  paymentsList: { GET: [PaginatedAmounts<Payment>] };
  paymentCreate: { POST: [Payment] };
  paymentHistory: { GET: [Payment[]] };
  paymentVoid: { POST: [Payment] };

  debtsList: { GET: [PaginatedAmounts<Delivery> & { totalDebt: number }] };
  debtsSummary: { GET: [DebtSummaryRow[]] };
  adjustmentsCreate: { POST: [DebtAdjustmentType] };

  inventorySummary: { GET: [InventorySummary] };
  myStock: { GET: [{ quantity: number; updatedAt: string | null }] };
  inventoryTransactions: { GET: [Paginated<InventoryTransaction>] };
  stockIn: { POST: [{ transactionId: string; duplicate: boolean; newBalance: number }] };
  issue: { POST: [{ transactionId: string; duplicate: boolean; newBalance: number }] };
  returnStock: { POST: [{ transactionId: string; duplicate: boolean; newBalance: number }] };
  writeOff: { POST: [{ transactionId: string; duplicate: boolean; newBalance: number }] };

  reports: { GET: [Report] };
  auditLogs: { GET: [Paginated<AuditLogEntry>] };
  settings: { GET: [AppSettings] };
  settingsUpdate: { PATCH: [AppSettings] };
}

export type ReportType = ReportParams['type'];
