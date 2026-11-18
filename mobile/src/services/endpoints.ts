import { apiClient } from './api';
import { clearTokens } from './secureStorage';
import { base64Encode } from './types';
import type {
  CreateAdjustmentPayload,
  CreateCustomerPayload,
  CreateDeliveryPayload,
  CreateDepositPayload,
  CreateExpensePayload,
  CreatePaymentPayload,
  CreateWorkerPayload,
  ListCustomersParams,
  ListDeliveriesParams,
  ListInventoryParams,
  ListPaymentsParams,
  RangeParams,
  ReportParams,
  StockMovementPayload,
} from './types';
import type {
  AdminDashboard,
  AppSettings,
  AuditLogEntry,
  Company,
  Customer,
  CustomerDeposit,
  CustomerDetail,
  DateRangePreset,
  DebtSummaryRow,
  Delivery,
  DeliveryDetail,
  DeliveryStatus,
  Expense,
  ExpenseCategory,
  InventorySummary,
  InventoryTransaction,
  MyStock,
  Paginated,
  PaginatedAmounts,
  Payment,
  PriceChangeRequest,
  PriceHistoryEntry,
  PriceRequestStatus,
  Report,
  RevenueBreakdown,
  User,
  WaterPrice,
  WaterType,
  WorkerDashboard,
  WorkerStats,
  WorkerType,
} from '../types';

export interface CreatedWorker {
  user: User;
  temporaryPassword?: string;
}

// ---------------------------------- auth -----------------------------------

export const authApi = {
  async login(identifier: string, password: string) {
    const { data } = await apiClient.postPublic<{ user: User; tokens: { accessToken: string; refreshToken: string } }>(
      '/auth/login',
      { identifier, password },
    );
    return data;
  },

  async logout(refreshToken?: string) {
    try {
      await apiClient.post('/auth/logout', refreshToken ? { refreshToken } : {});
    } finally {
      // Local state is cleared regardless, so a failed request cannot strand
      // the user in a half-logged-in state.
      await clearTokens();
    }
  },

  me: () => apiClient.get<User>('/auth/me'),

  changePassword: (currentPassword: string, newPassword: string) =>
    apiClient.post<{ success: boolean }>('/auth/change-password', { currentPassword, newPassword }),

  updateProfile: (patch: { fullName?: string; phone?: string | null; email?: string | null }) =>
    apiClient.patch<User>('/users/me', patch),
};

// ------------------------------- dashboard ---------------------------------

export const dashboardApi = {
  worker: () => apiClient.get<WorkerDashboard>('/dashboard/worker'),
  admin: (params: RangeParams) => apiClient.get<AdminDashboard>('/dashboard/admin', params as Record<string, unknown>),
  revenue: (params: RangeParams) => apiClient.get<RevenueBreakdown>('/dashboard/revenue', params as Record<string, unknown>),
};

// --------------------------------- users -----------------------------------

export const usersApi = {
  list: (params: { search?: string; isActive?: boolean; page?: number; pageSize?: number }) =>
    apiClient.get<Paginated<User>>('/users', params as Record<string, unknown>),
  stats: () => apiClient.get<WorkerStats[]>('/users/stats'),
  create: (payload: CreateWorkerPayload) => apiClient.post<CreatedWorker>('/users', payload),
  update: (
    id: string,
    patch: {
      fullName?: string;
      phone?: string | null;
      email?: string | null;
      isActive?: boolean;
      workerType?: WorkerType;
    },
  ) => apiClient.patch<User>(`/users/${id}`, patch),
  resetPassword: (id: string) => apiClient.post<{ temporaryPassword: string }>(`/users/${id}/reset-password`),
  detail: (id: string) => apiClient.get<User & { stockInHand: number; outstandingDebt: number }>(`/users/${id}`),
};

// ------------------------------- customers ---------------------------------

export const customersApi = {
  list: (params: ListCustomersParams) => apiClient.get<Paginated<Customer>>('/customers', params as Record<string, unknown>),
  create: (payload: CreateCustomerPayload) =>
    apiClient.post<{ customer: Customer; created: boolean }>('/customers', payload),
  detail: (id: string) => apiClient.get<CustomerDetail>(`/customers/${id}`),
  update: (id: string, patch: { phone?: string | null; note?: string | null; isActive?: boolean }) =>
    apiClient.patch<Customer>(`/customers/${id}`, patch),
};

// ------------------------------- deliveries --------------------------------

export const deliveriesApi = {
  list: (params: ListDeliveriesParams) =>
    apiClient.get<Paginated<Delivery>>('/deliveries', params as Record<string, unknown>),
  create: (payload: CreateDeliveryPayload) =>
    apiClient.post<Delivery>('/deliveries', payload),
  detail: (id: string) => apiClient.get<DeliveryDetail>(`/deliveries/${id}`),
  update: (
    id: string,
    patch: {
      address?: string;
      note?: string;
      bottleCount?: number;
      unitPrice?: string;
      /** Admin-only: state what was actually collected. */
      paidAmount?: string;
      reason: string;
    },
  ) => apiClient.patch<Delivery>(`/deliveries/${id}`, patch),
  cancel: (id: string, reason: string) => apiClient.post<Delivery>(`/deliveries/${id}/cancel`, { reason }),
};

