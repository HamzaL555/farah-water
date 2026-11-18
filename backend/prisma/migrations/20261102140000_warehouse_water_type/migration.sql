-- Farah Water Company
-- Warehouse water type support: Bulaq suyu (SPRING) ve Filtr suyu (FILTERED)
-- ayrı bir-birinden muqayisə edilmək əvəz olunmur.
--
-- YENILƏDİKLƏR:
-- 1. users jadlinə workerType sütunu (WAREHOUSE_KEEPER / REGULAR)
-- 2. inventory_balances jadlinə waterType sütunu; kalın (key, waterType) unikal
-- 3. inventory_transactions jadlinə waterType sütunu
-- 4. notifications jadlinesi yaradılır (admin bildirişləri üçün)
-- 5. Eski qeydlər FILTERED su növüne meneyyet edilir

-- ============================= enums ======================================

CREATE TYPE "WorkerType" AS ENUM ('WAREHOUSE_KEEPER', 'REGULAR');

-- ============================= users.workerType ===========================

ALTER TABLE "users" ADD COLUMN "workerType" "WorkerType";

-- ============================= inventory_balances =========================

-- 1. waterType sütununu əlavə et (eski qeydlər FILTERED olur)
ALTER TABLE "inventory_balances" ADD COLUMN "waterType" "WaterType" NOT NULL DEFAULT 'FILTERED';

-- 2. Eski workerId unikalbəciliyini sil. It may exist either as a named
--    constraint (Prisma) or as a plain unique index (db push), so remove both
--    shapes; otherwise a worker could still hold only ONE water type.
ALTER TABLE "inventory_balances" DROP CONSTRAINT IF EXISTS "inventory_balances_workerId_key";
DROP INDEX IF EXISTS "inventory_balances_workerId_key";

-- 3. Yeni (key, waterType) unikalbəciyini yarad
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_key_waterType_key" UNIQUE ("key", "waterType");

-- 4. Eski keys'ləri composite key-ə çevir:
--    'WAREHOUSE'   -> 'WAREHOUSE:FILTERED'
--    'WORKER:<id>' -> 'WORKER:<id>:FILTERED'
UPDATE "inventory_balances" SET "key" = 'WAREHOUSE:FILTERED' WHERE "key" = 'WAREHOUSE';
UPDATE "inventory_balances" SET "key" = 'WORKER:' || "workerId" || ':FILTERED' WHERE "workerId" IS NOT NULL AND "key" LIKE 'WORKER:%';

-- ============================= inventory_transactions =====================

-- 1. waterType sütununu əlavə et
ALTER TABLE "inventory_transactions" ADD COLUMN "waterType" "WaterType" NOT NULL DEFAULT 'FILTERED';

-- 2. Eski balanceKey'ləri composite key-ə çevir
UPDATE "inventory_transactions" SET "balanceKey" = 'WAREHOUSE:FILTERED' WHERE "balanceKey" = 'WAREHOUSE';
UPDATE "inventory_transactions" SET "balanceKey" = 'WORKER:' || "workerId" || ':FILTERED' WHERE "workerId" IS NOT NULL AND "balanceKey" LIKE 'WORKER:%';

-- ============================= notifications ==============================

CREATE TABLE "notifications" (
  "id"           TEXT         NOT NULL,
  "userId"       TEXT         NOT NULL,
  "actorId"      TEXT         NOT NULL,
  "actorName"    TEXT         NOT NULL,
  "actorRole"    TEXT,
  "action"       TEXT         NOT NULL,
  "waterType"    "WaterType"  NOT NULL DEFAULT 'FILTERED',
  "bottleCount"  INTEGER      NOT NULL,
  "beforeBalance" INTEGER     NOT NULL,
  "afterBalance"  INTEGER     NOT NULL,
  "note"         TEXT,
  "relatedId"    TEXT,
  "read"         BOOLEAN      NOT NULL DEFAULT false,
  "createdAt"    TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "notifications_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");
CREATE INDEX "notifications_read_idx" ON "notifications"("read");
