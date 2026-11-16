import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCsvRecords } from '../../../../src/utils/csv';
import { GOLDEN_CHAINS, GOLDEN_PRODUCTS } from '../../../../tests/fixtures/spreadsheet';
import { config } from '../../config';
import { createLogger, memorySink, type LogRecord } from '../../logger';
import { fetchChainFeed, MOCK_API_DIR, type FeedSnapshot } from '../index';

const STANDARD = 'sku,product_name,price,regular_price,on_sale\n';
const CENTS = 'item_code;description;price_cents;promo_price_cents\n';
const FLYER = 'SKU,Name,Unit Price,Sale?,Was\n';

let dataDir: string;
beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gs-feeds-'));
});
afterEach(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** Writes `<dataDir>/mock-api/<chain>/<name>` (creating folders) and returns its path. */
function write(chain: string, name: string, content: string): string {
  const folder = path.join(dataDir, MOCK_API_DIR, chain);
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, name);
  fs.writeFileSync(file, content);
  return file;
}

/** Fetches with a capturing logger. */
async function fetchLogged(chain: { id: string; provider: string }, dir: string = dataDir) {
  const sink = memorySink();
  const snapshots = await fetchChainFeed(chain, dir, { logger: createLogger({ level: 'debug', sinks: [sink] }) });
  return { snapshots, records: sink.records };
}
/** The rejection of a fetch, with the records logged on the way. */
async function rejectionOf(chain: unknown, dir: string = dataDir) {
  const sink = memorySink();
  try {
    await fetchChainFeed(chain as { id: string; provider: string }, dir, { logger: createLogger({ level: 'debug', sinks: [sink] }) });
  } catch (error) {
    return { error: error as Error, records: sink.records };
  }
  throw new Error('fetchChainFeed did not reject');
}
const events = (records: LogRecord[], event: string) => records.filter((record) => record.event === event);

