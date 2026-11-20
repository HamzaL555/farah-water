export type Role = 'ADMIN' | 'WORKER';

/** The admin decides which warehouse rights a worker has. */
export type WorkerType = 'WAREHOUSE_KEEPER' | 'REGULAR';

export type DeliveryStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'CANCELLED';
export type PaymentMethod = 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER';

export type InventoryTxType =
  | 'INBOUND'
  | 'ISSUE_TO_WORKER'
  | 'OUT_DELIVERY'
  | 'RETURN_TO_STOCK'
  | 'DAMAGE'
  | 'LOSS'
  | 'CORRECTION';

export type DebtAdjustmentType = 'FORGIVE' | 'DECREASE' | 'INCREASE';

export type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'last7days'
  | 'last30days'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'all';

export interface User {
  id: string;
  fullName: string;
  username: string;
  phone: string | null;
  email: string | null;
  role: Role;
  /** Null for admins; WAREHOUSE_KEEPER or REGULAR for workers. */
  workerType: WorkerType | null;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string | null;
  lockedUntil: string | null;
}

export interface WorkerStats extends User {
  todayBottles: number;
  todayDeliveries: number;
  todayCollected: number;
  todayPayments: number;
  assignedBottles: number;
  totalDeliveries: number;
  totalBottles: number;
  outstandingDebt: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  note: string | null;
  isActive: boolean;
  createdAt: string | null;
  deliveryCount: number;
  totalDebt: number;
  totalBottles: number;
  totalDelivered: number;
  lastDeliveryAt: string | null;
  /** Admin only: money the company holds for this customer's bottles. */
  depositBalance?: number;
  /** Admin only: how many bottles that deposit covers. */
  depositBottleBalance?: number;
}

/** One signed row of the append-only customer deposit ledger. */
export type DepositTxType = 'DEPOSIT_IN' | 'DEPOSIT_OUT' | 'ADJUSTMENT';

export interface CustomerDeposit {
  id: string;
  customerId: string;
  customerName: string | null;
  customerPhone: string | null;
  type: DepositTxType;
  /** Bulaq and Filtr deposits are separate accounts. */
  waterType: WaterType;
  /** Signed: positive money in, negative money refunded/adjusted away. */
  amount: number;
  bottleCount: number;
  balanceAfter: number;
  bottleBalanceAfter: number;
  note: string | null;
  occurredAt: string | null;
  createdById: string;
  createdByName: string | null;
  createdAt: string | null;
}

export interface CustomerDetail extends Customer {
  totalPaid: number;
  deliveries: Delivery[];
  depositMovements?: number;
  deposits?: CustomerDeposit[];
}

export interface Delivery {
  id: string;
  customerId: string;
  workerId: string;
  address: string;
  contactPhone: string | null;
  waterType: WaterType;
  destinationType: DestinationType;
  companyId: string | null;
  officeId: string | null;
  bottleCount: number;
  unitPrice: number;
  totalAmount: number;
  paidAmount: number;
  debtAmount: number;
  status: DeliveryStatus;
  deliveredAt: string | null;
  note: string | null;
  /**
   * Iki mərhələli çatdırılma. `false` o deməkdir ki, sətir qeydə alınıb, amma
   * hələ təsdiqlənməyib və bidonlar işçinin balansından ÇIXMAYIB.
   */
  isConfirmed: boolean;
  confirmedAt: string | null;
  confirmedById: string | null;
  confirmedByName: string | null;
  confirmationNote: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  customerLatitude: number | null;
  customerLongitude: number | null;
  workerName: string | null;
  workerUsername: string | null;
  companyName: string | null;
  officeName: string | null;
}

/** Which water. Priced separately from SPRING. */
export type WaterType = 'FILTERED' | 'SPRING';

/** Where the bottles went. COMPANY deliveries carry companyId + officeId. */
export type DestinationType = 'HOME' | 'COMPANY';

