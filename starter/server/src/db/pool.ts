import { Pool, types } from 'pg';
import { config } from '../config';

// Return NUMERIC as JS numbers (prices have two decimals, quantities three) and DATE as 'YYYY-MM-DD'.
types.setTypeParser(1700, (value) => Number(value));
types.setTypeParser(1082, (value) => value);

export type Db = Pool;

export function createPool(connectionString: string = config.databaseUrl): Pool {
  return new Pool({ connectionString, max: 10 });
}

let shared: Pool | null = null;

/** Process-wide pool for the running server and CLI scripts. Tests create their own with createPool(). */
export function getPool(): Pool {
  if (!shared) shared = createPool();
  return shared;
}

export async function closePool(): Promise<void> {
  if (shared) {
    await shared.end();
    shared = null;
  }
}