describe('fetchChainFeed: reading a chain folder (temporary data folder)', () => {
  it('MOCK_API_DIR is "mock-api"', () => {
    expect(MOCK_API_DIR).toBe('mock-api');
  });

  it('reads every <YYYY-MM-DD>.csv, sorted by date ascending (whatever order the folder lists them in)', async () => {
    write('fresh', '2026-11-09.csv', `${STANDARD}GS-001,Milk,3.20,,false\n`);
    write('fresh', '2025-12-31.csv', `${STANDARD}GS-001,Milk,2.90,,false\n`);
    write('fresh', '2026-10-19.csv', `${STANDARD}GS-001,Milk,2.99,3.20,true\n,bad,1,,false\n`);
    // Many file systems list names alphabetically, which would hide a missing sort: list them in
    // a fixed non-sorted order instead (the real listing, rearranged).
    const realReaddir = fs.promises.readdir;
    const order = ['2026-10-19.csv', '2026-11-09.csv', '2025-12-31.csv'];
    const readdir = jest.spyOn(fs.promises, 'readdir').mockImplementation((async (...args: Parameters<typeof realReaddir>) => {
      const entries = (await realReaddir(...args)) as unknown as fs.Dirent[];
      return [...entries].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
    }) as unknown as typeof realReaddir);
    let snapshots: FeedSnapshot[];
    try {
      snapshots = await fetchChainFeed({ id: 'fresh', provider: 'standard' }, dataDir);
      expect(readdir).toHaveBeenCalledTimes(1);
    } finally {
      readdir.mockRestore();
    }
    expect(snapshots).toEqual([
      { date: '2025-12-31', rows: [{ sku: 'GS-001', price: 2.9, regularPrice: 2.9, onSale: false }], skipped: 0 },
      { date: '2026-10-19', rows: [{ sku: 'GS-001', price: 2.99, regularPrice: 3.2, onSale: true }], skipped: 1 },
      { date: '2026-11-09', rows: [{ sku: 'GS-001', price: 3.2, regularPrice: 3.2, onSale: false }], skipped: 0 },
    ]);
  });

  it('parses each file with the chain\'s provider (standard, cents, flyer)', async () => {
    write('a', '2026-11-09.csv', `${STANDARD}GS-001,Milk,4.99,5.89,true\n`);
    write('b', '2026-11-09.csv', `${CENTS}GS-001;MILK;589;499\n`);
    write('c', '2026-11-09.csv', `${FLYER}GS-001,Milk,$4.99,Y,$5.89\n`);
    const expected = [{ date: '2026-11-09', rows: [{ sku: 'GS-001', price: 4.99, regularPrice: 5.89, onSale: true }], skipped: 0 }];
    expect(await fetchChainFeed({ id: 'a', provider: 'standard' }, dataDir)).toEqual(expected);
    expect(await fetchChainFeed({ id: 'b', provider: 'cents' }, dataDir)).toEqual(expected);
    expect(await fetchChainFeed({ id: 'c', provider: 'flyer' }, dataDir)).toEqual(expected);
    // The wrong provider for a file: every row skipped (logged as header_invalid), not a crash.
    expect(await fetchChainFeed({ id: 'b', provider: 'standard' }, dataDir)).toEqual([{ date: '2026-11-09', rows: [], skipped: 1 }]);
  });

  it('ignores every other entry: other names, impossible dates, folders and symbolic links', async () => {
    const real = write('x', '2026-11-09.csv', `${CENTS}GS-001;MILK;360;\n`);
    for (const name of [
      'notes.txt', 'README.md', 'latest.csv', '2026-11-09.csv.bak', '2026-11-09.CSV', '2026-1-9.csv',
      '20261109.csv', '2026-11-09 .csv', '.2026-11-09.csv', '2026-02-30.csv', '2026-13-01.csv', '2026-02-29.csv', '2026-00-10.csv',
    ]) {
      write('x', name, `${CENTS}GS-999;NEVER READ;100;\n`);
    }
    fs.mkdirSync(path.join(dataDir, MOCK_API_DIR, 'x', '2026-12-01.csv'));
    fs.symlinkSync(real, path.join(dataDir, MOCK_API_DIR, 'x', '2026-12-08.csv'));
    write('x', '2028-02-29.csv', `${CENTS}GS-002;LEAP;200;\n`);

    const { snapshots, records } = await fetchLogged({ id: 'x', provider: 'cents' });
    expect(snapshots.map((snapshot) => snapshot.date)).toEqual(['2026-11-09', '2028-02-29']);
    expect(snapshots.flatMap((snapshot) => snapshot.rows.map((row) => row.sku))).toEqual(['GS-001', 'GS-002']);
    const ignored = events(records, 'file_ignored').map((record) => [path.basename(String(record.file)), record.reason, record.level]);
    expect(ignored.sort()).toEqual(
      [
        ['.2026-11-09.csv', 'not_a_snapshot_name', 'info'],
        ['20261109.csv', 'not_a_snapshot_name', 'info'],
        ['2026-00-10.csv', 'invalid_date', 'warn'],
        ['2026-02-29.csv', 'invalid_date', 'warn'],
        ['2026-02-30.csv', 'invalid_date', 'warn'],
        ['2026-1-9.csv', 'not_a_snapshot_name', 'info'],
        ['2026-11-09 .csv', 'not_a_snapshot_name', 'info'],
        ['2026-11-09.CSV', 'not_a_snapshot_name', 'info'],
        ['2026-11-09.csv.bak', 'not_a_snapshot_name', 'info'],
        ['2026-12-01.csv', 'not_a_regular_file', 'warn'],
        ['2026-12-08.csv', 'not_a_regular_file', 'warn'],
        ['2026-13-01.csv', 'invalid_date', 'warn'],
        ['README.md', 'not_a_snapshot_name', 'info'],
        ['latest.csv', 'not_a_snapshot_name', 'info'],
        ['notes.txt', 'not_a_snapshot_name', 'info'],
      ].sort(),
    );
  });

  it('dates are checked as real calendar dates in every year, including years below 100', async () => {
    write('old', '0099-12-31.csv', `${CENTS}GS-001;MILK;100;\n`);
    write('old', '0099-02-29.csv', `${CENTS}GS-001;MILK;100;\n`);
    write('old', '2026-11-09.csv', `${CENTS}GS-001;MILK;360;\n`);
    expect((await fetchChainFeed({ id: 'old', provider: 'cents' }, dataDir)).map((snapshot) => snapshot.date)).toEqual(['0099-12-31', '2026-11-09']);
  });

  it('an empty snapshot file is a snapshot with no rows; an empty folder gives []', async () => {
    write('e', '2026-11-09.csv', '');
    expect(await fetchChainFeed({ id: 'e', provider: 'flyer' }, dataDir)).toEqual([{ date: '2026-11-09', rows: [], skipped: 0 }]);
    fs.mkdirSync(path.join(dataDir, MOCK_API_DIR, 'empty'));
    expect(await fetchChainFeed({ id: 'empty', provider: 'flyer' }, dataDir)).toEqual([]);
  });

  it('a missing folder gives [] (missing chain folder, mock-api folder or data folder)', async () => {
    write('other', '2026-11-09.csv', STANDARD);
    expect(await fetchChainFeed({ id: 'nothere', provider: 'standard' }, dataDir)).toEqual([]);
    expect(await fetchChainFeed({ id: 'freshmart', provider: 'standard' }, path.join(dataDir, 'no-such-data-dir'))).toEqual([]);
    fs.rmSync(path.join(dataDir, MOCK_API_DIR), { recursive: true });
    expect(await fetchChainFeed({ id: 'other', provider: 'standard' }, dataDir)).toEqual([]);
  });

  it('a relative data folder is resolved from the working directory', async () => {
    const relative = path.relative(process.cwd(), dataDir);
    write('rel', '2026-11-09.csv', `${STANDARD}GS-001,Milk,3.20,,false\n`);
    expect(await fetchChainFeed({ id: 'rel', provider: 'standard' }, relative)).toHaveLength(1);
  });

  it('ordinary ids with dashes, underscores and single dots are fine', async () => {
    write('corner-co_op.2', '2026-11-09.csv', `${FLYER}GS-001,Milk,$3.46,N,\n`);
    expect(await fetchChainFeed({ id: 'corner-co_op.2', provider: 'flyer' }, dataDir)).toHaveLength(1);
  });
});

