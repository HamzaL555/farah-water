import { Prisma } from '@prisma/client';
import { moneyOut } from './money';

export type Json = Record<string, unknown>;

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export function paginate<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): Paginated<T> {
  return {
    items,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  };
}

// ------------------------------ users -------------------------------------

export function serializeUser(user: {
  id: string;
  fullName: string;
  username: string;
  phone: string | null;
  email: string | null;
  role: string;
  workerType?: string | null;
  isActive: boolean;
  mustChangePassword?: boolean;
  lastLoginAt?: Date | null;
  createdAt?: Date;
  lockedUntil?: Date | null;
}) {
  return {
    id: user.id,
    fullName: user.fullName,
    username: user.username,
    phone: user.phone,
    email: user.email,
    role: user.role,
    workerType: user.workerType ?? null,
    isActive: user.isActive,
    mustChangePassword: user.mustChangePassword ?? false,
    lastLoginAt: iso(user.lastLoginAt),
    createdAt: iso(user.createdAt),
    lockedUntil: iso(user.lockedUntil),
  };
}

// ---------------------------- customers -----------------------------------

export function serializeCustomer(customer: {
  id: string;
  name: string;
  phone: string | null;
  address: string;
  latitude?: Prisma.Decimal | null;
  longitude?: Prisma.Decimal | null;
  note: string | null;
  isActive: boolean;
  createdAt: Date;
  _count?: { deliveries?: number };
  totalDebt?: Prisma.Decimal | null;
  totalBottles?: number | null;
  totalDelivered?: Prisma.Decimal | null;
  lastDeliveryAt?: Date | null;
}) {
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    address: customer.address,
    latitude: customer.latitude == null ? null : Number(customer.latitude),
    longitude: customer.longitude == null ? null : Number(customer.longitude),
    note: customer.note,
    isActive: customer.isActive,
    createdAt: iso(customer.createdAt),
    deliveryCount: customer._count?.deliveries ?? 0,
    totalDebt: moneyOut(customer.totalDebt ?? 0),
    totalBottles: customer.totalBottles ?? 0,
    totalDelivered: moneyOut(customer.totalDelivered ?? 0),
    lastDeliveryAt: iso(customer.lastDeliveryAt),
  };
}

// ---------------------------- deliveries ----------------------------------

type DeliveryRow = {
  id: string;
  customerId: string;
  workerId: string;
  address: string;
  contactPhone: string | null;
  waterType: string;
  destinationType: string;
  companyId: string | null;
  officeId: string | null;
  bottleCount: number;
  unitPrice: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  paidAmount: Prisma.Decimal;
  debtAmount: Prisma.Decimal;
  status: string;
  deliveredAt: Date;
  note: string | null;
  confirmedAt: Date | null;
  confirmedById: string | null;
  confirmationNote: string | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  customer?: { id: string; name: string; phone: string | null; address: string; latitude?: Prisma.Decimal | null; longitude?: Prisma.Decimal | null } | null;  worker?: { id: string; fullName: string; username: string } | null;
  company?: { id: string; name: string } | null;
  office?: { id: string; name: string } | null;
  confirmedBy?: { id: string; fullName: string } | null;
};

export function serializeDelivery(d: DeliveryRow) {
  return {
    id: d.id,
    customerId: d.customerId,
    workerId: d.workerId,
    address: d.address,
    contactPhone: d.contactPhone,
    waterType: d.waterType,
    destinationType: d.destinationType,
    companyId: d.companyId ?? null,
    officeId: d.officeId ?? null,
    bottleCount: d.bottleCount,
    unitPrice: moneyOut(d.unitPrice),
    totalAmount: moneyOut(d.totalAmount),
    paidAmount: moneyOut(d.paidAmount),
    debtAmount: moneyOut(d.debtAmount),
    status: d.status,
    deliveredAt: iso(d.deliveredAt),
    note: d.note,
    confirmedAt: iso(d.confirmedAt),
    confirmedById: d.confirmedById ?? null,
    confirmedByName: d.confirmedBy?.fullName ?? null,
    confirmationNote: d.confirmationNote ?? null,
    isConfirmed: d.confirmedAt != null,
    cancelledAt: iso(d.cancelledAt),
    cancelReason: d.cancelReason,
    createdAt: iso(d.createdAt),
    customerName: d.customer?.name ?? null,
    customerPhone: d.customer?.phone ?? null,
    customerAddress: d.customer?.address ?? null,
    customerLatitude: d.customer?.latitude == null ? null : Number(d.customer.latitude),
    customerLongitude: d.customer?.longitude == null ? null : Number(d.customer.longitude),
    workerName: d.worker?.fullName ?? null,
    workerUsername: d.worker?.username ?? null,
    companyName: d.company?.name ?? null,
    officeName: d.office?.name ?? null,
  };
}

