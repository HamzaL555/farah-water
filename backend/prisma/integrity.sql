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
