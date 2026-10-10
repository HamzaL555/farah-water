-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'WORKER');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "InventoryTxType" AS ENUM ('INBOUND', 'ISSUE_TO_WORKER', 'OUT_DELIVERY', 'RETURN_TO_STOCK', 'DAMAGE', 'LOSS', 'CORRECTION');

-- CreateEnum
CREATE TYPE "BalanceScope" AS ENUM ('WAREHOUSE', 'WORKER');

-- CreateEnum
CREATE TYPE "DebtAdjustmentType" AS ENUM ('FORGIVE', 'DECREASE', 'INCREASE');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'WORKER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "ip" TEXT,
    "success" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT NOT NULL,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "contactPhone" TEXT,
    "bottleCount" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "debtAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'UNPAID',
    "deliveredAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "paidAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "recordedById" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debt_adjustments" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "type" "DebtAdjustmentType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "debt_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_balances" (
    "key" TEXT NOT NULL,
    "scope" "BalanceScope" NOT NULL,
    "workerId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "inventory_transactions" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "type" "InventoryTxType" NOT NULL,
    "bottleCount" INTEGER NOT NULL,
    "direction" INTEGER NOT NULL,
    "balanceKey" TEXT NOT NULL,
    "workerId" TEXT,
    "deliveryId" TEXT,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "actorRole" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "meta" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_isActive_idx" ON "users"("role", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "login_attempts_identifier_createdAt_idx" ON "login_attempts"("identifier", "createdAt");

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- CreateIndex
CREATE INDEX "customers_address_idx" ON "customers"("address");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_idempotencyKey_key" ON "deliveries"("idempotencyKey");

-- CreateIndex
CREATE INDEX "deliveries_workerId_deliveredAt_idx" ON "deliveries"("workerId", "deliveredAt");

-- CreateIndex
CREATE INDEX "deliveries_customerId_deliveredAt_idx" ON "deliveries"("customerId", "deliveredAt");

-- CreateIndex
CREATE INDEX "deliveries_status_idx" ON "deliveries"("status");

-- CreateIndex
CREATE INDEX "deliveries_deliveredAt_idx" ON "deliveries"("deliveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payments_deliveryId_idx" ON "payments"("deliveryId");

-- CreateIndex
CREATE INDEX "payments_workerId_paidAt_idx" ON "payments"("workerId", "paidAt");

-- CreateIndex
CREATE INDEX "payments_paidAt_idx" ON "payments"("paidAt");

-- CreateIndex
CREATE INDEX "payments_customerId_idx" ON "payments"("customerId");

-- CreateIndex
CREATE INDEX "debt_adjustments_deliveryId_idx" ON "debt_adjustments"("deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_balances_workerId_key" ON "inventory_balances"("workerId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_transactions_reference_key" ON "inventory_transactions"("reference");

-- CreateIndex
CREATE INDEX "inventory_transactions_balanceKey_occurredAt_idx" ON "inventory_transactions"("balanceKey", "occurredAt");

-- CreateIndex
CREATE INDEX "inventory_transactions_type_idx" ON "inventory_transactions"("type");

-- CreateIndex
CREATE INDEX "inventory_transactions_workerId_occurredAt_idx" ON "inventory_transactions"("workerId", "occurredAt");

-- CreateIndex
CREATE INDEX "inventory_transactions_deliveryId_idx" ON "inventory_transactions"("deliveryId");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_adjustments" ADD CONSTRAINT "debt_adjustments_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debt_adjustments" ADD CONSTRAINT "debt_adjustments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;




-- ===========================================================================
-- Custom integrity constraints and triggers (source: prisma/integrity.sql).
-- Appended so the guards live in migration history and apply everywhere.
-- ===========================================================================
-- ===========================================================================
-- Integrity guards that Prisma's schema language cannot express.
-- These are the last line of defence: even a bug in application code, or a
-- direct `psql` session, cannot produce a negative stock balance, an
-- inconsistent debt, or a deleted financial record.
--
-- NOTE: columns are camelCase because the Prisma schema does not use @map on
-- fields (only tables are remapped with @@map).
-- ===========================================================================

-- 1. Stock can never go negative.
ALTER TABLE inventory_balances
  ADD CONSTRAINT inventory_balances_quantity_non_negative
  CHECK (quantity >= 0);

-- 2. Money is never negative, and the total always equals bottles x price.
ALTER TABLE deliveries
  ADD CONSTRAINT deliveries_amounts_non_negative
  CHECK ("bottleCount" > 0 AND "unitPrice" >= 0 AND "totalAmount" >= 0
         AND "paidAmount" >= 0 AND "debtAmount" >= 0);

ALTER TABLE deliveries
  ADD CONSTRAINT deliveries_total_consistent
  CHECK ("totalAmount" = "bottleCount" * "unitPrice");

-- 3. Debt always mirrors the money: exactly total - paid, except on cancel
--    (a cancelled delivery keeps no debt and must not hold any payment).
ALTER TABLE deliveries
  ADD CONSTRAINT deliveries_debt_consistent
  CHECK (
    (status = 'CANCELLED' AND "debtAmount" = 0 AND "paidAmount" = 0)
    OR (status <> 'CANCELLED' AND "debtAmount" = "totalAmount" - "paidAmount")
  );

-- 4. Status can never disagree with the recorded money. This is what makes
--    "mark as paid without paying" impossible at the database level.
ALTER TABLE deliveries
  ADD CONSTRAINT deliveries_status_consistent
  CHECK (
    status = 'CANCELLED'
    OR (status = 'UNPAID'   AND "paidAmount" = 0)
    OR (status = 'PAID'     AND "paidAmount" >= "totalAmount")
    OR (status = 'PARTIAL' AND "paidAmount" > 0 AND "paidAmount" < "totalAmount")
  );

ALTER TABLE payments
  ADD CONSTRAINT payments_amount_positive
  CHECK (amount > 0);

ALTER TABLE debt_adjustments
  ADD CONSTRAINT debt_adjustments_amount_positive
  CHECK (amount > 0);

ALTER TABLE inventory_transactions
  ADD CONSTRAINT inventory_transactions_count_valid
  CHECK ("bottleCount" > 0 AND direction IN (-1, 1));

-- 5. An admin account can never be deactivated (that would lock everyone out).
CREATE OR REPLACE FUNCTION farah_prevent_admin_deactivation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."role" = 'ADMIN' AND NEW."isActive" = false THEN
    RAISE EXCEPTION 'Administrator hesabini deaktiv etmek mumkun deyil';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_prevent_admin_deactivation
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION farah_prevent_admin_deactivation();

-- 6. Financial rows are never hard-deleted. Mistakes are corrected by voiding
--    a payment or posting an adjustment, which leaves the history intact.
CREATE OR REPLACE FUNCTION farah_prevent_financial_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Maliyye tarixcesi siline bilmez. Emeliyyati geri qaytarin (void) veya duzelis yazin.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_no_delete
  BEFORE DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION farah_prevent_financial_delete();

CREATE TRIGGER deliveries_no_delete
  BEFORE DELETE ON deliveries
  FOR EACH ROW EXECUTE FUNCTION farah_prevent_financial_delete();

CREATE TRIGGER debt_adjustments_no_delete
  BEFORE DELETE ON debt_adjustments
  FOR EACH ROW EXECUTE FUNCTION farah_prevent_financial_delete();

CREATE TRIGGER inventory_transactions_no_delete
  BEFORE DELETE ON inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION farah_prevent_financial_delete();

