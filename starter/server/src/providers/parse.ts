/**
 * Rules shared by the feed adapters (TECH_SPEC 4.1). Internal to `server/src/providers`: the public
 * surface is the adapters themselves. Decisions D-60 to D-66, D-70, D-74 and the logging
 * decisions D-76 to D-80 in docs/DECISIONS.md.
 */
import { parseCsv } from '../../../src/utils/csv';
import { fromCents } from '../../../src/utils/money';
import { logger as rootLogger, type Logger } from '../logger';
import type { ParseOptions, ProviderParseResult, ProviderPriceRow } from './types';

/**
 * Largest amount accepted, in cents: 99,999,999.99, the limit of the `numeric(10, 2)` price columns.
 * A larger amount could not be stored, and one such row would fail the whole chain's sync (D-70).
 */
export const MAX_AMOUNT_CENTS = 9_999_999_999;

/** `$` (optional), digits, then optionally `.` and one or two digits. */
const AMOUNT_PATTERN = /^\$?(\d+)(?:\.(\d{1,2}))?$/;
const INTEGER_PATTERN = /^\d+$/;

const ON_SALE_FLAGS = new Set(['true', 'y', 'yes', '1']);
const NOT_ON_SALE_FLAGS = new Set(['false', 'n', 'no', '0', '']);

/** Longest raw line copied into a log record. */
const MAX_LOGGED_TEXT = 300;

const providersLogger = rootLogger.child('providers');

function inRange(cents: number): number | null {
  return cents > 0 && cents <= MAX_AMOUNT_CENTS ? cents : null;
}

/**
 * A positive amount written as a plain decimal with at most two decimals, optionally prefixed with
 * `$`, as integer cents; null when the text is not one (D-63). No floating point is involved.
 * `4.01` -> 401, `$3.5` -> 350; `abc`, `1.999`, `.50`, `5.`, `1,000.00`, `-3`, `0.00` -> null.
 */
export function parseAmountCents(text: string): number | null {
  const match = AMOUNT_PATTERN.exec(text);
  if (!match) return null;
  const whole = Number(match[1]);
  const fraction = match[2] === undefined ? 0 : Number(match[2].padEnd(2, '0'));
  // A whole part too long to be exact gives a huge number, which inRange rejects.
  return inRange(whole * 100 + fraction);
}

/** A positive whole number of cents (digits only); null otherwise. `399` -> 399; `3.99`, `0` -> null. */
export function parseIntegerCents(text: string): number | null {
  if (!INTEGER_PATTERN.test(text)) return null;
  const cents = Number(text);
  return Number.isSafeInteger(cents) ? inRange(cents) : null;
}

/**
 * A sale flag, case-insensitive: `true`/`y`/`yes`/`1` -> true; `false`/`n`/`no`/`0`/empty -> false;
 * anything else -> null (the row is malformed).
 */
export function parseSaleFlag(text: string): boolean | null {
  const flag = text.toLowerCase();
  if (ON_SALE_FLAGS.has(flag)) return true;
  if (NOT_ON_SALE_FLAGS.has(flag)) return false;
  return null;
}

/** Why a data row was skipped; `reason` in the `row_skipped` log record (D-77). */
export type SkipCode =
  | 'too_few_fields'
  | 'extra_cells'
  | 'empty_sku'
  | 'invalid_price'
  | 'invalid_regular_price'
  | 'invalid_flag'
  | 'invalid_promo'
  | 'invalid_was';

/** What an adapter makes of one row: a price row (possibly normalised) or a reason to skip it. */
export type RowOutcome =
  | { row: ProviderPriceRow; adjustment: string | null }
  | { skip: SkipCode; message: string };

export function skip(code: SkipCode, message: string): RowOutcome {
  return { skip: code, message };
}

/** A cell quoted for a log message: `"abc"`. */
export const quote = (text: string): string => JSON.stringify(text);

const dollars = (cents: number) => fromCents(cents).toFixed(2);

/**
 * Builds a normalised row (D-65). `price` is what the shopper pays and is kept as given. When on
 * sale, the regular price is never below it; when not on sale, the regular price is the price.
 * `regularCents` null means "not given" (equal to the price). When the feed's regular price had to
 * be changed, `adjustment` says how (logged as `row_adjusted`).
 */
