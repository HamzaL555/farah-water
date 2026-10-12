-- Farah Water Company
-- Companies, offices, and the two new dimensions on a delivery:
--   Su:   which water (filtered / spring) - priced separately
--   Hara: where it went (a home address / a company office)
--
-- unitPrice is deliberately NOT set from the client. A company delivery takes
-- its price from the company; a home delivery starts at 0 until the admin
-- writes the real price. A worker cannot influence either number.

-- ============================= enums ======================================

CREATE TYPE "WaterType" AS ENUM ('FILTERED', 'SPRING');
CREATE TYPE "DestinationType" AS ENUM ('HOME', 'COMPANY');

-- ============================= companies ==================================

CREATE TABLE "companies" (
  "id"            TEXT         NOT NULL,
  "name"          TEXT         NOT NULL,
  "filteredPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "springPrice"   DECIMAL(12,2) NOT NULL DEFAULT 0,
  "isActive"      BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,

  CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "companies_name_key" ON "companies"("name");

-- ============================== offices ===================================

CREATE TABLE "offices" (
  "id"        TEXT         NOT NULL,
  "companyId" TEXT         NOT NULL,
  "name"      TEXT         NOT NULL,
  "sortOrder" INTEGER      NOT NULL DEFAULT 0,
  "isActive"  BOOLEAN      NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "offices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "offices_companyId_name_key" ON "offices"("companyId", "name");
CREATE INDEX "offices_companyId_sortOrder_idx" ON "offices"("companyId", "sortOrder");

-- ============================= deliveries ================================
-- Defaults backfill every existing row as a home delivery of filtered water,
-- which is what all pre-existing data was, so no history changes meaning.

ALTER TABLE "deliveries"
  ADD COLUMN "waterType"       "WaterType"       NOT NULL DEFAULT 'FILTERED',
  ADD COLUMN "destinationType" "DestinationType" NOT NULL DEFAULT 'HOME',
  ADD COLUMN "companyId"       TEXT,
  ADD COLUMN "officeId"        TEXT;

CREATE INDEX "deliveries_destinationType_deliveredAt_idx" ON "deliveries"("destinationType", "deliveredAt");
CREATE INDEX "deliveries_waterType_deliveredAt_idx"       ON "deliveries"("waterType", "deliveredAt");
CREATE INDEX "deliveries_officeId_idx"                    ON "deliveries"("officeId");

-- RESTRICT, not CASCADE: losing the office a delivery was recorded against
-- would silently turn a company delivery into an unattributable one.
ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_officeId_fkey"
  FOREIGN KEY ("officeId") REFERENCES "offices"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "offices"
  ADD CONSTRAINT "offices_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- A company delivery must name a company; a home delivery must not. Enforced in
-- the database, so a bug in any client still cannot produce a delivery that
-- claims to be to a company with no company attached.
ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_company_coherent"
  CHECK (
    ("destinationType" = 'COMPANY' AND "companyId" IS NOT NULL)
    OR ("destinationType" = 'HOME'     AND "companyId" IS NULL AND "officeId" IS NULL)
  );