export interface Office {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface Company {
  id: string;
  name: string;
  /**
   * Null unless the caller is an admin. The server withholds the price from
   * workers, so this is not a value the driver could see by asking harder.
   */
  filteredPrice: number | null;
  springPrice: number | null;
  isActive: boolean;
  offices: Office[];
}

export interface Payment {
  id: string;
  deliveryId: string;
  customerId: string;
  workerId: string;
  amount: number;
  method: PaymentMethod;
  paidAt: string | null;
  note: string | null;
  recordedById: string;
  recordedByName: string | null;
  customerName: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string | null;
}

export interface DebtAdjustment {
  id: string;
  deliveryId: string;
  type: DebtAdjustmentType;
  amount: number;
  reason: string;
  createdById: string;
  createdByName: string | null;
  createdAt: string | null;
}

export interface InventoryTransaction {
  id: string;
  reference: string;
  type: InventoryTxType;
  bottleCount: number;
  direction: number;
  signedCount: number;
  balanceKey: string;
  /** Bulaq or Filtr: the movement never mixes the two. */
  waterType: WaterType;
  workerId: string | null;
  workerName: string | null;
  deliveryId: string | null;
  note: string | null;
  occurredAt: string | null;
  createdById: string;
  /** Who recorded the movement - not necessarily who owns the stock. */
  createdByName: string | null;
  createdByRole: Role | null;
  createdAt: string | null;
}

export interface DeliveryDetail extends Delivery {
  payments: Payment[];
  debtAdjustments: DebtAdjustment[];
  inventoryTransactions: InventoryTransaction[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface PaginatedAmounts<T> extends Paginated<T> {
  totalAmount: number;
}

export interface WorkerDashboard {
  todayBottles: number;
  todayDeliveries: number;
  todayBilledAmount: number;
  todayPayments: number;
  todayCollected: number;
  outstandingDeliveryCount: number;
  outstandingDebt: number;
  stockInHand: number;
  recentDeliveries: Delivery[];
}

export interface AdminDashboard {
  range: { start: string | null; end: string | null; preset: DateRangePreset | 'all' };
  inventory: {
    todayInbound: number;
    todayIssuedToWorkers: number;
    warehouseQuantity: number;
    inWorkersHands: number;
    damagedInRange: number;
    lostInRange: number;
  };
  finance: {
    collectedInRange: number;
    paymentsInRange: number;
    billedInRange: number;
    todayCollected: number;
    todayPayments: number;
    monthCollected: number;
    monthPayments: number;
    totalOutstandingDebt: number;
    debtorCustomers: number;
    undeliveredValueInRange: number;
    /** Revenue from real payments only, split by water type. */
    revenueByWater?: { filtered: number; spring: number; total: number; payments: number };
    expensesByWater?: { filtered: number; spring: number; shared: number; total: number };
    profit?: { filtered: number; spring: number; total: number };
    /** Held money - never part of revenue. */
    depositsHeld?: number;
    depositBottlesHeld?: number;
    pendingPriceRequests?: number;
  };
  deliveries: {
    todayCount: number;
    todayBottles: number;
    inRangeCount: number;
    allTimeBottles: number;
  };
}

export interface RevenueBreakdown {
  byMethod: Array<{ method: PaymentMethod; amount: number; count: number }>;
  byWorker: Array<{
    workerId: string;
    workerName: string;
    username: string | null;
    amount: number;
    count: number;
  }>;
}

export interface WaterSplit {
  filtered: number;
  spring: number;
  total: number;
}

export interface InventorySummary {
  /** Bulaq and Filtr are always separate; `total` is their explicit sum. */
  warehouse: WaterSplit;
  /** Pre-split alias for `warehouse.total`. */
  warehouseQuantity: number;
  inbound: WaterSplit;
  outbound: WaterSplit;
  issuedToWorkers: WaterSplit;
  returned: WaterSplit;
  inWorkersHands: number;
  totalSystemQuantity: number;
  todayInbound: number;
  todayOutbound: number;
  damagedTotal: number;
  lostTotal: number;
  workers: Array<{
    workerId: string;
    workerName: string;
    username: string;
    workerType: WorkerType | null;
    isActive: boolean;
    filteredQty: number;
    springQty: number;
    totalQty: number;
  }>;
}

/** A worker's own handheld stock, split by water type. */
export interface MyStock {
  filteredQty: number;
  springQty: number;
  totalQty: number;
  /** Alias for `totalQty`, kept for older clients. */
  quantity: number;
  updatedAt: string | null;
}

// -------------------------------- prices -----------------------------------

export interface WaterPrice {
  waterType: WaterType;
  price: number;
  effectiveFrom: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
}

export type PriceRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface PriceChangeRequest {
  id: string;
  waterType: WaterType;
  oldPrice: number;
  newPrice: number;
  reason: string;
  status: PriceRequestStatus;
  requestedAt: string | null;
  requestedById: string;
  requestedByName: string | null;
  requestedByUsername: string | null;
  reviewedAt: string | null;
  reviewedById: string | null;
  reviewedByName: string | null;
  reviewNote: string | null;
}

export interface PriceHistoryEntry {
  id: string;
  waterType: WaterType;
  oldPrice: number;
  newPrice: number;
  source: 'ADMIN' | 'PRICE_REQUEST';
  requestId: string | null;
  note: string | null;
  occurredAt: string | null;
  changedById: string;
  changedByName: string | null;
}

// ------------------------------- expenses ----------------------------------

export type ExpenseCategory =
  | 'FUEL'
  | 'SALARY'
  | 'MAINTENANCE'
  | 'RENT'
  | 'UTILITIES'
  | 'SUPPLIES'
  | 'TRANSPORT'
  | 'OTHER';

export interface Expense {
  id: string;
  category: ExpenseCategory;
  waterType: WaterType | null;
  amount: number;
  spentAt: string | null;
  note: string | null;
  createdById: string;
  createdByName: string | null;
  createdAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface DebtSummaryRow {
  customerId: string;
  customerName: string;
  phone: string | null;
  address: string | null;
  deliveryCount: number;
  totalAmount: number;
  paidAmount: number;
  debtAmount: number;
}

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  meta: unknown;
  ip: string | null;
  createdAt: string;
}

export interface AppSettings {
  companyName: string;
  currency: string;
  defaultBottlePrice: number;
  dateFormat: string;
  timezoneOffsetMinutes: number;
}

export interface ReportSection {
  heading: string;
  columns: string[];
  rows: (string | number)[][];
  totals?: (string | number)[];
}

export interface Report {
  title: string;
  subtitle: string;
  generatedAt: string;
  currency: string;
  sections: ReportSection[];
}
