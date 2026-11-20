-- Customer address pin (optional). NULL means "use the address text".
ALTER TABLE "customers" ADD COLUMN "latitude" DECIMAL(9, 6);
ALTER TABLE "customers" ADD COLUMN "longitude" DECIMAL(9, 6);

-- Bottle deposits are now per water type so Bulaq and Filtr balances cannot
-- be mixed. The table was empty in production when this ran; the default keeps
-- any older row readable if it was not.
ALTER TABLE "customer_deposits" ADD COLUMN "waterType" "WaterType" NOT NULL DEFAULT 'FILTERED';

CREATE INDEX "customer_deposits_customerId_waterType_occurredAt_idx"
  ON "customer_deposits"("customerId", "waterType", "occurredAt");
