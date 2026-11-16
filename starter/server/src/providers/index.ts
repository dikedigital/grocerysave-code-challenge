/**
 * The price feed adapters by id, and the mocked supermarket API call (TECH_SPEC 4.1).
 * `chains.provider` names the adapter of each chain; `fetchChainFeed` reads a chain's weekly
 * snapshots from `<dataDir>/mock-api/<chain id>/<YYYY-MM-DD>.csv`.
 */
import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { errorMessage } from '../errors';
import { logger as rootLogger, type Logger } from '../logger';
import { centsProvider } from './cents';
import { flyerProvider } from './flyer';
import { standardProvider } from './standard';
import type { PriceProvider, ProviderPriceRow } from './types';

export type { ParseOptions, PriceProvider, ProviderParseResult, ProviderPriceRow } from './types';

/**
 * The registry. A Map, not a plain object: an object literal inherits keys such as `toString`,
 * `constructor` and `__proto__` from Object.prototype, so `registry['toString']` would return a
 * function instead of "unknown" (D-68).
 */
const PROVIDERS: ReadonlyMap<string, PriceProvider> = new Map(
  [standardProvider, centsProvider, flyerProvider].map((provider) => [provider.id, provider]),
);

/** Shows an id in an error message without ever throwing itself (symbols, null-prototype objects...). */
function describeId(id: unknown): string {
  return typeof id === 'string' ? JSON.stringify(id) : `(${id === null ? 'null' : typeof id})`;
}

const providersLogger = rootLogger.child('providers');

/**
 * The adapter for a provider id, as stored in `chains.provider` (exact, case-sensitive match).
 * Throws an Error whose message starts with `Unknown price provider` for any other id, including
 * inherited object keys such as `toString`, and non-string ids; the failure is logged first
 * (`unknown_provider`, error, D-77), a success at debug (`provider_resolved`: the info-level
 * `feed_fetched` already names the provider). `options.logger` replaces the process logger.
 */
export function getProvider(id: string, options: { logger?: Logger } = {}): PriceProvider {
  // Map keys match by identity (SameValueZero), so no non-string id can find an adapter.
  const provider = PROVIDERS.get(id);
  if (!provider) {
    const known = [...PROVIDERS.keys()];
    const message = `Unknown price provider ${describeId(id)} (known: ${known.join(', ')})`;
    (options.logger ?? providersLogger).error('unknown_provider', message, {
      id: typeof id === 'string' ? id : describeId(id),
      known,
    });
    throw new Error(message);
  }
  (options.logger ?? providersLogger).debug('provider_resolved', `price provider "${id}" resolved`, { id });
  return provider;
}

/** The folder under the data directory that holds one sub-folder of snapshots per chain. */
export const MOCK_API_DIR = 'mock-api';

/** One weekly snapshot of a chain's feed: the file's date and what its provider parsed. */
export interface FeedSnapshot {
  /** The snapshot date, from the file name (`YYYY-MM-DD`). */
  date: string;
  rows: ProviderPriceRow[];
  skipped: number;
}

/** A snapshot file name: the date and `.csv`, nothing else (lower-case extension). */
const SNAPSHOT_NAME = /^(\d{4})-(\d{2})-(\d{2})\.csv$/;

