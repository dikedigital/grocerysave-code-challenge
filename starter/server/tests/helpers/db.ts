/**
 * Database helpers for the API / integration tests (Jest project `api`, run in band).
 * The tests wipe the database: it must be TEST_DATABASE_URL, and its name must contain "test" (D-90).
 */
import type { Pool } from 'pg';
import { config } from '../../src/config';
import { migrate } from '../../src/db/migrate';
import { createPool } from '../../src/db/pool';

/** TEST_DATABASE_URL (config.testDatabaseUrl); throws when unset or when the name lacks "test". */
export function testDatabaseUrl(): string {
  const url = config.testDatabaseUrl;
  if (!url) throw new Error('TEST_DATABASE_URL is not set: the API tests need a Postgres database they may wipe');
  const name = new URL(url).pathname.slice(1);
  if (!name.includes('test')) {
    throw new Error(`refusing to wipe database "${name}": the test database name must contain "test"`);
  }
  return url;
}

/** A pool on the test database. */
export function testPool(): Pool {
  return createPool(testDatabaseUrl());
}

/** Drops everything in the test database and applies the migrations. */
export async function resetDatabase(pool: Pool): Promise<void> {
  testDatabaseUrl();
  await migrate(pool, { reset: true });
}

/** Row count of a table or view. */
export async function count(pool: Pool, relation: string, where = ''): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${relation} ${where}`);
  return Number(rows[0].n);
}