// ------------------------------ payments ----------------------------------

export function serializePayment(p: {
  id: string;
  deliveryId: string;
  customerId: string;
  workerId: string;
  amount: Prisma.Decimal;
  method: string;
  paidAt: Date;
  note: string | null;
  recordedById: string;
  voidedAt: Date | null;
  voidReason: string | null;
  createdAt: Date;
  recordedBy?: { id: string; fullName: string } | null;
  customer?: { id: string; name: string } | null;
}) {
  return {
    id: p.id,
    deliveryId: p.deliveryId,
    customerId: p.customerId,
    workerId: p.workerId,
    amount: moneyOut(p.amount),
    method: p.method,
    paidAt: iso(p.paidAt),
    note: p.note,
    recordedById: p.recordedById,
    recordedByName: p.recordedBy?.fullName ?? null,
    customerName: p.customer?.name ?? null,
    voidedAt: iso(p.voidedAt),
    voidReason: p.voidReason,
    createdAt: iso(p.createdAt),
  };
}

// ------------------------- inventory transactions -------------------------

export function serializeInventoryTx(t: {
  id: string;
  reference: string;
  type: string;
  bottleCount: number;
  direction: number;
  balanceKey: string;
  waterType?: string;
  workerId: string | null;
  deliveryId: string | null;
  note: string | null;
  beforeBalance?: number | null;
  afterBalance?: number | null;
  occurredAt: Date;
  createdById: string;
  createdAt: Date;
  worker?: { id: string; fullName: string } | null;
  /** Who recorded the movement - not the same as who owns the stock. */
  createdBy?: { id: string; fullName: string; role: string } | null;
}) {
  return {
    id: t.id,
    reference: t.reference,
    type: t.type,
    bottleCount: t.bottleCount,
    direction: t.direction,
    signedCount: t.direction * t.bottleCount,
    balanceKey: t.balanceKey,
    waterType: t.waterType ?? 'FILTERED',
    workerId: t.workerId,
    workerName: t.worker?.fullName ?? null,
    deliveryId: t.deliveryId,
    note: t.note,
    beforeBalance: t.beforeBalance ?? null,
    afterBalance: t.afterBalance ?? null,
    occurredAt: iso(t.occurredAt),
    createdById: t.createdById,
    createdByName: t.createdBy?.fullName ?? null,
    createdByRole: t.createdBy?.role ?? null,
    createdAt: iso(t.createdAt),
  };
}

// --------------------------- debt adjustments -----------------------------

export function serializeDebtAdjustment(a: {
  id: string;
  deliveryId: string;
  type: string;
  amount: Prisma.Decimal;
  reason: string;
  createdById: string;
  createdAt: Date;
  createdBy?: { id: string; fullName: string } | null;
}) {
  return {
    id: a.id,
    deliveryId: a.deliveryId,
    type: a.type,
    amount: moneyOut(a.amount),
    reason: a.reason,
    createdById: a.createdById,
    createdByName: a.createdBy?.fullName ?? null,
    createdAt: iso(a.createdAt),
  };
}

// ------------------------------ deposits -----------------------------------