/** True when `YYYY-MM-DD` is a real calendar date (`2026-02-30` is not; `2028-02-29` is). */
function isCalendarDate(year: number, month: number, day: number): boolean {
  // setUTCFullYear, not Date.UTC: Date.UTC maps the years 0-99 to 1900-1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** Why a chain id cannot name a feed folder, or null when it can (D-67, D-82). */
function chainIdProblem(id: unknown): string | null {
  if (typeof id !== 'string') return `it is not a string (${id === null ? 'null' : typeof id})`;
  if (id === '') return 'it is empty';
  if (id === '.') return 'it names the mock-api folder itself';
  if (id.includes('..')) return 'it contains ".."';
  if (id.includes('/') || id.includes('\\')) return 'it contains a path separator';
  if (id.includes('\0')) return 'it contains a NUL character';
  return null;
}

/** A path for log records: relative to the working directory when inside it, else absolute. */
function displayPath(target: string): string {
  const relative = path.relative(process.cwd(), target);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : target;
}

/**
 * The mocked supermarket API call (TECH_SPEC 4.1): reads every `<YYYY-MM-DD>.csv` file in
 * `<dataDir>/mock-api/<chain.id>/`, parses each with the chain's provider and returns the snapshots
 * sorted by date, oldest first. Asynchronous: every failure is a rejected promise.
 *
 * - Rejects when the chain id could escape the folder (empty, `.`, containing `..`, `/`, `\` or NUL),
 *   or when the provider is unknown; the provider is checked before the folder is read (D-67).
 * - A missing folder (or a missing mock-api or data folder) gives `[]`.
 * - Only regular files whose name is a real date plus `.csv` are read; other entries (other names,
 *   impossible dates such as `2026-02-30.csv`, folders, symlinks) are ignored (D-67, D-82).
 * - Rejects when `<dataDir>/mock-api/<chain.id>` exists but is not a folder, or a snapshot cannot be
 *   read: a lost week of prices must not pass silently (D-82).
 *
 * Logs (D-77, D-83): `chain_id_rejected` (error), `feed_folder_missing` (warn), `file_ignored`
 * (info, or warn for a name that looks like a snapshot), `feed_read_failed` (error),
 * `feed_fetched` (info, per chain); each file's parse logs as in D-77, with the chain and the
 * file path. `options.logger` replaces the process logger.
 */
export async function fetchChainFeed(
  chain: { id: string; provider: string },
  dataDir: string = config.dataDir,
  options: { logger?: Logger } = {},
): Promise<FeedSnapshot[]> {
  const startedAt = Date.now();
  const base = options.logger ?? providersLogger;
  const id: unknown = chain?.id;
  const problem = chainIdProblem(id);
  if (problem !== null) {
    const message = `Invalid chain id ${describeId(id)}: ${problem}`;
    base.error('chain_id_rejected', message, { chain: typeof id === 'string' ? id : describeId(id), reason: problem });
    throw new Error(message);
  }
  const chainId = id as string;
  const log = base.child('fetch', { chain: chainId, provider: chain.provider });
  const provider = getProvider(chain.provider, { logger: log });

  const mockApiDir = path.resolve(dataDir, MOCK_API_DIR);
  const folder = path.resolve(mockApiDir, chainId);
  if (path.dirname(folder) !== mockApiDir) {
    // Unreachable after chainIdProblem; kept as a second guard against path tricks.
    const message = `Invalid chain id ${describeId(chainId)}: it resolves outside ${mockApiDir}`;
    base.error('chain_id_rejected', message, { chain: chainId, reason: 'resolves outside the mock-api folder' });
    throw new Error(message);
  }

  let entries: Dirent[];
  try {
    entries = await fs.readdir(folder, { withFileTypes: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      log.warn('feed_folder_missing', `chain ${chainId}: no feed folder at ${displayPath(folder)}; no snapshots`, {
        folder: displayPath(folder),
      });
      return [];
    }
    const message = `chain ${chainId}: cannot read the feed folder ${displayPath(folder)}: ${errorMessage(error)}`;
    log.error('feed_read_failed', message, { folder: displayPath(folder), code });
    throw new Error(message);
  }

  const snapshots: { date: string; file: string }[] = [];
  for (const entry of entries) {
    const match = SNAPSHOT_NAME.exec(entry.name);
    const file = displayPath(path.join(folder, entry.name));
    if (!match) {
      log.info('file_ignored', `chain ${chainId}: ${file} ignored: not named <YYYY-MM-DD>.csv`, { file, reason: 'not_a_snapshot_name' });
    } else if (!isCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]))) {
      log.warn('file_ignored', `chain ${chainId}: ${file} ignored: ${entry.name.slice(0, 10)} is not a calendar date`, { file, reason: 'invalid_date' });
    } else if (!entry.isFile()) {
      const kind = entry.isDirectory() ? 'a folder' : entry.isSymbolicLink() ? 'a symbolic link' : 'not a regular file';
      log.warn('file_ignored', `chain ${chainId}: ${file} ignored: it is ${kind}`, { file, reason: 'not_a_regular_file' });
    } else {
      snapshots.push({ date: entry.name.slice(0, 10), file: path.join(folder, entry.name) });
    }
  }
  snapshots.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const result: FeedSnapshot[] = [];
  for (const { date, file } of snapshots) {
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (error) {
      const message = `chain ${chainId}: cannot read ${displayPath(file)}: ${errorMessage(error)}`;
      log.error('feed_read_failed', message, { file: displayPath(file), code: (error as NodeJS.ErrnoException).code });
      throw new Error(message);
    }
    const { rows, skipped } = provider.parse(text, { source: displayPath(file), logger: log });
    result.push({ date, rows, skipped });
  }

  const rows = result.reduce((sum, snapshot) => sum + snapshot.rows.length, 0);
  const skipped = result.reduce((sum, snapshot) => sum + snapshot.skipped, 0);
  log.info(
    'feed_fetched',
    `chain ${chainId}: ${result.length} snapshot(s)${result.length > 0 ? ` ${result[0].date}..${result[result.length - 1].date}` : ''}, ${rows} rows, ${skipped} skipped, ${entries.length - result.length} other entries ignored`,
    {
      folder: displayPath(folder),
      snapshots: result.length,
      dates: result.map((snapshot) => snapshot.date),
      rows,
      skipped,
      ignored: entries.length - result.length,
      durationMs: Date.now() - startedAt,
    },
  );
  return result;
}