describe('fetchChainFeed: rejections', () => {
  const DOTS = 'it contains ".."';
  const SEPARATOR = 'it contains a path separator';
  it.each(
    [
      ['../x', DOTS], ['..', DOTS], ['../mock-api/fresh', DOTS], ['a/../../x', DOTS], ['x/..', DOTS], ['..\\x', DOTS], ['a..b', DOTS],
      ['a/b', SEPARATOR], ['/etc', SEPARATOR], ['/tmp', SEPARATOR], ['a\\b', SEPARATOR],
      ['', 'it is empty'], ['.', 'it names the mock-api folder itself'], ['x\u0000y', 'it contains a NUL character'],
    ]
      // Labelled with JSON.stringify so the NUL shows as \u0000 and test logs stay plain text.
      .map(([id, reason]) => [JSON.stringify(id), id, reason]),
  )('rejects the chain id %s and reads nothing', async (_label, id, reason) => {
    // A snapshot outside mock-api that an escaping id could reach.
    fs.mkdirSync(path.join(dataDir, 'x'), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'x', '2026-11-09.csv'), `${STANDARD}GS-001,SECRET,1.00,,false\n`);
    const { error, records } = await rejectionOf({ id, provider: 'standard' });
    expect(error.message).toBe(`Invalid chain id ${JSON.stringify(id)}: ${reason}`);
    expect(events(records, 'chain_id_rejected')).toEqual([expect.objectContaining({ level: 'error', chain: id, reason })]);
    expect(events(records, 'feed_parsed')).toEqual([]);
  });

  it.each([[undefined], [null], [42], [{}]])('rejects a chain id that is not a string (%p)', async (id) => {
    expect((await rejectionOf({ id, provider: 'standard' })).error.message).toMatch(/^Invalid chain id \(/);
  });

  it('rejects a missing chain object', async () => {
    expect((await rejectionOf(undefined)).error.message).toMatch(/^Invalid chain id \(undefined\)/);
  });

  it('returns a rejected promise: it never throws synchronously', async () => {
    let promise: Promise<unknown> | undefined;
    expect(() => {
      promise = fetchChainFeed({ id: '../x', provider: 'standard' }, dataDir);
    }).not.toThrow();
    await expect(promise).rejects.toThrow(/^Invalid chain id/);
  });

  it('an unknown provider rejects before anything is read, even when the folder is missing (D-67)', async () => {
    write('known', '2026-11-09.csv', `${STANDARD}GS-001,Milk,3.20,,false\n`);
    for (const id of ['known', 'missing']) {
      const { error, records } = await rejectionOf({ id, provider: 'toString' });
      expect(error.message).toBe('Unknown price provider "toString" (known: standard, cents, flyer)');
      expect(events(records, 'unknown_provider')).toEqual([expect.objectContaining({ level: 'error', chain: id, id: 'toString' })]);
      expect(events(records, 'feed_folder_missing')).toEqual([]);
      expect(events(records, 'feed_parsed')).toEqual([]);
    }
  });

  it('rejects when mock-api/<chain> is a file, not a folder (D-82)', async () => {
    fs.mkdirSync(path.join(dataDir, MOCK_API_DIR), { recursive: true });
    fs.writeFileSync(path.join(dataDir, MOCK_API_DIR, 'flat'), 'not a folder');
    const { error, records } = await rejectionOf({ id: 'flat', provider: 'standard' });
    expect(error.message).toMatch(/^chain flat: cannot read the feed folder .*ENOTDIR/);
    expect(events(records, 'feed_read_failed')).toEqual([expect.objectContaining({ level: 'error', code: 'ENOTDIR' })]);
  });

  const runningAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  (runningAsRoot ? it.skip : it)('rejects when a snapshot cannot be read, naming the file (D-82)', async () => {
    write('locked', '2026-11-02.csv', `${STANDARD}GS-001,Milk,3.20,,false\n`);
    const file = write('locked', '2026-11-09.csv', `${STANDARD}GS-001,Milk,3.20,,false\n`);
    fs.chmodSync(file, 0o000);
    try {
      const { error, records } = await rejectionOf({ id: 'locked', provider: 'standard' });
      expect(error.message).toMatch(/^chain locked: cannot read .*2026-11-09\.csv: EACCES/);
      expect(events(records, 'feed_read_failed')).toEqual([expect.objectContaining({ level: 'error', code: 'EACCES' })]);
      expect(events(records, 'feed_fetched')).toEqual([]);
    } finally {
      fs.chmodSync(file, 0o644);
    }
  });
});