export function priceRow(sku: string, priceCents: number, regularCents: number | null, onSale: boolean): RowOutcome {
  const regular = onSale ? Math.max(regularCents ?? priceCents, priceCents) : priceCents;
  let adjustment: string | null = null;
  if (regularCents !== null && regularCents !== regular) {
    adjustment = onSale
      ? `regular price ${dollars(regularCents)} is below the price paid ${dollars(priceCents)} on a sale row: raised to ${dollars(regular)}`
      : `regular price ${dollars(regularCents)} differs from the price ${dollars(priceCents)} on a row not on sale: ignored`;
  }
  return { row: { sku, price: fromCents(priceCents), regularPrice: fromCents(regular), onSale }, adjustment };
}

/** One record of the file and the physical line it starts on (1-based). */
export interface CsvRecord {
  line: number;
  text: string;
}

/**
 * Splits a CSV text into records, keeping each record's starting line number (D-75). It follows the
 * quoting rules of `parseCsv` (src/utils/csv.ts) exactly: a quote opens only at the start of a
 * still-blank, not yet quoted field; `""` inside quotes is a quote; separators and line breaks inside
 * quotes are data; a line ends at LF, CRLF or a lone CR; a leading BOM is dropped. So
 * `records.flatMap((r) => parseCsv(r.text))` equals `parseCsv(text)`, which a test checks on random
 * input. Blank records are kept (the caller skips them, like parseCsv).
 */
export function splitRecords(text: string, delimiter: string): CsvRecord[] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: CsvRecord[] = [];
  let start = 0;
  let line = 1;
  let startLine = 1;
  let inQuotes = false;
  let fieldBlank = true;
  let fieldWasQuoted = false;

  const endRecord = (end: number, next: number) => {
    records.push({ line: startLine, text: input.slice(start, end) });
    line += 1;
    start = next;
    startLine = line;
    fieldBlank = true;
    fieldWasQuoted = false;
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') i += 1;
        else inQuotes = false;
      } else if (char === '\n' || (char === '\r' && input[i + 1] !== '\n')) {
        line += 1;
      }
      continue;
    }
    if (char === '"' && fieldBlank && !fieldWasQuoted) {
      inQuotes = true;
      fieldWasQuoted = true;
    } else if (char === delimiter) {
      fieldBlank = true;
      fieldWasQuoted = false;
    } else if (char === '\n') {
      endRecord(input[i - 1] === '\r' ? i - 1 : i, i + 1);
    } else if (char === '\r') {
      if (input[i + 1] !== '\n') endRecord(i, i + 1);
    } else if (char.trim() !== '') {
      fieldBlank = false;
    }
  }
  if (start < input.length) records.push({ line: startLine, text: input.slice(start) });
  return records;
}

/** The trimmed cells of one data row, by column key. */
export type FeedCells<K extends string> = Record<K, string>;

export interface FeedFormat<K extends string> {
  /** Provider id, for the log records. */
  provider: string;
  delimiter: string;
  /** The header name of each column the adapter reads (all required, D-61). */
  columns: Record<K, string>;
  /** Reads the trimmed cells of a row: the row, or why it is skipped. Must not throw. */
  readRow: (cells: FeedCells<K>) => RowOutcome;
}

const clip = (text: string) => (text.length > MAX_LOGGED_TEXT ? `${text.slice(0, MAX_LOGGED_TEXT)}…` : text);

/**
 * Reads a feed whose first non-blank line is a header (D-60 to D-62, D-74), and logs what happened
 * (D-77): every skipped row with its line and reason (`row_skipped`, warn), every normalised row
 * (`row_adjusted`, warn), a header that lacks required columns (`header_invalid`, error), an empty
 * feed (`feed_empty`, warn), each row read (`row_parsed`, debug) and a summary (`feed_parsed`, info).
 *
 * - Records are split with their line numbers, then each is split into fields by `parseCsv` with
 *   the given delimiter (quotes, BOM and CRLF are handled); blank lines are not rows.
 * - Header names are matched ignoring case and surrounding spaces, in any order; the left-most of
 *   two equal names wins; other columns are ignored. A missing required column skips every row.
 * - A row without a cell for every required column ("too few fields") is skipped.
 * - A row with a non-empty cell beyond the header's last column is skipped: its columns cannot be
 *   trusted (an unquoted `11,49` in the last column would otherwise read as 11). Empty extra cells,
 *   such as a trailing separator, are ignored (D-74).
 *
 * Never throws: input that is not a string is treated as an empty feed (and logged).
 */
