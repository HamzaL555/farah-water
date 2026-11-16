-- Farah Water Company
-- The warehouse ledger is append-only, not just delete-proof.
--
-- `inventory_transactions_no_delete` already stopped DELETE. A direct UPDATE
-- could still rewrite the count, the water type or the timestamp of an old
-- movement and leave the balance history lying. A mistake is corrected by
-- writing a NEW transaction (a correction leg), never by editing the old row.
--
-- TRUNCATE is deliberately unaffected: the integration suite uses it to reset
-- its scratch database, and TRUNCATE does not fire row-level triggers.

CREATE OR REPLACE FUNCTION farah_prevent_inventory_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Anbar tarixcesi deyisdirile bilmez. Duzelis ucun yeni emeliyyat yazin.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inventory_transactions_no_update ON "inventory_transactions";
CREATE TRIGGER inventory_transactions_no_update
  BEFORE UPDATE ON "inventory_transactions"
  FOR EACH ROW EXECUTE FUNCTION farah_prevent_inventory_update();
