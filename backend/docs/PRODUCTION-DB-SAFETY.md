# ⚠️ Production database safety

**Never run `npm run test:integration` while `.env` points at the live database.**

The integration suite issues `TRUNCATE ... CASCADE` against every table before
it starts (`tests/integration/setup.ts` → `resetDb()`). `DATABASE_URL` in
`backend/.env` is the live Neon database, so a plain test run erases production
data and replaces the `admin` account with a test fixture.

A guard now blocks this (`tests/helpers/test-db-guard.ts`), enforced twice: once
in `vitest.config.ts` before the suite boots, and again in `setup.ts` next to the
destructive call. It refuses to run when:

| Condition | Example |
|---|---|
| Empty `DATABASE_URL` | — |
| A managed host | `*.neon.tech`, `*.supabase.co`, `*.rds.amazonaws.com`, `*.cloudsql.google.com`, `*.planetscale.com`, … |
| A non-local host without `I_UNDERSTAND=DELETE_ALL=1` | `db.example.com` |
| A local database with the wrong name | must be `farah_test` |

Managed-host refusals have **no** opt-in: a hosted database is treated as
production by default.

## Running the integration suite safely

Point `DATABASE_URL` at a local throwaway database, for example:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/farah_test
```

Then:

```powershell
npm run test:integration
```

## Keeping production credentials out of the test path

Better still, keep the live URL in a separate file so `dotenv` never loads it
during tests. See `docs/TESTING.md`.

## If the guard ever trips on a database you own

Verify the host really is disposable before setting `I_UNDERSTAND=DELETE_ALL=1`.
It does not work for managed hosts, on purpose.
