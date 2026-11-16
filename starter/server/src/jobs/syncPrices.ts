/**
 * Price sync (TECH_SPEC 4.2): reads every chain's mocked supermarket feed and stores the prices in
 * `price_history`, and the scheduler that runs it on a timer. Decisions D-86 to D-91 and D-93 to
 * D-97 in docs/DECISIONS.md.
 */
import type { Pool, PoolClient } from 'pg';
import type { SyncRun } from '../../../src/models';
import { config } from '../config';
import { errorMessage } from '../errors';
import { logger as rootLogger, type Logger } from '../logger';
import { fetchChainFeed, type FeedSnapshot } from '../providers';

export interface SyncOptions {
  /** Data folder holding `mock-api/<chain>/`; default config.dataDir (DATA_DIR, ./data). */
  dataDir?: string;
  /** Receives the log records; default the process logger (`app.sync`). */
  logger?: Logger;
  /** Rows per INSERT statement (default 5000, D-89); smaller values are for tests. */
  batchSize?: number;
}

/** One `price_history` row to upsert. */
export interface PriceRowInput {
  storeId: string;
  productId: string;
  price: number;
  regularPrice: number;
  onSale: boolean;
  /** The snapshot date, `YYYY-MM-DD`. */
  date: string;
}

export interface PriceRowsPlan {
  rows: PriceRowInput[];
  /** SKUs of the feed that are not in `products`, sorted (D-88). */
  unknownSkus: string[];
  /** Rows of the feed with an unknown SKU (all snapshots, before multiplying by stores). */
  unknownRowCount: number;
  /** SKUs that appear more than once in one snapshot: the last row wins (D-66). */
  duplicates: { date: string; sku: string }[];
}

/**
 * The rows to write for one chain (pure, no database): one per store of the chain, per snapshot,
 * per row whose SKU is in the catalog. Unknown SKUs are left out (spec) and reported; a SKU that
 * appears twice in a snapshot keeps its last row (D-66). Ordered by snapshot, then feed order,
 * then store.
 */
export function planPriceRows(snapshots: FeedSnapshot[], productIdBySku: ReadonlyMap<string, string>, storeIds: readonly string[]): PriceRowsPlan {
  const rows: PriceRowInput[] = [];
  const unknown = new Set<string>();
  let unknownRowCount = 0;
  const duplicates: { date: string; sku: string }[] = [];
  for (const snapshot of snapshots) {
    const lastBySku = new Map<string, FeedSnapshot['rows'][number]>();
    for (const row of snapshot.rows) {
      if (lastBySku.has(row.sku)) {
        duplicates.push({ date: snapshot.date, sku: row.sku });
        lastBySku.delete(row.sku); // re-inserted below so the order follows the last occurrence
      }
      lastBySku.set(row.sku, row);
    }
    for (const row of lastBySku.values()) {
      const productId = productIdBySku.get(row.sku);
      if (productId === undefined) {
        unknown.add(row.sku);
        unknownRowCount += 1;
        continue;
      }
      for (const storeId of storeIds) {
        rows.push({ storeId, productId, price: row.price, regularPrice: row.regularPrice, onSale: row.onSale, date: snapshot.date });
      }
    }
  }
  return { rows, unknownSkus: [...unknown].sort(), unknownRowCount, duplicates };
}

/** Largest number of rows sent in one INSERT (D-89). */
const BATCH_SIZE = 5000;

const UPSERT_SQL = `
  INSERT INTO price_history (store_id, product_id, price, regular_price, on_sale, effective_date)
  SELECT * FROM unnest($1::uuid[], $2::uuid[], $3::numeric[], $4::numeric[], $5::boolean[], $6::date[])
  ON CONFLICT (store_id, product_id, effective_date) DO UPDATE
    SET price = EXCLUDED.price, regular_price = EXCLUDED.regular_price, on_sale = EXCLUDED.on_sale, ingested_at = now()`;

/** Upserts the rows in batches inside the caller's transaction; returns the rows written. */
async function upsertPrices(client: PoolClient, rows: PriceRowInput[], batchSize: number): Promise<number> {
  let written = 0;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const result = await client.query(UPSERT_SQL, [
      batch.map((row) => row.storeId),
      batch.map((row) => row.productId),
      // Exact decimal text: the amounts are whole cents, so toFixed(2) is the feed's value.
      batch.map((row) => row.price.toFixed(2)),
      batch.map((row) => row.regularPrice.toFixed(2)),
      batch.map((row) => row.onSale),
      batch.map((row) => row.date),
    ]);
    written += result.rowCount ?? 0;
  }
  return written;
}

