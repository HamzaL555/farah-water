/** Proves the guard rejects the production URL and accepts a local one. */
import { describe, it, expect } from 'vitest';
import { assertSafeTestDatabase } from '../helpers/test-db-guard';

/**
 * A representative managed-host URL. Deliberately not the real deployment
 * host: this file is committed to a public repository and a hostname is still
 * an unnecessary disclosure.
 */
const PROD = 'postgresql://user:pw@ep-example123-pooler.c-99.eu-central-1.aws.neon.tech/proddb?sslmode=require';

describe('test database guard', () => {
  it('rejects the live Neon URL outright, with no opt-in available', () => {
    const original = process.env.I_UNDERSTAND;
    process.env.I_UNDERSTAND = 'DELETE_ALL';
    try {
      expect(() => assertSafeTestDatabase(PROD)).toThrow(/REFUSING TO RUN/);
      expect(() => assertSafeTestDatabase(PROD)).toThrow(/Neon managed instance/);
    } finally {
      if (original === undefined) delete process.env.I_UNDERSTAND;
      else process.env.I_UNDERSTAND = original;
    }
  });

  it('rejects other managed hosts', () => {
    for (const url of [
      'postgresql://a:b@db.abc123.us-east-1.rds.amazonaws.com:5432/farah_test',
      'postgresql://a:b@xyz.supabase.co:5432/postgres',
      'postgresql://a:b@gcp-project.cloudsql.google.com:5432/farah_test',
    ]) {
      expect(() => assertSafeTestDatabase(url), url).toThrow(/REFUSING TO RUN/);
    }
  });

  it('rejects a non-local host without the explicit opt-in', () => {
    const original = process.env.I_UNDERSTAND;
    delete process.env.I_UNDERSTAND;
    try {
      expect(() => assertSafeTestDatabase('postgresql://a:b@db.example.com:5432/farah_test')).toThrow(
        /Only a local database is allowed/,
      );
    } finally {
      if (original !== undefined) process.env.I_UNDERSTAND = original;
    }
  });

  it('rejects a local database with the wrong name', () => {
    expect(() => assertSafeTestDatabase('postgresql://a:b@localhost:5432/neondb')).toThrow(
      /must be named/,
    );
  });

  it('accepts the intended local scratch database', () => {
    const r = assertSafeTestDatabase('postgresql://postgres:postgres@localhost:5432/farah_test');
    expect(r.host).toBe('localhost');
    expect(r.database).toBe('farah_test');
  });

  it('accepts container-local hostnames', () => {
    expect(() => assertSafeTestDatabase('postgresql://a:b@host.docker.internal:5432/farah_test')).not.toThrow();
  });

  it('rejects an empty URL', () => {
    expect(() => assertSafeTestDatabase('')).toThrow(/DATABASE_URL is empty/);
  });
});
