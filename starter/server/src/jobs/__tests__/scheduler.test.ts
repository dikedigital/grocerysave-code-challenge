import type { Pool } from 'pg';
import type { SyncRun } from '../../../../src/models';
import { createLogger, memorySink, type LogRecord } from '../../logger';
import { MAX_TIMER_DELAY_MS, startPriceSyncScheduler } from '../syncPrices';

const pool = {} as Pool; // never touched: the sync is a fake
const MINUTE = 60_000;
const run = (chainId: string, status: SyncRun['status'] = 'ok'): SyncRun => ({
  id: 1, chainId, startedAt: '2026-11-15T00:00:00.000Z', finishedAt: '2026-11-15T00:00:01.000Z', status, rowsIngested: 0, error: status === 'error' ? 'boom' : null,
});

/** A promise with its resolve/reject exposed. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let sink: ReturnType<typeof memorySink>;
let logger: ReturnType<typeof createLogger>;
const events = (name: string): LogRecord[] => sink.records.filter((record) => record.event === name);
const stops: (() => Promise<void>)[] = [];
/** Starts a scheduler that is always stopped after the test. */
function start(minutes: number, sync: (pool: Pool) => Promise<SyncRun[]>, onAfterSync?: (runs: SyncRun[]) => Promise<void> | void) {
  const stop = startPriceSyncScheduler(pool, minutes, onAfterSync, { sync, logger });
  stops.push(stop);
  return stop;
}

beforeEach(() => {
  jest.useFakeTimers();
  sink = memorySink();
  logger = createLogger({ level: 'debug', sinks: [sink] });
});
afterEach(async () => {
  while (stops.length > 0) await stops.pop()?.();
  jest.useRealTimers();
});

describe('startPriceSyncScheduler: timing', () => {
  it('first run one interval after the start, then once per interval', async () => {
    const sync = jest.fn(async () => [run('freshmart')]);
    start(1, sync);
    await jest.advanceTimersByTimeAsync(MINUTE - 1);
    expect(sync).toHaveBeenCalledTimes(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith(pool);
    await jest.advanceTimersByTimeAsync(2 * MINUTE);
    expect(sync).toHaveBeenCalledTimes(3);
  });

  it('works with a short interval (0.001 minutes = 60 ms)', async () => {
    const sync = jest.fn(async () => []);
    start(0.001, sync);
    await jest.advanceTimersByTimeAsync(600);
    expect(sync).toHaveBeenCalledTimes(10);
  });

  it.each([
    [0, 'the interval is 0 or negative'],
    [-5, 'the interval is 0 or negative'],
    [Number.NaN, 'the interval is not a number'],
    [Infinity, 'the interval is infinite'],
    [-Infinity, 'the interval is 0 or negative'],
  ])('does nothing when the interval is %p: no timer, no sync (%s)', async (minutes, reason) => {
    const sync = jest.fn(async () => []);
    const stop = start(minutes, sync);
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(365 * 24 * 60 * MINUTE);
    expect(sync).not.toHaveBeenCalled();
    await expect(stop()).resolves.toBeUndefined();
    expect(events('scheduler_disabled')).toEqual([expect.objectContaining({ level: 'info', reason })]);
  });

  it('caps an interval above the timer limit (~24.8 days) instead of firing every millisecond', async () => {
    const sync = jest.fn(async () => []);
    start(60 * 24 * 60, sync); // 60 days
    expect(events('scheduler_interval_capped')).toEqual([expect.objectContaining({ level: 'warn', delayMs: MAX_TIMER_DELAY_MS })]);
    await jest.advanceTimersByTimeAsync(MAX_TIMER_DELAY_MS - 1);
    expect(sync).toHaveBeenCalledTimes(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(sync).toHaveBeenCalledTimes(1);
  });
});

describe('startPriceSyncScheduler: never two syncs at once', () => {
  it('ticks that come while a sync runs are skipped (and logged); the next tick after it ends runs', async () => {
    const slow = deferred<SyncRun[]>();
    const sync = jest.fn().mockReturnValueOnce(slow.promise).mockResolvedValue([]);
    start(1, sync);
    await jest.advanceTimersByTimeAsync(MINUTE); // tick 1: sync starts and hangs
    await jest.advanceTimersByTimeAsync(3 * MINUTE); // ticks 2-4: skipped
    expect(sync).toHaveBeenCalledTimes(1);
    expect(events('scheduler_tick_skipped').map((record) => [record.level, record.tick])).toEqual([['warn', 2], ['warn', 3], ['warn', 4]]);
    slow.resolve([]);
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(MINUTE); // tick 5: runs
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('the after-sync callback counts as part of the run: a slow callback also blocks the next sync', async () => {
    const slowCallback = deferred();
    const sync = jest.fn(async () => []);
    const onAfterSync = jest.fn().mockReturnValueOnce(slowCallback.promise).mockResolvedValue(undefined);
    start(1, sync, onAfterSync);
    await jest.advanceTimersByTimeAsync(3 * MINUTE);
    expect([sync.mock.calls.length, onAfterSync.mock.calls.length]).toEqual([1, 1]);
    slowCallback.resolve();
    await jest.advanceTimersByTimeAsync(MINUTE);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('at most one sync is ever in progress, whatever the timing', async () => {
    let active = 0;
    let maxActive = 0;
    const sync = jest.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2.5 * MINUTE)); // longer than the interval
      active -= 1;
      return [];
    });
    const stop = start(1, sync);
    await jest.advanceTimersByTimeAsync(20 * MINUTE);
    expect(maxActive).toBe(1);
    expect(sync.mock.calls.length).toBeGreaterThanOrEqual(5);
    // stop() waits for the sync in progress, which sleeps on a fake timer: move time on meanwhile.
    const stopped = stop();
    await jest.advanceTimersByTimeAsync(3 * MINUTE);
    await stopped;
    expect(active).toBe(0);
  });
});

describe('startPriceSyncScheduler: the after-sync callback', () => {
  it('is called with the runs after each completed sync, including runs that ended in error', async () => {
    const order: string[] = [];
    const runs = [run('freshmart'), run('mystery', 'error')];
    const sync = jest.fn(async () => {
      order.push('sync');
      return runs;
    });
    const onAfterSync = jest.fn(async (received: SyncRun[]) => {
      order.push(`callback(${received.length})`);
    });
    start(1, sync, onAfterSync);
    await jest.advanceTimersByTimeAsync(2 * MINUTE);
    expect(order).toEqual(['sync', 'callback(2)', 'sync', 'callback(2)']);
    expect(onAfterSync).toHaveBeenCalledWith(runs);
    expect(events('scheduled_sync_completed')[0]).toMatchObject({ level: 'info', tick: 1, runs: 2, failed: ['mystery'] });
    expect(events('after_sync_completed').map((record) => record.tick)).toEqual([1, 2]);
  });

  it('is optional', async () => {
    const sync = jest.fn(async () => []);
    start(1, sync);
    await jest.advanceTimersByTimeAsync(MINUTE);
    expect(events('scheduled_sync_completed')).toHaveLength(1);
    expect(events('after_sync_completed')).toHaveLength(0);
  });
});

describe('startPriceSyncScheduler: errors are logged and swallowed', () => {
  let unhandled: unknown[];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  beforeEach(() => {
    unhandled = [];
    process.on('unhandledRejection', onUnhandled);
  });
  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
  });

  it.each([
    ['rejects with an Error', () => Promise.reject(new Error('database is down')), 'database is down'],
    ['throws synchronously', () => { throw new Error('thrown at once'); }, 'thrown at once'],
    ['rejects with undefined', () => Promise.reject(undefined), 'non-Error value thrown: undefined'],
  ])('a sync that %s: logged, no callback, and the next tick runs again', async (_label, failure, message) => {
    const sync = jest.fn().mockImplementationOnce(failure).mockResolvedValue([]);
    const onAfterSync = jest.fn();
    start(1, sync as (pool: Pool) => Promise<SyncRun[]>, onAfterSync);
    await jest.advanceTimersByTimeAsync(MINUTE);
    expect(onAfterSync).not.toHaveBeenCalled();
    expect(events('scheduled_sync_failed')).toEqual([expect.objectContaining({ level: 'error', tick: 1, error: message })]);
    await jest.advanceTimersByTimeAsync(MINUTE);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(onAfterSync).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(unhandled).toEqual([]);
  });

  it.each([
    ['throws', () => { throw new Error('notifications failed'); }],
    ['rejects', () => Promise.reject(new Error('notifications failed'))],
  ])('a callback that %s: logged, and the scheduler keeps running', async (_label, failure) => {
    const sync = jest.fn(async () => []);
    start(1, sync, jest.fn().mockImplementationOnce(failure).mockResolvedValue(undefined));
    await jest.advanceTimersByTimeAsync(2 * MINUTE);
    expect(sync).toHaveBeenCalledTimes(2);
    expect(events('after_sync_failed')).toEqual([expect.objectContaining({ level: 'error', tick: 1, error: 'notifications failed' })]);
    expect(events('after_sync_completed').map((record) => record.tick)).toEqual([2]);
    expect(unhandled).toEqual([]);
  });
});