interface SyncRunRow {
  id: string | number;
  chain_id: string | null;
  started_at: Date | string;
  finished_at: Date | string | null;
  status: SyncRun['status'];
  rows_ingested: number;
  error: string | null;
}

const iso = (value: Date | string) => (value instanceof Date ? value : new Date(value)).toISOString();

/** A `sync_runs` row as the shared `SyncRun` model (camelCase, ISO timestamps, numeric id). */
export function toSyncRun(row: SyncRunRow): SyncRun {
  return {
    id: Number(row.id),
    chainId: row.chain_id,
    startedAt: iso(row.started_at),
    finishedAt: row.finished_at === null ? null : iso(row.finished_at),
    status: row.status,
    rowsIngested: Number(row.rows_ingested),
    error: row.error,
  };
}

export { errorMessage };

const RUN_COLUMNS = 'id, chain_id, started_at, finished_at, status, rows_ingested, error';
const syncLogger = rootLogger.child('sync');

/**
 * Syncs every chain in `chains` (ordered by id), each independently (TECH_SPEC 4.2): inserts a
 * `sync_runs` row (`running`), fetches the chain's feed, upserts into `price_history` one row per
 * store of the chain, per snapshot and per row whose SKU is in `products` (unknown SKUs ignored),
 * in one transaction per chain, then marks the run `ok` with `rows_ingested` (rows written) or
 * `error` with the message. A failing chain never stops the others. Resolves to the finished runs.
 * Rejects only when the chains or products cannot be read at all.
 *
 * Logs (D-91): `sync_started`, `sync_chain_ok`, `sync_finished` (info); `unknown_skus_ignored`,
 * `duplicate_skus`, `chain_has_no_stores` (warn); `sync_chain_failed`, `sync_failed`,
 * `sync_run_not_recorded` (error); the feed's own records under `app.sync.fetch...`.
 */
