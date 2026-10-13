import { z } from 'zod';
import {
  DeliveryStatus,
  InventoryTxType,
  PaymentMethod,
  DebtAdjustmentType,
  WaterType,
  DestinationType,
} from '@prisma/client';
import { strongPassword } from '../auth/auth.schemas';

// Numeric inputs arrive as strings from query params, so coerce then bound them.
const intFromQuery = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).optional();

const dateFromQuery = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Tarix YYYY-AA-GG formatında olmalıdır.')
  .optional();

export const rangePreset = z
  .enum(['today', 'yesterday', 'last7days', 'last30days', 'thisMonth', 'lastMonth', 'thisYear', 'all'])
  .optional();

// ------------------------------ deliveries --------------------------------

export const createDeliverySchema = z
  .object({
    idempotencyKey: z.string().min(8).max(100),
    customerId: z.string().uuid().optional(),
    customerName: z.string().trim().max(150).optional(),
    customerPhone: z.string().trim().max(30).optional(),
    address: z.string().trim().max(400).optional(),
    contactPhone: z.string().trim().max(30).optional(),

    // Su: which water. Hara: where it went. These two replace the old flat
    // "address + price" form, where a driver typed both and the two could not
    // be checked against each other.
    waterType: z.nativeEnum(WaterType).default(WaterType.FILTERED),
    destinationType: z.nativeEnum(DestinationType).default(DestinationType.HOME),
    companyId: z.string().uuid().optional(),
    officeId: z.string().uuid().optional(),

    bottleCount: z.coerce.number().int().min(1, 'Bidon sayı ən azı 1 olmalıdır.').max(10000),
    workerId: z.string().uuid().optional(),
    deliveredAt: z
      .string()
      .refine((v) => !Number.isNaN(Date.parse(v)), 'Çatdırılma tarixi düzgün deyil.')
      .optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((d) => d.customerId || (d.customerName && d.customerName.length >= 2), {
    message: 'Müştəri seçilməlidir və ya müştərinin adı yazılmalıdır.',
    path: ['customerName'],
  })
  .refine(
    (d) => d.destinationType !== DestinationType.COMPANY || (d.companyId && d.officeId),
    {
      message: 'Şirkətə çatdırılmada şirkət və ofis seçilməlidir.',
      path: ['officeId'],
    },
  )
  .refine(
    (d) => d.destinationType !== DestinationType.HOME || (d.address && d.address.length >= 3),
    {
      message: 'Evə çatdırılmada ünvan ən azı 3 simvol olmalıdır.',
      path: ['address'],
    },
  );
// NOTE: `unitPrice` and `paidAmount` are deliberately absent. A worker records
// what they delivered; the admin sets the price and the money collected. The
// service derives the price server-side, so a client that sends one anyway is
// rejected by zod's default "unknown keys are stripped" behaviour instead of
// being quietly trusted.

export const listDeliveriesSchema = z.object({
  workerId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  status: z.nativeEnum(DeliveryStatus).optional(),
  waterType: z.nativeEnum(WaterType).optional(),
  destinationType: z.nativeEnum(DestinationType).optional(),
  companyId: z.string().uuid().optional(),
  officeId: z.string().uuid().optional(),
  search: z.string().trim().max(120).optional(),
  preset: rangePreset,
  from: dateFromQuery,
  to: dateFromQuery,
  onlyDebts: z.coerce.boolean().optional(),
  page: intFromQuery(1, 100000),
  pageSize: intFromQuery(1, 100),
  sortBy: z.enum(['deliveredAt', 'totalAmount', 'debtAmount', 'bottleCount']).optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
});

export const updateDeliverySchema = z.object({
  address: z.string().trim().min(3).max(400).optional(),
  note: z.string().trim().max(1000).optional(),
  bottleCount: z.coerce.number().int().min(1).max(10000).optional(),
  unitPrice: z.union([z.coerce.number().min(0).max(1_000_000), z.string().regex(/^\d+(\.\d{1,2})?$/)]).optional(),
  /**
   * The money actually collected, stated directly by the admin. Optional: leave
   * it out and only the price is corrected. This is deliberately NOT a status
   * field - "ödenilib" is always recomputed from the payment ledger, so it can
   * never drift from the money that genuinely arrived.
   */
  paidAmount: z.union([z.coerce.number().min(0).max(1_000_000), z.string().regex(/^\d+(\.\d{1,2})?$/)]).optional(),
  reason: z.string().trim().min(3, 'Düzəliş səbəbi yazılmalıdır.').max(500),
});

export const cancelDeliverySchema = z.object({
  reason: z.string().trim().min(3, 'Ləğv səbəbi yazılmalıdır.').max(500),
});

export const uuidParam = z.object({ id: z.string().uuid('Yanlış məlumat ID-si.') });

// ------------------------------- payments ---------------------------------

export const createPaymentSchema = z.object({
  idempotencyKey: z.string().min(8).max(100),
  deliveryId: z.string().uuid(),
  amount: z.union([z.coerce.number().min(0.01, 'Məbləğ sıfırdan böyük olmalıdır.').max(1_000_000), z.string().regex(/^\d+(\.\d{1,2})?$/)]),
  method: z.nativeEnum(PaymentMethod).optional(),
  paidAt: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'Ödəniş tarixi düzgün deyil.')
    .optional(),
  note: z.string().trim().max(500).optional(),
  allowOverpayment: z.boolean().optional(),
});

export const listPaymentsSchema = z.object({
  deliveryId: z.string().uuid().optional(),
  workerId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  method: z.nativeEnum(PaymentMethod).optional(),
  preset: rangePreset,
  from: dateFromQuery,
  to: dateFromQuery,
  search: z.string().trim().max(120).optional(),
  includeVoided: z.coerce.boolean().optional(),
  page: intFromQuery(1, 100000),
  pageSize: intFromQuery(1, 100),
});

export const voidPaymentSchema = z.object({
  reason: z.string().trim().min(3, 'Geri qaytarma səbəbi yazılmalıdır.').max(500),
});

// --------------------------------- debts ----------------------------------

export const createAdjustmentSchema = z.object({
  deliveryId: z.string().uuid(),
  type: z.nativeEnum(DebtAdjustmentType),
  amount: z.union([z.coerce.number().min(0.01).max(1_000_000), z.string().regex(/^\d+(\.\d{1,2})?$/)]),
  reason: z.string().trim().min(3, 'Səbəb yazılmalıdır.').max(500),
});

export const listDebtsSchema = z.object({
  workerId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  status: z.nativeEnum(DeliveryStatus).optional(),
  search: z.string().trim().max(120).optional(),
  preset: rangePreset,
  from: dateFromQuery,
  to: dateFromQuery,
  minAmount: z.coerce.number().min(0).optional(),
  page: intFromQuery(1, 100000),
  pageSize: intFromQuery(1, 100),
});

// ------------------------------- inventory --------------------------------

const bottleCount = z.coerce.number().int().min(1, 'Bidon sayı ən azı 1 olmalıdır.').max(100000);

export const stockInSchema = z.object({
  bottleCount,
  note: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

/**
 * Taking stock out of the warehouse. No `workerId`: a worker can only move
 * bottles into their own hands, and the admin cannot do this at all, so there
 * is nobody for the field to name.
 */
export const takeFromWarehouseSchema = z.object({
  bottleCount,
  note: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

export const returnStockSchema = z.object({
  workerId: z.string().uuid().optional(),
  bottleCount,
  note: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

export const writeOffSchema = z.object({
  type: z.enum([InventoryTxType.DAMAGE, InventoryTxType.LOSS]),
  bottleCount,
  workerId: z.string().uuid().optional(),
  note: z.string().trim().min(3, 'Səbəb yazılmalıdır.').max(500),
  idempotencyKey: z.string().min(8).max(100).optional(),
});

export const listInventorySchema = z.object({
  type: z.nativeEnum(InventoryTxType).optional(),
  workerId: z.string().uuid().optional(),
  deliveryId: z.string().uuid().optional(),
  preset: rangePreset,
  from: dateFromQuery,
  to: dateFromQuery,
  page: intFromQuery(1, 100000),
  pageSize: intFromQuery(1, 100),
});

// ------------------------------- customers --------------------------------

export const createCustomerSchema = z.object({
  name: z.string().trim().min(2, 'Ad ən azı 2 simvol olmalıdır.').max(150),
  address: z.string().trim().min(3, 'Ünvan ən azı 3 simvol olmalıdır.').max(400),
  phone: z.string().trim().max(30).optional(),
  note: z.string().trim().max(1000).optional(),
});

export const listCustomersSchema = z.object({
  search: z.string().trim().max(120).optional(),
  onlyDebtors: z.coerce.boolean().optional(),
  preset: rangePreset,
  from: dateFromQuery,
  to: dateFromQuery,
  page: intFromQuery(1, 100000),
  pageSize: intFromQuery(1, 100),
});

export const updateCustomerSchema = z.object({
  phone: z.string().trim().max(30).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  isActive: z.boolean().optional(),
});

// ---------------------------------- users ---------------------------------

export const createWorkerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  username: z.string().trim().toLowerCase().min(3).max(32).regex(/^[a-z0-9._-]+$/, 'İstifadəçi adı yalnız kiçik hərf, rəqəm, . _ - ola bilər.'),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().max(150).optional(),
  password: strongPassword.optional(),
});

export const updateWorkerSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    email: z.string().trim().max(150).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Heç nə dəyişdirilmədi.' });

export const updateProfileSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120).optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    email: z.string().trim().max(150).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Heç nə dəyişdirilmədi.' });

export const listWorkersSchema = z.object({
  search: z.string().trim().max(120).optional(),
  isActive: z.coerce.boolean().optional(),
  preset: rangePreset,
  page: intFromQuery(1, 100000),
  pageSize: intFromQuery(1, 100),
});

// -------------------------------- dashboard -------------------------------

export const dashboardRangeSchema = z.object({
  preset: rangePreset,
  from: dateFromQuery,
  to: dateFromQuery,
});

// ---------------------------------- audit ---------------------------------

export const listAuditSchema = z.object({
  actorId: z.string().uuid().optional(),
  action: z.string().trim().max(80).optional(),
  entityType: z.string().trim().max(60).optional(),
  entityId: z.string().trim().max(64).optional(),
  preset: rangePreset,
  from: dateFromQuery,
  to: dateFromQuery,
  page: intFromQuery(1, 100000),
  pageSize: intFromQuery(1, 100),
});

// --------------------------------- reports --------------------------------

export const reportSchema = z.object({
  type: z.enum(['daily', 'period', 'worker', 'customer', 'inventory', 'payments', 'deliveries']),
  preset: rangePreset,
  from: dateFromQuery,
  to: dateFromQuery,
  workerId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  // 'xlsx' is the styled modern workbook; 'xls' is the legacy Excel 97-2003
  // format that older Excel installs and office packages open natively.
  format: z.enum(['json', 'csv', 'pdf', 'xlsx', 'xls']).default('json'),
  /** Only used by /reports/monthly: "YYYY-MM", or "last", or omitted for now. */
  month: z.string().regex(/^(\d{4}-\d{2}|last)$/).optional(),
  /** Only used by /reports/yearly: "YYYY", or "last", or omitted for now. */
  year: z.string().regex(/^(\d{4}|last)$/).optional(),
});

// -------------------------------- settings --------------------------------

export const updateSettingsSchema = z.object({
  companyName: z.string().trim().min(1).max(120).optional(),
  currency: z.string().trim().min(1).max(10).optional(),
  defaultBottlePrice: z.coerce.number().min(0).max(1_000_000).optional(),
  dateFormat: z.string().trim().max(20).optional(),
  timezoneOffsetMinutes: z.coerce.number().int().min(-720).max(840).optional(),
});