describe('startPriceSyncScheduler: stopping', () => {
  it('the stop function clears the timer: no sync after it; calling it twice is harmless', async () => {
    const sync = jest.fn(async () => []);
    const stop = start(1, sync);
    await jest.advanceTimersByTimeAsync(MINUTE);
    await stop();
    await stop();
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(10 * MINUTE);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(events('scheduler_stopped')).toHaveLength(1);
  });

  it('stopping during a sync lets it (and its callback) finish; the stop promise resolves after them', async () => {
    const slow = deferred<SyncRun[]>();
    const order: string[] = [];
    const sync = jest.fn(() => slow.promise);
    const stop = start(1, sync, () => {
      order.push('callback');
    });
    await jest.advanceTimersByTimeAsync(MINUTE);
    const stopped = stop().then(() => order.push('stop resolved'));
    expect(events('scheduler_stopped')).toEqual([expect.objectContaining({ syncInProgress: true })]);
    order.push('sync finishing');
    slow.resolve([]);
    await stopped;
    expect(order).toEqual(['sync finishing', 'callback', 'stop resolved']);
    await jest.advanceTimersByTimeAsync(5 * MINUTE);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('logs scheduler_started with the interval', () => {
    start(15, jest.fn(async () => []));
    expect(events('scheduler_started')).toEqual([expect.objectContaining({ level: 'info', intervalMinutes: 15, delayMs: 15 * MINUTE })]);
  });
});

describe('startPriceSyncScheduler: the timer does not keep the process alive', () => {
  it('uses an unref\'d interval timer', async () => {
    jest.useRealTimers();
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    // Stopped in `finally`: if the assertion fails, a ref'd real timer would keep Jest from exiting.
    const stop = startPriceSyncScheduler(pool, 1, undefined, { sync: async () => [], logger });
    try {
      const handle = setIntervalSpy.mock.results[0].value as NodeJS.Timeout;
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), MINUTE);
      expect(handle.hasRef()).toBe(false);
    } finally {
      await stop();
      setIntervalSpy.mockRestore();
    }
  });
});
