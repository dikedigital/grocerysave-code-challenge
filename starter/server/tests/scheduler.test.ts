import type { Pool } from 'pg';
import type { SyncRun } from '../../src/models';
import { seedCatalog } from '../src/db/seed';
import { startPriceSyncScheduler } from '../src/jobs/syncPrices';
import { createLogger, memorySink } from '../src/logger';
import { count, resetDatabase, testPool } from './helpers/db';

jest.setTimeout(60000);

let pool: Pool;
beforeAll(() => {
  pool = testPool();
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await resetDatabase(pool);
  await seedCatalog(pool, { logger: createLogger({ level: 'silent', sinks: [] }) });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Waits until `condition()` holds, checking every 25 ms; fails after `timeoutMs`. */
async function waitFor(condition: () => boolean, timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await sleep(25);
  }
}

describe('startPriceSyncScheduler with the real syncPrices and database (short intervals)', () => {
  it('runs the sync on a 300 ms interval, calls back after each, and stops cleanly', async () => {
    const syncs: SyncRun[][] = [];
    const sink = memorySink();
    const stop = startPriceSyncScheduler(pool, 0.005, (runs) => {
      syncs.push(runs);
    }, { logger: createLogger({ level: 'info', sinks: [sink] }) });
    await waitFor(() => syncs.length >= 2);
    await stop();

    const completed = syncs.length;
    expect(completed).toBeGreaterThanOrEqual(2);
    for (const runs of syncs) {
      expect(runs.map((run) => [run.chainId, run.status])).toEqual(
        ['budgetbasket', 'citypantry', 'cornercoop', 'freshmart', 'greenleaf', 'harvest', 'sunrise', 'valugrocer'].map((id) => [id, 'ok']),
      );
    }
    expect(await count(pool, 'sync_runs')).toBe(completed * 8);
    expect(await count(pool, 'price_history')).toBe(1136);

    // Stopped: no further sync, however long we wait.
    await sleep(1000);
    expect(await count(pool, 'sync_runs')).toBe(completed * 8);
    expect(syncs).toHaveLength(completed);
    expect(sink.records.filter((record) => record.event === 'scheduled_sync_completed')).toHaveLength(completed);
    // Stopping is the last thing logged: nothing ran after it.
    expect(sink.records.at(-1)).toMatchObject({ event: 'scheduler_stopped', level: 'info' });
    expect(sink.records.filter((record) => record.event === 'scheduler_stopped')).toHaveLength(1);
  });

  it('a 30 ms interval, far shorter than a sync: ticks are skipped and no two syncs ever overlap', async () => {
    const syncs: SyncRun[][] = [];
    const sink = memorySink();
    const stop = startPriceSyncScheduler(pool, 0.0005, (runs) => {
      syncs.push(runs);
    }, { logger: createLogger({ level: 'info', sinks: [sink] }) });
    await waitFor(() => syncs.length >= 4);
    await stop();

    expect(sink.records.filter((record) => record.event === 'scheduler_tick_skipped').length).toBeGreaterThan(0);
    // Each sync's first run starts after the previous sync's last run finished.
    for (let i = 1; i < syncs.length; i += 1) {
      const previousEnd = Math.max(...syncs[i - 1].map((run) => Date.parse(run.finishedAt as string)));
      const nextStart = Math.min(...syncs[i].map((run) => Date.parse(run.startedAt)));
      expect(nextStart).toBeGreaterThanOrEqual(previousEnd);
    }
    // The table agrees: runs never overlap in time, and every run finished.
    const { rows } = await pool.query<{ overlapping: string }>(`
      SELECT count(*) AS overlapping FROM sync_runs a JOIN sync_runs b
        ON a.id < b.id AND b.started_at < a.finished_at AND a.finished_at IS NOT NULL`);
    expect(Number(rows[0].overlapping)).toBe(0);
    expect(await count(pool, 'sync_runs', "WHERE status <> 'ok' OR finished_at IS NULL")).toBe(0);
  });

  it('a chain in error does not stop the scheduler: the callback still gets every run', async () => {
    await pool.query("INSERT INTO chains (id, name, provider) VALUES ('mystery', 'Mystery Mart', 'toString')");
    const syncs: SyncRun[][] = [];
    const stop = startPriceSyncScheduler(pool, 0.005, (runs) => {
      syncs.push(runs);
    }, { logger: createLogger({ level: 'silent', sinks: [] }) });
    await waitFor(() => syncs.length >= 2);
    await stop();
    for (const runs of syncs) {
      expect(runs).toHaveLength(9);
      expect(runs.find((run) => run.chainId === 'mystery')).toMatchObject({ status: 'error' });
      expect(runs.filter((run) => run.status === 'ok')).toHaveLength(8);
    }
  });

  it('interval 0 starts nothing: no sync runs at all', async () => {
    const stop = startPriceSyncScheduler(pool, 0, () => undefined, { logger: createLogger({ level: 'silent', sinks: [] }) });
    await sleep(500);
    await stop();
    expect(await count(pool, 'sync_runs')).toBe(0);
  });
});
