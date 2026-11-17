import type { Pool, PoolClient } from 'pg';

/**
 * Runs `work` in one transaction on one pooled client (D-104): COMMIT when it resolves, ROLLBACK
 * when it throws (and rethrows). If the ROLLBACK itself fails, the client is discarded instead of
 * going back to the pool in an unknown state.
 */
export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError: Error) => {
      broken = rollbackError;
    });
    throw error;
  } finally {
    client.release(broken);
  }
}