export function serializeDeposit(d: {
  id: string;
  customerId: string;
  type: string;
  waterType?: string;
  amount: Prisma.Decimal;
  bottleCount: number;
  balanceAfter: Prisma.Decimal;
  bottleBalanceAfter: number;
  note: string | null;
  occurredAt: Date;
  createdById: string;
  createdAt: Date;
  customer?: { id: string; name: string; phone?: string | null } | null;
  createdBy?: { id: string; fullName: string } | null;
}) {
  return {
    id: d.id,
    customerId: d.customerId,
    customerName: d.customer?.name ?? null,
    customerPhone: d.customer?.phone ?? null,
    type: d.type,
    waterType: d.waterType ?? 'FILTERED',
    amount: moneyOut(d.amount),
    bottleCount: d.bottleCount,
    balanceAfter: moneyOut(d.balanceAfter),
    bottleBalanceAfter: d.bottleBalanceAfter,
    note: d.note,
    occurredAt: iso(d.occurredAt),
    createdById: d.createdById,
    createdByName: d.createdBy?.fullName ?? null,
    createdAt: iso(d.createdAt),
  };
}

// ------------------------------- prices ------------------------------------

export function serializePrice(p: {
  waterType: string;
  price: Prisma.Decimal;
  effectiveFrom?: Date;
  updatedAt?: Date;
  updatedBy?: { id: string; fullName: string } | null;
}) {
  return {
    waterType: p.waterType,
    price: moneyOut(p.price),
    effectiveFrom: iso(p.effectiveFrom),
    updatedAt: iso(p.updatedAt),
    updatedByName: p.updatedBy?.fullName ?? null,
  };
}

export function serializePriceRequest(r: {
  id: string;
  waterType: string;
  oldPrice: Prisma.Decimal;
  newPrice: Prisma.Decimal;
  reason: string;
  status: string;
  requestedAt: Date;
  reviewedAt: Date | null;
  reviewNote: string | null;
  requestedById: string;
  reviewedById: string | null;
  requestedBy?: { id: string; fullName: string; username: string } | null;
  reviewedBy?: { id: string; fullName: string } | null;
}) {
  return {
    id: r.id,
    waterType: r.waterType,
    oldPrice: moneyOut(r.oldPrice),
    newPrice: moneyOut(r.newPrice),
    reason: r.reason,
    status: r.status,
    requestedAt: iso(r.requestedAt),
    requestedById: r.requestedById,
    requestedByName: r.requestedBy?.fullName ?? null,
    requestedByUsername: r.requestedBy?.username ?? null,
    reviewedAt: iso(r.reviewedAt),
    reviewedById: r.reviewedById,
    reviewedByName: r.reviewedBy?.fullName ?? null,
    reviewNote: r.reviewNote,
  };
}

export function serializePriceHistory(h: {
  id: string;
  waterType: string;
  oldPrice: Prisma.Decimal;
  newPrice: Prisma.Decimal;
  source: string;
  requestId: string | null;
  note: string | null;
  occurredAt: Date;
  changedById: string;
  changedBy?: { id: string; fullName: string } | null;
}) {
  return {
    id: h.id,
    waterType: h.waterType,
    oldPrice: moneyOut(h.oldPrice),
    newPrice: moneyOut(h.newPrice),
    source: h.source,
    requestId: h.requestId,
    note: h.note,
    occurredAt: iso(h.occurredAt),
    changedById: h.changedById,
    changedByName: h.changedBy?.fullName ?? null,
  };
}

// ------------------------------ expenses -----------------------------------

export function serializeExpense(e: {
  id: string;
  category: string;
  waterType: string | null;
  amount: Prisma.Decimal;
  spentAt: Date;
  note: string | null;
  createdById: string;
  createdAt: Date;
  voidedAt: Date | null;
  voidReason: string | null;
  createdBy?: { id: string; fullName: string } | null;
}) {
  return {
    id: e.id,
    category: e.category,
    waterType: e.waterType,
    amount: moneyOut(e.amount),
    spentAt: iso(e.spentAt),
    note: e.note,
    createdById: e.createdById,
    createdByName: e.createdBy?.fullName ?? null,
    createdAt: iso(e.createdAt),
    voidedAt: iso(e.voidedAt),
    voidReason: e.voidReason,
  };
}
