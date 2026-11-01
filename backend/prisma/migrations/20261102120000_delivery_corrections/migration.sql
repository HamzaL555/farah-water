-- Farah Water Company
-- Delivery corrections: worker requests to change bottle count on an existing
-- delivery. Admin reviews and approves/rejects. When approved, Delivery
-- bottleCount is updated and debt/total are recomputed.

-- ============================= enum ======================================

CREATE TYPE "DeliveryCorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- ============================= delivery_corrections ======================

CREATE TABLE "delivery_corrections" (
  "id"            TEXT         NOT NULL,
  "deliveryId"    TEXT         NOT NULL,
  "oldBottleCount" INTEGER    NOT NULL,
  "newBottleCount" INTEGER    NOT NULL,
  "reason"        TEXT         NOT NULL,
  "status"        "DeliveryCorrectionStatus" NOT NULL DEFAULT 'PENDING',
  "requestedById" TEXT         NOT NULL,
  "approvedById"  TEXT,
  "requestedAt"   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  "approvedAt"    TIMESTAMPTZ,

  CONSTRAINT "delivery_corrections_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_corrections_deliveryId_fkey"
    FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "delivery_corrections_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "delivery_corrections_approvedById_fkey"
    FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,

  CONSTRAINT "delivery_corrections_new_bottle_positive"
    CHECK ("newBottleCount" >= 1)
);

CREATE INDEX "delivery_corrections_deliveryId_idx" ON "delivery_corrections"("deliveryId");
CREATE INDEX "delivery_corrections_status_idx" ON "delivery_corrections"("status");
CREATE INDEX "delivery_corrections_requestedById_requestedAt_idx"
  ON "delivery_corrections"("requestedById", "requestedAt");

-- ============================= Delivery.corrections relation ============

-- The relation is added via Prisma; no additional DDL needed beyond the table
-- and foreign key above.