// ------------------------------- companies ---------------------------------

export const companiesApi = {
  list: () => apiClient.get<Company[]>('/companies'),
};

// -------------------------------- payments ---------------------------------

export const paymentsApi = {
  list: (params: ListPaymentsParams) =>
    apiClient.get<PaginatedAmounts<Payment>>('/payments', params as Record<string, unknown>),
  create: (payload: CreatePaymentPayload) => apiClient.post<Payment>('/payments', payload),
  historyForDelivery: (deliveryId: string) => apiClient.get<Payment[]>(`/payments/delivery/${deliveryId}`),
  void: (id: string, reason: string) => apiClient.post<Payment>(`/payments/${id}/void`, { reason }),
};

// ---------------------------------- debts ----------------------------------

export const debtsApi = {
  list: (params: ListDeliveriesParams) => apiClient.get<Paginated<Delivery> & { totalDebt: number }>('/debts', params as Record<string, unknown>),
  summary: (params: ListDeliveriesParams) =>
    apiClient.get<DebtSummaryRow[]>('/debts/summary', params as Record<string, unknown>),
  createAdjustment: (payload: CreateAdjustmentPayload) => apiClient.post('/debts/adjustments', payload),
  adjustmentsForDelivery: (deliveryId: string) =>
    apiClient.get(`/debts/delivery/${deliveryId}/adjustments`),
};

// -------------------------------- inventory --------------------------------

export interface StockResult {
  transactionId: string;
  duplicate: boolean;
  newBalance: number;
}

export const inventoryApi = {
  summary: () => apiClient.get<InventorySummary>('/inventory/summary'),
  myStock: () => apiClient.get<MyStock>('/inventory/my-stock'),
  transactions: (params: ListInventoryParams) =>
    apiClient.get<Paginated<InventoryTransaction>>('/inventory/transactions', params as Record<string, unknown>),
  stockIn: (payload: StockMovementPayload) => apiClient.post<StockResult>('/inventory/stock-in', payload),
  /**
   * Takes bottles out of the warehouse into the caller's own hands. Keeper only:
   * a regular worker receives stock from the anbardar through `distribute`.
   */
  takeFromWarehouse: (payload: StockMovementPayload) => apiClient.post<StockResult>('/inventory/issue', payload),
  returnStock: (payload: StockMovementPayload) =>
    apiClient.post<StockResult>('/inventory/return', payload),
  /** Anbardar handover: warehouse -> named worker, in one transaction. */
  distribute: (payload: StockMovementPayload & { workerId: string }) =>
    apiClient.post<StockResult>('/inventory/distribute', payload),
  writeOff: (payload: StockMovementPayload & { type: 'DAMAGE' | 'LOSS'; note: string }) =>
    apiClient.post<StockResult>('/inventory/write-off', payload),
  /** Write-off taken directly out of the warehouse, with a mandatory reason. */
  warehouseWriteOff: (payload: StockMovementPayload & { type: 'DAMAGE' | 'LOSS'; note: string }) =>
    apiClient.post<StockResult>('/inventory/warehouse-write-off', payload),
};

// -------------------------------- deposits ---------------------------------

export const depositsApi = {
  list: (params: {
    customerId?: string;
    type?: 'DEPOSIT_IN' | 'DEPOSIT_OUT' | 'ADJUSTMENT';
    preset?: DateRangePreset;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }) =>
    apiClient.get<Paginated<CustomerDeposit> & { totals: { amount: number; bottleCount: number } }>(
      '/deposits',
      params as Record<string, unknown>,
    ),
  summary: (customerId: string) =>
    apiClient.get<{ balance: number; bottleBalance: number; movements: number; lastMovementAt: string | null }>(
      `/deposits/summary/${customerId}`,
    ),
  create: (payload: CreateDepositPayload) =>
    apiClient.post<{ deposit: CustomerDeposit; duplicate: boolean; balance: number; bottleBalance: number }>(
      '/deposits',
      payload,
    ),
};

// --------------------------------- prices ----------------------------------

export const pricesApi = {
  /** Both sale prices; readable by every role. */
  list: () => apiClient.get<WaterPrice[]>('/prices'),
  /** Admin-only direct change. */
  set: (waterType: WaterType, price: string, note?: string) =>
    apiClient.put<{ changed: boolean; waterType: WaterType; price: number; oldPrice: number }>(
      `/prices/${waterType}`,
      { price, note },
    ),
  /** Worker asks; nothing changes until an admin approves. */
  request: (waterType: WaterType, newPrice: string, reason: string) =>
    apiClient.post<PriceChangeRequest>('/prices/requests', { waterType, newPrice, reason }),
  requests: (params: { status?: PriceRequestStatus; waterType?: WaterType; page?: number; pageSize?: number }) =>
    apiClient.get<Paginated<PriceChangeRequest>>('/prices/requests', params as Record<string, unknown>),
  review: (id: string, action: 'APPROVE' | 'REJECT', note?: string) =>
    apiClient.patch<{ request: PriceChangeRequest; historyId: string | null; price: number | null }>(
      `/prices/requests/${id}`,
      { action, note },
    ),
  history: (params: { waterType?: WaterType; page?: number; pageSize?: number }) =>
    apiClient.get<Paginated<PriceHistoryEntry>>('/prices/history', params as Record<string, unknown>),
};

