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
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
  customer?: { id: string; name: string; phone: string | null; address: string } | null;
  worker?: { id: string; fullName: string; username: string } | null;
  company?: { id: string; name: string } | null;
  office?: { id: string; name: string } | null;
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
    cancelledAt: iso(d.cancelledAt),
    cancelReason: d.cancelReason,
    createdAt: iso(d.createdAt),
    customerName: d.customer?.name ?? null,
    customerPhone: d.customer?.phone ?? null,
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
