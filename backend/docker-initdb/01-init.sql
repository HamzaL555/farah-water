-- Runs once, on first initialisation of an empty Postgres data directory.
-- The database lives in a named volume, so this only ever runs on a truly
-- fresh install. Existing data is never touched.

ALTER DATABASE farah SET timezone TO 'UTC';