// -------------------------------- expenses ---------------------------------

export const expensesApi = {
  list: (params: {
    category?: ExpenseCategory;
    waterType?: WaterType;
    from?: string;
    to?: string;
    includeVoided?: boolean;
    page?: number;
    pageSize?: number;
  }) => apiClient.get<Paginated<Expense> & { totalAmount: number }>('/expenses', params as Record<string, unknown>),
  create: (payload: CreateExpensePayload) =>
    apiClient.post<{ expense: Expense; duplicate: boolean }>('/expenses', payload),
  void: (id: string, reason: string) => apiClient.post<Expense>(`/expenses/${id}/void`, { reason }),
};

// --------------------------------- reports ---------------------------------

export type ReportFormat = 'csv' | 'pdf' | 'xlsx' | 'xls';

export const reportsApi = {
  json: (params: ReportParams) =>
    apiClient.get<Report>('/reports', { ...params, format: 'json' } as Record<string, unknown>),

  /**
   * The dedicated monthly report. `month` is "YYYY-MM", "last", or omitted for
   * the current month. Kept as a separate endpoint so the phone and the web
   * resolve "this month" identically instead of each building a date range.
   */
  monthly: (params: { month?: string; format?: string }) =>
    apiClient.get<Report>('/reports/monthly', params as Record<string, unknown>),

  /** Same idea for a whole year. `year` is "YYYY", "last", or omitted for now. */
  yearly: (params: { year?: string; format?: string }) =>
    apiClient.get<Report>('/reports/yearly', params as Record<string, unknown>),

  /**
   * Fetches a CSV/PDF/XLSX export.
   * The endpoint returns the file with Content-Disposition; we surface the raw
   * body so the caller can save/share it. `monthly`/`yearly` pick the dedicated
   * endpoints, which carry their own month/year instead of a type + range.
   *
   * The parameter type is deliberately loose: the three request shapes really
   * are different, and a union here would only push the checking onto every
   * call site without catching a mistake the server would not catch anyway.
   */
  async raw(
    params: Omit<ReportParams, 'type'> & {
      format: ReportFormat;
      /** Present for /reports, absent for the monthly/yearly endpoints. */
      type?: ReportParams['type'];
      month?: string;
      year?: string;
      monthly?: boolean;
      yearly?: boolean;
    },
  ): Promise<{ body: string; base64: boolean; filename: string }> {
    const { withQuery } = await import('./api');
    const tokens = await (await import('./secureStorage')).loadTokens();
    const path = params.yearly ? '/reports/yearly' : params.monthly ? '/reports/monthly' : '/reports';
    const url = `${apiClient.getBaseUrl()}${path}${withQuery('', params as unknown as Record<string, unknown>)}`;

    const accept =
      params.format === 'pdf'
        ? 'application/pdf'
        : params.format === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : params.format === 'xls'
            ? 'application/vnd.ms-excel'
            : 'text/csv';

    const response = await fetch(url, {
      headers: {
        Accept: accept,
        ...(tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {}),
      },
    });

    if (!response.ok) {
      const text = await response.text();
      let message = `Yükləmə mümkün olmadı (${response.status}).`;
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string } };
        message = parsed.error?.message ?? message;
      } catch {
        /* keep default */
      }
      throw new Error(message);
    }

    const disposition = response.headers.get('Content-Disposition') ?? '';
    const filenameMatch = /filename="?([^"]+)"?/.exec(disposition);
    // Force the extension the caller asked for: the server slugifies titles, so
    // the returned name can carry the wrong suffix and the user would end up
    // with a file Excel will not open.
    const baseName = (filenameMatch?.[1] ?? `farah-report`).replace(/\.[a-z0-9]+$/i, '');
    const filename = `${baseName}.${params.format}`;

    if (params.format === 'csv') {
      return { body: await response.text(), base64: false, filename };
    }

    // PDF and XLSX are binary: base64-encode so they survive the string-only
    // share sheet.
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    return { body: base64Encode(bytes), base64: true, filename };
  },
};

// ------------------------------ audit/settings -----------------------------

export const auditApi = {
  logs: (params: { actorId?: string; action?: string; entityType?: string; page?: number; pageSize?: number }) =>
    apiClient.get<Paginated<AuditLogEntry>>('/audit/logs', params as Record<string, unknown>),
};

export const settingsApi = {
  get: () => apiClient.get<AppSettings>('/audit/settings'),
  update: (patch: Partial<AppSettings>) => apiClient.patch<AppSettings>('/audit/settings', patch),
};

export type { DeliveryStatus };
