-- ===========================================================================
-- Verification of the database-level integrity guards.
--
--   psql -U farah -d farah -v ON_ERROR_STOP=0 -f prisma/integrity-verify.sql
--
-- Each section deliberately attempts a forgery that the schema must REJECT.
-- A "PASS" notice means the guard did its job.
--
-- Two things to know when reading this script:
--  1. Prisma maps `String @id @default(uuid())` to `text`, not `uuid`, so
--     identifiers are declared as text here.
--  2. `updatedAt` has no database default (Prisma sets it client-side), so raw
--     writes must supply it.
--  3. Financial rows cannot be hard-deleted, so the fixture is created once,
--     reset to a known-good state on every run, and finally CANCELLED (the
--     legal way to retire it) rather than deleted.
-- ===========================================================================

\echo '=== setup: canonical fixture (total 20.00, paid 0.00, UNPAID) ==='

INSERT INTO customers (id, name, address, "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'Guard Test Customer', 'Guard Test St', NOW(), NOW())
ON CONFLICT DO NOTHING;

DO $$
DECLARE c text; w text; d text;
BEGIN
  SELECT id INTO c FROM customers WHERE name = 'Guard Test Customer' LIMIT 1;
  SELECT id INTO w FROM users ORDER BY "createdAt" LIMIT 1;

  DELETE FROM payments WHERE "deliveryId" IN (SELECT id FROM deliveries WHERE "idempotencyKey" = 'guard-1');

  SELECT id INTO d FROM deliveries WHERE "idempotencyKey" = 'guard-1';

  IF d IS NULL THEN
    INSERT INTO deliveries (id, "idempotencyKey", "customerId", "workerId", address,
                            "bottleCount", "unitPrice", "totalAmount", "paidAmount",
                            "debtAmount", status, "deliveredAt", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, 'guard-1', c, w, 'Guard Test St',
            10, 2.00, 20.00, 0, 20.00, 'UNPAID', NOW(), NOW(), NOW());
  ELSE
    -- Reset so the script is repeatable.
    UPDATE deliveries
       SET "customerId" = c, "workerId" = w, address = 'Guard Test St',
           "bottleCount" = 10, "unitPrice" = 2.00, "totalAmount" = 20.00,
           "paidAmount" = 0, "debtAmount" = 20.00, status = 'UNPAID',
           "cancelledAt" = NULL, "cancelReason" = NULL,
           "deliveredAt" = NOW(), "updatedAt" = NOW()
     WHERE id = d;
  END IF;
END $$;
\echo '  fixture ready'

\echo ''
\echo '=== 1. forge PAID status without any money (must FAIL) ==='
DO $$
DECLARE d text := (SELECT id FROM deliveries WHERE "idempotencyKey" = 'guard-1');
BEGIN
  BEGIN
    UPDATE deliveries SET status = 'PAID' WHERE id = d;
    RAISE EXCEPTION 'GUARD FAILED: forged PAID status was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  PASS: forged PAID status rejected by deliveries_status_consistent';
  END;
END $$;

\echo '=== 2. debt inconsistent with money (must FAIL) ==='
DO $$
DECLARE d text := (SELECT id FROM deliveries WHERE "idempotencyKey" = 'guard-1');
BEGIN
  BEGIN
    UPDATE deliveries SET "debtAmount" = 5.00 WHERE id = d;
    RAISE EXCEPTION 'GUARD FAILED: inconsistent debt was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  PASS: debt != total - paid rejected by deliveries_debt_consistent';
  END;
END $$;

\echo '=== 3. total not equal to bottles * price (must FAIL) ==='
DO $$
DECLARE d text := (SELECT id FROM deliveries WHERE "idempotencyKey" = 'guard-1');
BEGIN
  BEGIN
    UPDATE deliveries SET "totalAmount" = 19.99, "debtAmount" = 19.99 WHERE id = d;
    RAISE EXCEPTION 'GUARD FAILED: bad total was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  PASS: total != bottleCount * unitPrice rejected by deliveries_total_consistent';
  END;
END $$;

\echo '=== 4. negative stock balance (must FAIL) ==='
DO $$
BEGIN
  BEGIN
    UPDATE inventory_balances SET quantity = -1 WHERE "key" = 'WAREHOUSE';
    RAISE EXCEPTION 'GUARD FAILED: negative stock was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  PASS: negative stock rejected by inventory_balances_quantity_non_negative';
  END;
END $$;

\echo '=== 5. deleting a financial row (must FAIL) ==='
DO $$
DECLARE d text := (SELECT id FROM deliveries WHERE "idempotencyKey" = 'guard-1');
BEGIN
  BEGIN
    DELETE FROM deliveries WHERE id = d;
    RAISE EXCEPTION 'GUARD FAILED: financial row was deleted';
  EXCEPTION WHEN raise_exception THEN
    RAISE NOTICE '  PASS: DELETE blocked by deliveries_no_delete trigger';
  END;
END $$;

\echo '=== 6. deactivating an admin account (must FAIL) ==='
DO $$
DECLARE a text := (SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1);
BEGIN
  IF a IS NULL THEN
    RAISE NOTICE '  SKIP: no admin user exists';
  ELSE
    BEGIN
      UPDATE users SET "isActive" = false WHERE id = a;
      RAISE EXCEPTION 'GUARD FAILED: admin deactivation was allowed';
    EXCEPTION WHEN raise_exception THEN
      RAISE NOTICE '  PASS: admin deactivation blocked by trigger';
    END;
  END IF;
END $$;

\echo '=== 7. zero-amount payment (must FAIL) ==='
DO $$
DECLARE d text := (SELECT id FROM deliveries WHERE "idempotencyKey" = 'guard-1');
BEGIN
  BEGIN
    INSERT INTO payments (id, "idempotencyKey", "deliveryId", "customerId", "workerId",
                          amount, method, "paidAt", "recordedById", "createdAt")
    SELECT gen_random_uuid()::text, 'guard-pay-0', d,
           (SELECT "customerId" FROM deliveries WHERE id = d),
           (SELECT "workerId" FROM deliveries WHERE id = d),
           0, 'CASH', NOW(),
           (SELECT id FROM users ORDER BY "createdAt" LIMIT 1), NOW();
    RAISE EXCEPTION 'GUARD FAILED: zero payment was accepted';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  PASS: zero payment rejected by payments_amount_positive';
  END;
END $$;

\echo '=== 8. deliver stock without having it (must FAIL) ==='
DO $$
DECLARE u text := (SELECT id FROM users WHERE role = 'WORKER' ORDER BY "createdAt" LIMIT 1);
        k text := 'WORKER:' || (SELECT id FROM users WHERE role = 'WORKER' ORDER BY "createdAt" LIMIT 1);
BEGIN
  BEGIN
    INSERT INTO inventory_balances ("key", scope, "workerId", quantity, "updatedAt")
    VALUES (k, 'WORKER'::"BalanceScope", u, 0, NOW())
    ON CONFLICT ("key") DO NOTHING;

    -- The atomic statement must refuse to take the balance below zero.
    UPDATE inventory_balances
       SET quantity = quantity - 999999, "updatedAt" = NOW()
     WHERE "key" = k AND quantity - 999999 >= 0;

    IF NOT FOUND THEN
      RAISE NOTICE '  PASS: conditional UPDATE matched no rows, so stock cannot go negative';
    ELSE
      RAISE EXCEPTION 'GUARD FAILED: overspending stock was accepted';
    END IF;
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE '  PASS: rejected by CHECK constraint';
  END;
END $$;

\echo ''
\echo '=== cleanup: retire the fixture through the legal path (CANCELLED) ==='
DO $$
DECLARE d text := (SELECT id FROM deliveries WHERE "idempotencyKey" = 'guard-1');
BEGIN
  IF d IS NOT NULL THEN
    DELETE FROM payments WHERE "deliveryId" = d;
    UPDATE deliveries
       SET status = 'CANCELLED', "paidAmount" = 0, "debtAmount" = 0,
           "cancelledAt" = NOW(), "cancelReason" = 'integrity-verify: fixture retired',
           "updatedAt" = NOW()
     WHERE id = d;
    RAISE NOTICE '  fixture cancelled (kept as audit evidence, cannot be deleted by design)';
  END IF;
END $$;
\echo '  done'
