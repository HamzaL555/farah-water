-- Farah Water Company
-- Deposits, water prices, price-change requests, expenses, and a generalized
-- admin notification inbox.
--
-- The new tables are additive: no existing table loses a column and no existing
-- row is rewritten. `water_prices` is seeded with one row per water type so the
-- API always has a price to read; the seeded value is 0 because the company
-- must type its own price (a price is never invented here).

-- ============================ ENUMS ========================================

CREATE TYPE "DepositTxType" AS ENUM ('DEPOSIT_IN', 'DEPOSIT_OUT', 'ADJUSTMENT');
CREATE TYPE "PriceRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "ExpenseCategory" AS ENUM ('FUEL', 'SALARY', 'MAINTENANCE', 'RENT', 'UTILITIES', 'SUPPLIES', 'TRANSPORT', 'OTHER');

-- ========================= NOTIFICATIONS ===================================

-- A notification is no longer only a stock movement. Stock columns become
-- nullable and the inbox gains a family (`kind`) plus a human title/message.
ALTER TABLE "notifications"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'STOCK',
  ADD COLUMN "title" TEXT,
  ADD COLUMN "message" TEXT,
  ALTER COLUMN "waterType" DROP NOT NULL,
  ALTER COLUMN "bottleCount" DROP NOT NULL,
  ALTER COLUMN "beforeBalance" DROP NOT NULL,
  ALTER COLUMN "afterBalance" DROP NOT NULL;

-- Existing rows are all stock notifications.
UPDATE "notifications" SET "kind" = 'STOCK' WHERE "kind" IS NULL;

-- ============================ TABLES =======================================

CREATE TABLE "customer_deposits" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "DepositTxType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "bottleCount" INTEGER NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "bottleBalanceAfter" INTEGER NOT NULL,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_deposits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "water_prices" (
    "id" TEXT NOT NULL,
    "waterType" "WaterType" NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "updatedById" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "water_prices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "price_change_requests" (
    "id" TEXT NOT NULL,
    "waterType" "WaterType" NOT NULL,
    "oldPrice" DECIMAL(12,2) NOT NULL,
    "newPrice" DECIMAL(12,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "PriceRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,

    CONSTRAINT "price_change_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "price_history" (
    "id" TEXT NOT NULL,
    "waterType" "WaterType" NOT NULL,
    "oldPrice" DECIMAL(12,2) NOT NULL,
    "newPrice" DECIMAL(12,2) NOT NULL,
    "source" TEXT NOT NULL,
    "requestId" TEXT,
    "note" TEXT,
    "changedById" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL DEFAULT 'OTHER',
    "waterType" "WaterType",
    "amount" DECIMAL(12,2) NOT NULL,
    "spentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- ============================ INDEXES ======================================

CREATE UNIQUE INDEX "customer_deposits_idempotencyKey_key" ON "customer_deposits"("idempotencyKey");
CREATE INDEX "customer_deposits_customerId_occurredAt_idx" ON "customer_deposits"("customerId", "occurredAt");
CREATE INDEX "customer_deposits_occurredAt_idx" ON "customer_deposits"("occurredAt");

CREATE UNIQUE INDEX "water_prices_waterType_key" ON "water_prices"("waterType");

CREATE INDEX "price_change_requests_status_requestedAt_idx" ON "price_change_requests"("status", "requestedAt");
CREATE INDEX "price_change_requests_waterType_requestedAt_idx" ON "price_change_requests"("waterType", "requestedAt");

CREATE INDEX "price_history_waterType_occurredAt_idx" ON "price_history"("waterType", "occurredAt");

CREATE UNIQUE INDEX "expenses_idempotencyKey_key" ON "expenses"("idempotencyKey");
CREATE INDEX "expenses_spentAt_idx" ON "expenses"("spentAt");
CREATE INDEX "expenses_category_idx" ON "expenses"("category");
CREATE INDEX "expenses_waterType_spentAt_idx" ON "expenses"("waterType", "spentAt");

-- The ledger is filtered by water type in every report.
CREATE INDEX IF NOT EXISTS "inventory_transactions_waterType_idx" ON "inventory_transactions"("waterType");

-- ========================== FOREIGN KEYS ===================================

ALTER TABLE "customer_deposits" ADD CONSTRAINT "customer_deposits_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_deposits" ADD CONSTRAINT "customer_deposits_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "water_prices" ADD CONSTRAINT "water_prices_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "price_change_requests" ADD CONSTRAINT "price_change_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "price_change_requests" ADD CONSTRAINT "price_change_requests_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "price_history" ADD CONSTRAINT "price_history_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================ INTEGRITY ====================================

-- Deposits and price history are append-only ledgers. DELETE is stopped by the
-- shared financial guard; UPDATE gets its own guard so an old movement can never
-- be rewritten. A correction is a NEW row, exactly like the stock ledger.
CREATE OR REPLACE FUNCTION farah_prevent_ledger_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Bu maliyyə qeydi dəyişdirilə bilməz. Düzəliş üçün yeni qeyd yaradın.'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER customer_deposits_no_delete
  BEFORE DELETE ON customer_deposits
  FOR EACH ROW EXECUTE FUNCTION farah_prevent_financial_delete();

CREATE TRIGGER customer_deposits_no_update
  BEFORE UPDATE ON customer_deposits
  FOR EACH ROW EXECUTE FUNCTION farah_prevent_ledger_update();

CREATE TRIGGER price_history_no_delete
  BEFORE DELETE ON price_history
  FOR EACH ROW EXECUTE FUNCTION farah_prevent_financial_delete();

CREATE TRIGGER price_history_no_update
  BEFORE UPDATE ON price_history
  FOR EACH ROW EXECUTE FUNCTION farah_prevent_ledger_update();

-- A price-change request is history as soon as it is decided: only the pending
-- row may be reviewed once. Approved/rejected rows cannot be flipped back.
CREATE OR REPLACE FUNCTION farah_prevent_decided_price_request_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'Təsdiqlənmiş və ya rədd edilmiş qiymət sorğusu dəyişdirilə bilməz.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER price_change_requests_decided_immutable
  BEFORE UPDATE ON price_change_requests
  FOR EACH ROW EXECUTE FUNCTION farah_prevent_decided_price_request_update();

CREATE TRIGGER price_change_requests_no_delete
  BEFORE DELETE ON price_change_requests
  FOR EACH ROW EXECUTE FUNCTION farah_prevent_financial_delete();

-- Expenses can be voided (UPDATE of the void columns) but never deleted.
CREATE TRIGGER expenses_no_delete
  BEFORE DELETE ON expenses
  FOR EACH ROW EXECUTE FUNCTION farah_prevent_financial_delete();

-- Expense amounts and prices must always be positive/valid; deposit rows carry
-- a signed delta (negative = refund), so they have no sign check.
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "water_prices" ADD CONSTRAINT "water_prices_price_non_negative" CHECK ("price" >= 0);
ALTER TABLE "price_change_requests" ADD CONSTRAINT "price_change_requests_price_non_negative" CHECK ("newPrice" >= 0);

-- ============================== SEED =======================================

INSERT INTO "water_prices" ("id", "waterType", "price", "effectiveFrom", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'FILTERED', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'SPRING',   0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("waterType") DO NOTHING;
