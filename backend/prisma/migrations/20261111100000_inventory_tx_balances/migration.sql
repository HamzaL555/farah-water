-- Farah Water Company
-- Every inventory leg keeps the balance it moved FROM and TO, so the history
-- can show "200 -> 180" without replaying the whole ledger, and the numbers are
-- written by the server at the moment of the movement (never by a client).
--
-- Nullable on purpose: rows recorded before this migration cannot be given a
-- truthful before/after value, and inventing one would be worse than showing
-- a dash.

ALTER TABLE "inventory_transactions" ADD COLUMN "beforeBalance" INTEGER;
ALTER TABLE "inventory_transactions" ADD COLUMN "afterBalance" INTEGER;