export async function syncPrices(pool: Pool, options: SyncOptions = {}): Promise<SyncRun[]> {
  const startedAt = Date.now();
  const dataDir = options.dataDir ?? config.dataDir;
  const log = options.logger ?? syncLogger;
  const batchSize = options.batchSize !== undefined && options.batchSize >= 1 ? Math.floor(options.batchSize) : BATCH_SIZE;

  let chains: { id: string; provider: string }[];
  let productIdBySku: Map<string, string>;
  try {
    chains = (await pool.query<{ id: string; provider: string }>('SELECT id, provider FROM chains ORDER BY id')).rows;
    const products = await pool.query<{ id: string; sku: string }>('SELECT id, sku FROM products');
    productIdBySku = new Map(products.rows.map((row) => [row.sku, row.id]));
  } catch (error) {
    log.error('sync_failed', `price sync could not start: ${errorMessage(error)}`, { dataDir });
    throw error;
  }
  log.info('sync_started', `price sync started: ${chains.length} chains, ${productIdBySku.size} products, data ${dataDir}`, {
    chains: chains.length,
    products: productIdBySku.size,
    dataDir,
  });

  const runs: SyncRun[] = [];
  for (const chain of chains) {
    const chainStartedAt = Date.now();
    const chainLog = log.child(chain.id, { chain: chain.id, provider: chain.provider });
    let runId: number;
    try {
      const inserted = await pool.query<{ id: string }>("INSERT INTO sync_runs (chain_id, status) VALUES ($1, 'running') RETURNING id", [chain.id]);
      runId = Number(inserted.rows[0].id);
    } catch (error) {
      chainLog.error('sync_run_not_recorded', `chain ${chain.id}: the sync run could not be recorded, chain skipped: ${errorMessage(error)}`, {});
      continue;
    }

    let outcome: { status: 'ok'; rows: number } | { status: 'error'; message: string };
    let client: PoolClient | null = null;
    try {
      const snapshots = await fetchChainFeed(chain, dataDir, { logger: chainLog });
      const stores = await pool.query<{ id: string }>('SELECT id FROM stores WHERE chain_id = $1 ORDER BY name, id', [chain.id]);
      const storeIds = stores.rows.map((row) => row.id);
      if (storeIds.length === 0) {
        chainLog.warn('chain_has_no_stores', `chain ${chain.id} has no stores: nothing to write`, { runId });
      }
      const plan = planPriceRows(snapshots, productIdBySku, storeIds);
      if (plan.unknownSkus.length > 0) {
        chainLog.warn(
          'unknown_skus_ignored',
          `chain ${chain.id}: ${plan.unknownRowCount} feed row(s) with SKUs not in the catalog ignored: ${plan.unknownSkus.join(', ')}`,
          { runId, skus: plan.unknownSkus, rows: plan.unknownRowCount },
        );
      }
      if (plan.duplicates.length > 0) {
        chainLog.warn(
          'duplicate_skus',
          `chain ${chain.id}: ${plan.duplicates.length} SKU(s) repeated within a snapshot; the last row of each was kept`,
          { runId, duplicates: plan.duplicates },
        );
      }
      client = await pool.connect();
      await client.query('BEGIN');
      const written = await upsertPrices(client, plan.rows, batchSize);
      await client.query('COMMIT');
      outcome = { status: 'ok', rows: written };
      chainLog.info(
        'sync_chain_ok',
        `chain ${chain.id}: ${written} price rows written (${snapshots.length} snapshot(s) x ${storeIds.length} store(s))`,
        { runId, snapshots: snapshots.length, stores: storeIds.length, rowsWritten: written, durationMs: Date.now() - chainStartedAt },
      );
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => undefined);
      const message = errorMessage(error);
      outcome = { status: 'error', message };
      chainLog.error('sync_chain_failed', `chain ${chain.id}: sync failed, no prices written: ${message}`, {
        runId,
        error: message,
        durationMs: Date.now() - chainStartedAt,
      });
    } finally {
      client?.release();
    }

    try {
      const finished = await pool.query<SyncRunRow>(
        `UPDATE sync_runs SET status = $2, rows_ingested = $3, error = $4, finished_at = now() WHERE id = $1 RETURNING ${RUN_COLUMNS}`,
        outcome.status === 'ok' ? [runId, 'ok', outcome.rows, null] : [runId, 'error', 0, outcome.message],
      );
      runs.push(toSyncRun(finished.rows[0]));
    } catch (error) {
      chainLog.error('sync_run_not_recorded', `chain ${chain.id}: run ${runId} could not be marked ${outcome.status}: ${errorMessage(error)}`, { runId });
    }
  }

  const ok = runs.filter((run) => run.status === 'ok');
  const failed = runs.filter((run) => run.status === 'error');
  const rows = ok.reduce((sum, run) => sum + run.rowsIngested, 0);
  const summary = `price sync finished: ${ok.length} ok, ${failed.length} failed, ${rows} price rows written`;
  const fields = {
    ok: ok.length,
    failed: failed.map((run) => run.chainId),
    rowsWritten: rows,
    runIds: runs.map((run) => run.id),
    durationMs: Date.now() - startedAt,
  };
  if (failed.length > 0) log.warn('sync_finished', summary, fields);
  else log.info('sync_finished', summary, fields);
  return runs;
}

/** Longest delay a Node.js timer accepts (about 24.8 days); a longer one fires after 1 ms instead. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

export interface SchedulerOptions {
  /** The sync to run on each tick (default `syncPrices`); tests pass a fake. */
  sync?: (pool: Pool) => Promise<SyncRun[]>;
  /** Receives the scheduler's log records; default the process logger (`app.scheduler`). */
  logger?: Logger;
}

const schedulerLogger = rootLogger.child('scheduler');

/**
 * Runs `syncPrices` every `intervalMinutes` (TECH_SPEC 4.2, decisions D-94 to D-97):
 *
 * - the first run is one interval after the start; the timer is unref'd, so it never keeps the
 *   process alive on its own;
 * - never two at once: a tick that comes while a sync (or its `onAfterSync`) is still running is
 *   skipped and logged (`scheduler_tick_skipped`, warn);
 * - errors are logged and swallowed: a rejected sync (`scheduled_sync_failed`) or a failing
 *   `onAfterSync` (`after_sync_failed`) never stops the timer or becomes an unhandled rejection;
 * - `onAfterSync(runs)` is called after each completed sync (also when some chains ended in
 *   `error`), not when the sync itself rejects;
 * - does nothing when `intervalMinutes` is 0, negative, NaN or infinite (`scheduler_disabled`);
 *   an interval above the timer limit (~24.8 days) is capped (warn).
 *
 * Returns the stop function: it clears the timer, may be called more than once, and resolves once a
 * sync (and its callback) in progress has finished, so a caller can await it before closing the pool.
 */
