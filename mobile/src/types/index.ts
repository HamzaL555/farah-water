export type Role = 'ADMIN' | 'WORKER';

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
  note: string | null;
  isActive: boolean;
  createdAt: string | null;
  deliveryCount: number;
  totalDebt: number;
  totalBottles: number;
  totalDelivered: number;
  lastDeliveryAt: string | null;
}

export interface CustomerDetail extends Customer {
  totalPaid: number;
  deliveries: Delivery[];
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
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string | null;
  customerName: string | null;
  customerPhone: string | null;
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

export interface InventorySummary {
  warehouseQuantity: number;
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
    isActive: boolean;
    quantity: number;
  }>;
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