describe('fetchChainFeed: logging', () => {
  it('feed_fetched (info) summarises the chain; each file logs with the chain and its path', async () => {
    write('f', '2026-11-02.csv', `${STANDARD}GS-001,Milk,3.20,,false\n`);
    write('f', '2026-11-09.csv', `${STANDARD}GS-001,Milk,3.20,,false\n,Mystery,3.50,3.50,false\n`);
    write('f', 'notes.txt', 'x');
    const { records } = await fetchLogged({ id: 'f', provider: 'standard' });
    expect(events(records, 'feed_fetched')).toEqual([
      expect.objectContaining({
        level: 'info', component: 'app.fetch', chain: 'f', provider: 'standard', snapshots: 2,
        dates: ['2026-11-02', '2026-11-09'], rows: 2, skipped: 1, ignored: 1, durationMs: expect.any(Number),
        message: 'chain f: 2 snapshot(s) 2026-11-02..2026-11-09, 2 rows, 1 skipped, 1 other entries ignored',
      }),
    ]);
    const [skip] = events(records, 'row_skipped');
    expect(skip).toMatchObject({ component: 'app.fetch.standard', chain: 'f', line: 3, reason: 'empty_sku' });
    expect(String(skip.source).endsWith(path.join(MOCK_API_DIR, 'f', '2026-11-09.csv'))).toBe(true);
    expect(events(records, 'feed_parsed').map((record) => path.basename(String(record.source)))).toEqual(['2026-11-02.csv', '2026-11-09.csv']);
  });

  it('a missing folder is a warning naming the folder', async () => {
    const { snapshots, records } = await fetchLogged({ id: 'gone', provider: 'cents' });
    expect(snapshots).toEqual([]);
    expect(events(records, 'feed_folder_missing')).toEqual([
      expect.objectContaining({ level: 'warn', chain: 'gone', folder: path.join(dataDir, MOCK_API_DIR, 'gone') }),
    ]);
  });

  it('inside the working directory, paths are logged relative to it', async () => {
    const { records } = await fetchLogged({ id: 'valugrocer', provider: 'standard' }, 'data');
    expect(events(records, 'row_skipped').map(({ source, line, reason }) => ({ source, line, reason }))).toEqual([
      { source: path.join('data', 'mock-api', 'valugrocer', '2026-11-09.csv'), line: 38, reason: 'empty_sku' },
      { source: path.join('data', 'mock-api', 'valugrocer', '2026-11-09.csv'), line: 39, reason: 'invalid_price' },
    ]);
    expect(events(records, 'feed_fetched')[0].folder).toBe(path.join('data', 'mock-api', 'valugrocer'));
  });
});