export function parseFeed<K extends string>(
  csvText: string,
  format: FeedFormat<K>,
  options: ParseOptions = {},
): ProviderParseResult {
  const startedAt = Date.now();
  const source = options.source ?? '(text)';
  const log: Logger = (options.logger ?? providersLogger).child(format.provider, { provider: format.provider, source });

  if (typeof csvText !== 'string') {
    log.warn('input_not_text', `${source}: the feed is not text (${csvText === null ? 'null' : typeof csvText}); read as empty`, {
      inputType: csvText === null ? 'null' : typeof csvText,
    });
    return { rows: [], skipped: 0 };
  }

  const records = splitRecords(csvText, format.delimiter)
    .map((record) => ({ ...record, fields: parseCsv(record.text, { delimiter: format.delimiter })[0] }))
    .filter((record): record is CsvRecord & { fields: string[] } => record.fields !== undefined);
  const [header, ...dataRows] = records;
  if (!header) {
    log.warn('feed_empty', `${source}: no header line, the feed is empty`, {});
    return { rows: [], skipped: 0 };
  }

  const names = header.fields.map((name) => name.trim().toLowerCase());
  const keys = Object.keys(format.columns) as K[];
  const missing = keys.filter((key) => !names.includes(format.columns[key].toLowerCase())).map((key) => format.columns[key]);
  if (missing.length > 0) {
    const lines = dataRows.length > 0 ? ` (lines ${dataRows[0].line}-${dataRows[dataRows.length - 1].line})` : '';
    log.error(
      'header_invalid',
      `${source} line ${header.line}: the header lacks ${missing.map(quote).join(', ')}; all ${dataRows.length} data rows skipped${lines}`,
      { line: header.line, missing, header: clip(header.text), skipped: dataRows.length },
    );
    log.info('feed_parsed', `${source}: 0 rows, ${dataRows.length} skipped`, {
      rows: 0, skipped: dataRows.length, adjusted: 0, onSale: 0, durationMs: Date.now() - startedAt,
    });
    return { rows: [], skipped: dataRows.length };
  }
  const indexOf = {} as Record<K, number>;
  for (const key of keys) indexOf[key] = names.indexOf(format.columns[key].toLowerCase());
  const lastRequired = Math.max(...keys.map((key) => indexOf[key]));

  const rows: ProviderPriceRow[] = [];
  let skipped = 0;
  let adjusted = 0;
  const skipRow = (line: number, text: string, reason: SkipCode, message: string) => {
    skipped += 1;
    log.warn('row_skipped', `${source} line ${line} skipped: ${message}`, { line, reason, detail: message, raw: clip(text) });
  };

  for (const { line, text, fields } of dataRows) {
    if (fields.length <= lastRequired) {
      skipRow(line, text, 'too_few_fields', `too few fields (${fields.length}; the header needs ${lastRequired + 1})`);
      continue;
    }
    const extra = fields.slice(header.fields.length).filter((field) => field.trim() !== '');
    if (extra.length > 0) {
      skipRow(
        line,
        text,
        'extra_cells',
        `${extra.length} non-empty cell(s) beyond the ${header.fields.length} header columns (${extra.map(quote).join(', ')})`,
      );
      continue;
    }
    const cells = {} as FeedCells<K>;
    for (const key of keys) cells[key] = fields[indexOf[key]].trim();
    const outcome = format.readRow(cells);
    if ('skip' in outcome) {
      skipRow(line, text, outcome.skip, outcome.message);
      continue;
    }
    const { row, adjustment } = outcome;
    rows.push(row);
    if (adjustment !== null) {
      adjusted += 1;
      log.warn('row_adjusted', `${source} line ${line} (${row.sku}): ${adjustment}`, { line, sku: row.sku, raw: clip(text) });
    }
    if (log.isEnabled('debug')) {
      log.debug('row_parsed', `${source} line ${line}: ${row.sku} ${row.price}`, { line, raw: clip(text), ...row });
    }
  }

  const onSale = rows.filter((row) => row.onSale).length;
  const rowWord = rows.length === 1 ? 'row' : 'rows';
  log.info('feed_parsed', `${source}: ${rows.length} ${rowWord} (${onSale} on sale), ${skipped} skipped, ${adjusted} adjusted`, {
    rows: rows.length, skipped, adjusted, onSale, durationMs: Date.now() - startedAt,
  });
  return { rows, skipped };
}