export function startPriceSyncScheduler(
  pool: Pool,
  intervalMinutes: number,
  onAfterSync?: (runs: SyncRun[]) => Promise<void> | void,
  options: SchedulerOptions = {},
): () => Promise<void> {
  const log = options.logger ?? schedulerLogger;
  const sync = options.sync ?? ((target: Pool) => syncPrices(target));

  if (typeof intervalMinutes !== 'number' || !Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
    const reason = typeof intervalMinutes !== 'number' || Number.isNaN(intervalMinutes)
      ? 'the interval is not a number'
      : intervalMinutes === Infinity ? 'the interval is infinite' : 'the interval is 0 or negative';
    log.info('scheduler_disabled', `price sync scheduler disabled: ${reason} (${String(intervalMinutes)} minutes)`, {
      intervalMinutes: String(intervalMinutes),
      reason,
    });
    return async () => undefined;
  }

  let delayMs = Math.max(1, Math.round(intervalMinutes * 60_000));
  if (delayMs > MAX_TIMER_DELAY_MS) {
    log.warn('scheduler_interval_capped', `price sync interval of ${intervalMinutes} minutes exceeds the timer limit: capped to ${MAX_TIMER_DELAY_MS} ms (about 24.8 days)`, {
      intervalMinutes,
      delayMs: MAX_TIMER_DELAY_MS,
    });
    delayMs = MAX_TIMER_DELAY_MS;
  }

  let stopped = false;
  let current: Promise<void> | null = null;
  let ticks = 0;

  const runOnce = async (tick: number) => {
    const startedAt = Date.now();
    let runs: SyncRun[];
    try {
      runs = await sync(pool);
    } catch (error) {
      log.error('scheduled_sync_failed', `scheduled price sync #${tick} failed (the scheduler keeps running): ${errorMessage(error)}`, {
        tick,
        error: errorMessage(error),
        durationMs: Date.now() - startedAt,
      });
      return;
    }
    const failed = runs.filter((run) => run.status === 'error').map((run) => run.chainId);
    log.info('scheduled_sync_completed', `scheduled price sync #${tick} completed: ${runs.length} runs, ${failed.length} failed`, {
      tick,
      runs: runs.length,
      failed,
      durationMs: Date.now() - startedAt,
    });
    if (!onAfterSync) return;
    const callbackStartedAt = Date.now();
    try {
      await onAfterSync(runs);
      log.info('after_sync_completed', `after-sync callback of sync #${tick} completed`, { tick, durationMs: Date.now() - callbackStartedAt });
    } catch (error) {
      log.error('after_sync_failed', `after-sync callback of sync #${tick} failed (the scheduler keeps running): ${errorMessage(error)}`, {
        tick,
        error: errorMessage(error),
      });
    }
  };

  const timer = setInterval(() => {
    // No "stopped" check needed: stop() clears this interval, and a cleared interval never fires.
    ticks += 1;
    if (current) {
      log.warn('scheduler_tick_skipped', `price sync tick #${ticks} skipped: the previous sync is still running (interval ${delayMs} ms)`, {
        tick: ticks,
        delayMs,
      });
      return;
    }
    const tick = ticks;
    // runOnce catches everything it awaits; the extra catch guards against a bug becoming an
    // unhandled rejection.
    current = runOnce(tick)
      .catch((error) => log.error('scheduled_sync_failed', `scheduled price sync #${tick} failed: ${errorMessage(error)}`, { tick }))
      .finally(() => {
        current = null;
      });
  }, delayMs);
  timer.unref();
  log.info('scheduler_started', `price sync scheduler started: every ${intervalMinutes} minute(s) (${delayMs} ms), first run in ${delayMs} ms`, {
    intervalMinutes,
    delayMs,
  });

  return async () => {
    if (!stopped) {
      stopped = true;
      clearInterval(timer);
      log.info('scheduler_stopped', `price sync scheduler stopped after ${ticks} tick(s)${current ? '; waiting for the sync in progress' : ''}`, {
        ticks,
        syncInProgress: current !== null,
      });
    }
    await current;
  };
}