describe('fetchChainFeed: the real data folder', () => {
  const stores = parseCsvRecords(fs.readFileSync(path.join(config.dataDir, 'stores.csv'), 'utf8'));
  const chains = stores.map((store) => ({ id: store.chain_id, provider: store.provider }));
  const ROWS: Record<string, number[]> = {
    freshmart: [37, 37, 37, 37], valugrocer: [36, 36, 36, 36], greenleaf: [35, 35, 35, 35],
    harvest: [34, 34, 34, 34], citypantry: [37, 37, 37, 37], budgetbasket: [36, 36, 36, 37],
    cornercoop: [35, 35, 35, 35], sunrise: [34, 34, 34, 34],
  };

  it('uses config.dataDir (./data) by default, and stores.csv names all 8 golden chains', async () => {
    expect(config.dataDir).toBe(path.resolve(process.cwd(), 'data'));
    expect(chains.map((chain) => chain.id).sort()).toEqual(GOLDEN_CHAINS.map((chain) => chain.id).sort());
    expect((await fetchChainFeed({ id: 'freshmart', provider: 'standard' })).map((snapshot) => snapshot.date)).toHaveLength(4);
  });

  it.each(stores.map((store) => [store.chain_id, store.provider]))(
    '%s (%s): four snapshots, oldest first, all 16 golden SKUs in each, golden prices in the latest',
    async (id, provider) => {
      const snapshots = await fetchChainFeed({ id, provider });
      expect(snapshots.map((snapshot) => snapshot.date)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09']);
      expect(snapshots.map((snapshot) => snapshot.rows.length)).toEqual(ROWS[id]);
      expect(snapshots.map((snapshot) => snapshot.skipped)).toEqual(id === 'valugrocer' ? [0, 0, 0, 2] : [0, 0, 0, 0]);
      for (const snapshot of snapshots) {
        const skus = new Set(snapshot.rows.map((row) => row.sku));
        const missing = GOLDEN_PRODUCTS.map((product) => product.sku).filter((sku) => !skus.has(sku));
        expect([snapshot.date, missing]).toEqual([snapshot.date, []]);
      }
      const column = GOLDEN_CHAINS.findIndex((chain) => chain.id === id);
      const latest = new Map(snapshots[3].rows.map((row) => [row.sku, row.price]));
      expect(GOLDEN_PRODUCTS.map((product) => latest.get(product.sku))).toEqual(GOLDEN_PRODUCTS.map((product) => product.prices[column]));
    },
  );
});
