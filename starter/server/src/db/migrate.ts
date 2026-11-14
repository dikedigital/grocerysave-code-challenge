import fs from 'node:fs';
import path from 'node:path';
import type { Pool } from 'pg';
import { config } from '../config';

export interface MigrateOptions {
  /** Drop everything in the public schema first. Used by tests and `npm run db:reset`. */
  reset?: boolean;
}

/** Applies every .sql file in server/migrations that has not run yet, in filename order. */
export async function migrate(pool: Pool, options: MigrateOptions = {}): Promise<string[]> {
  if (options.reset) {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await pool.query<{ name: string }>('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.name));

  const files = fs
    .readdirSync(config.migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const ran: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(config.migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      ran.push(file);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  return ran;
}
