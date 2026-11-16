import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsvRecords } from '../../../../src/utils/csv';
import { createLogger, memorySink, type LogRecord, type LogThreshold } from '../../logger';
import { centsProvider } from '../cents';
import { flyerProvider } from '../flyer';
import { getProvider } from '../index';
import { standardProvider } from '../standard';
import type { PriceProvider } from '../types';

/** Parses with a capturing logger; returns the result and the records logged. */
function parseLogged(provider: PriceProvider, text: string, source?: string, level: LogThreshold = 'debug') {
  const sink = memorySink();
  const logger = createLogger({ level, sinks: [sink] });
  const result = provider.parse(text, { source, logger });
  return { result, records: sink.records };
}
const events = (records: LogRecord[], event: string) => records.filter((record) => record.event === event);
/** The skipped-row records, reduced to what a reader needs: line, reason, raw. */
const skips = (records: LogRecord[]) =>
  events(records, 'row_skipped').map(({ line, reason, raw }) => ({ line, reason, raw }));

const STANDARD = 'sku,product_name,price,regular_price,on_sale';
const CENTS = 'item_code;description;price_cents;promo_price_cents';
const FLYER = 'SKU,Name,Unit Price,Sale?,Was';

describe('a skipped row is logged with its line number and reason (D-77)', () => {
  it('standard: every reason', () => {
    const text = [
      STANDARD,
      'GS-001,Milk,3.20,3.20,false',
      ',Mystery Item,3.50,3.50,false',
      'GS-099,Broken,abc,abc,false',
      'GS-002,Oil,1.00,0,false',
      'GS-003,Chicken,1.00,,maybe',
      'GS-004,Beef,1.00,1.00',
      'GS-005,Cheddar,1.00,1.00,false,extra',
    ].join('\n');
    const { result, records } = parseLogged(standardProvider, text, 'data/mock-api/x/2026-11-09.csv');
    expect(result.skipped).toBe(6);
    expect(skips(records)).toEqual([
      { line: 3, reason: 'empty_sku', raw: ',Mystery Item,3.50,3.50,false' },
      { line: 4, reason: 'invalid_price', raw: 'GS-099,Broken,abc,abc,false' },
      { line: 5, reason: 'invalid_regular_price', raw: 'GS-002,Oil,1.00,0,false' },
      { line: 6, reason: 'invalid_flag', raw: 'GS-003,Chicken,1.00,,maybe' },
      { line: 7, reason: 'too_few_fields', raw: 'GS-004,Beef,1.00,1.00' },
      { line: 8, reason: 'extra_cells', raw: 'GS-005,Cheddar,1.00,1.00,false,extra' },
    ]);
  });

  it('the record: warn level, component, provider, source and a readable message', () => {
    const { records } = parseLogged(standardProvider, `${STANDARD}\nGS-099,Broken,abc,abc,false\n`, 'data/mock-api/valugrocer/2026-11-09.csv');
    const [record] = events(records, 'row_skipped');
    expect(record).toEqual({
      time: expect.any(String),
      level: 'warn',
      component: 'app.standard',
      event: 'row_skipped',
      message: 'data/mock-api/valugrocer/2026-11-09.csv line 2 skipped: price "abc" is not a positive amount',
      provider: 'standard',
      source: 'data/mock-api/valugrocer/2026-11-09.csv',
      line: 2,
      reason: 'invalid_price',
      detail: 'price "abc" is not a positive amount',
      raw: 'GS-099,Broken,abc,abc,false',
    });
  });

  it('cents: every reason', () => {
    const text = [CENTS, ';MILK;360;', 'GS-001;MILK;3.99;', 'GS-002;OIL;0;', 'GS-012;SALMON;949;7.90', 'GS-003;CHICKEN;1390', 'GS-012;SALMON;949;7;90'].join('\r\n');
    const { result, records } = parseLogged(centsProvider, text);
    expect(result.skipped).toBe(6);
    expect(skips(records)).toEqual([
      { line: 2, reason: 'empty_sku', raw: ';MILK;360;' },
      { line: 3, reason: 'invalid_price', raw: 'GS-001;MILK;3.99;' },
      { line: 4, reason: 'invalid_price', raw: 'GS-002;OIL;0;' },
      { line: 5, reason: 'invalid_promo', raw: 'GS-012;SALMON;949;7.90' },
      { line: 6, reason: 'too_few_fields', raw: 'GS-003;CHICKEN;1390' },
      { line: 7, reason: 'extra_cells', raw: 'GS-012;SALMON;949;7;90' },
    ]);
    expect(events(records, 'row_skipped')[2].message).toBe('(text) line 4 skipped: price_cents "0" is not a positive whole number of cents');
  });

  it('flyer: every reason, including the D-74 decimal comma', () => {
    const text = [FLYER, ',Milk,$3.46,N,', 'GS-001,Milk,$abc,N,', 'GS-003,Chicken,$9.13,maybe,$11.49', 'GS-003,Chicken,$9.13,Y,abc', 'GS-001,Milk,$3.46,N', 'GS-003,Chicken,$9.13,Y,11,49'].join('\n');
    const { result, records } = parseLogged(flyerProvider, text);
    expect(result.skipped).toBe(6);
    expect(skips(records)).toEqual([
      { line: 2, reason: 'empty_sku', raw: ',Milk,$3.46,N,' },
      { line: 3, reason: 'invalid_price', raw: 'GS-001,Milk,$abc,N,' },
      { line: 4, reason: 'invalid_flag', raw: 'GS-003,Chicken,$9.13,maybe,$11.49' },
      { line: 5, reason: 'invalid_was', raw: 'GS-003,Chicken,$9.13,Y,abc' },
      { line: 6, reason: 'too_few_fields', raw: 'GS-001,Milk,$3.46,N' },
      { line: 7, reason: 'extra_cells', raw: 'GS-003,Chicken,$9.13,Y,11,49' },
    ]);
    expect(events(records, 'row_skipped')[5].message).toBe(
      '(text) line 7 skipped: 1 non-empty cell(s) beyond the 5 header columns ("49")',
    );
  });

  it('line numbers follow the file: blank lines, CRLF and a quoted name spanning two lines', () => {
    const text = `\r\n${STANDARD}\r\n\r\nGS-001,"Milk\r\nwhole",3.20,,false\r\n   \r\n,bad,1,,false\r\n`;
    const { result, records } = parseLogged(standardProvider, text);
    expect(result).toEqual({ rows: [{ sku: 'GS-001', price: 3.2, regularPrice: 3.2, onSale: false }], skipped: 1 });
    expect(skips(records)).toEqual([{ line: 7, reason: 'empty_sku', raw: ',bad,1,,false' }]);
    expect(events(records, 'row_parsed').map((record) => record.line)).toEqual([4]);
  });

  it('the number of row_skipped records always equals `skipped`', () => {
    for (const [provider, file] of [
      [standardProvider, 'data/mock-api/valugrocer/2026-11-09.csv'],
      [centsProvider, 'data/mock-api/budgetbasket/2026-11-09.csv'],
    ] as const) {
      const { result, records } = parseLogged(provider, readFileSync(join(__dirname, '../../../..', file), 'utf8'), file);
      expect(events(records, 'row_skipped')).toHaveLength(result.skipped);
    }
  });

  it('a very long raw line is clipped to 300 characters in the record', () => {
    const { records } = parseLogged(standardProvider, `${STANDARD}\n,${'x'.repeat(1000)},1,,false\n`);
    const [record] = events(records, 'row_skipped');
    expect((record.raw as string).length).toBe(301);
    expect((record.raw as string).endsWith('…')).toBe(true);
  });
});

describe('whole-feed problems are logged', () => {
  it('a header without a required column: one error naming the missing columns and the lines lost', () => {
    const { result, records } = parseLogged(standardProvider, 'sku,product_name,cost,regular_price,on_sale\nGS-001,Milk,3.20,3.20,false\nGS-002,Oil,1,,false\n', 'f.csv');
    expect(result).toEqual({ rows: [], skipped: 2 });
    expect(events(records, 'header_invalid')).toEqual([
      expect.objectContaining({
        level: 'error',
        message: 'f.csv line 1: the header lacks "price"; all 2 data rows skipped (lines 2-3)',
        line: 1,
        missing: ['price'],
        header: 'sku,product_name,cost,regular_price,on_sale',
        skipped: 2,
      }),
    ]);
    expect(events(records, 'row_skipped')).toEqual([]);
  });

  it('a feed of another format lists every column it lacks', () => {
    const { records } = parseLogged(flyerProvider, `${CENTS}\nGS-001;MILK;360;\n`);
    expect(events(records, 'header_invalid')[0].missing).toEqual(['SKU', 'Unit Price', 'Sale?', 'Was']);
  });

  it('an empty feed is a warning; input that is not text is a warning', () => {
    expect(events(parseLogged(centsProvider, '').records, 'feed_empty')).toEqual([expect.objectContaining({ level: 'warn' })]);
    expect(events(parseLogged(centsProvider, '\n  \n').records, 'feed_empty')).toHaveLength(1);
    const { result, records } = parseLogged(flyerProvider, null as unknown as string);
    expect(result).toEqual({ rows: [], skipped: 0 });
    expect(events(records, 'input_not_text')).toEqual([expect.objectContaining({ level: 'warn', inputType: 'null' })]);
  });
});

describe('normalised rows are logged as row_adjusted (D-65)', () => {
  it.each([
    [standardProvider, `${STANDARD}\nGS-001,Milk,3.00,2.00,true`, 'regular price 2.00 is below the price paid 3.00 on a sale row: raised to 3.00'],
    [standardProvider, `${STANDARD}\nGS-001,Milk,3.00,3.50,false`, 'regular price 3.50 differs from the price 3.00 on a row not on sale: ignored'],
    [centsProvider, `${CENTS}\nGS-001;MILK;790;949`, 'regular price 7.90 is below the price paid 9.49 on a sale row: raised to 9.49'],
    [flyerProvider, `${FLYER}\nGS-001,Milk,$3.46,N,$4.00`, 'regular price 4.00 differs from the price 3.46 on a row not on sale: ignored'],
    [flyerProvider, `${FLYER}\nGS-001,Milk,$9.13,Y,$8.00`, 'regular price 8.00 is below the price paid 9.13 on a sale row: raised to 9.13'],
  ])('%#: %s', (provider, text, adjustment) => {
    const { result, records } = parseLogged(provider, text);
    expect(result.skipped).toBe(0);
    expect(events(records, 'row_adjusted')).toEqual([
      expect.objectContaining({ level: 'warn', line: 2, sku: 'GS-001', message: `(text) line 2 (GS-001): ${adjustment}` }),
    ]);
  });

  it('consistent rows are not reported as adjusted', () => {
    const { records } = parseLogged(flyerProvider, `${FLYER}\nGS-003,Chicken,$9.13,Y,$11.49\nGS-003,Chicken,$9.13,Y,\nGS-001,Milk,$3.46,N,\n`);
    expect(events(records, 'row_adjusted')).toEqual([]);
  });
});

describe('summary and per-row records', () => {
  it('feed_parsed (info) carries the counts of the result', () => {
    const { result, records } = parseLogged(flyerProvider, `${FLYER}\nGS-003,Chicken,$9.13,Y,$8.00\nGS-001,Milk,$3.46,N,\n,x,$1,N,\n`, 'c.csv');
    expect(result.rows).toHaveLength(2);
    expect(events(records, 'feed_parsed')).toEqual([
      expect.objectContaining({
        level: 'info', source: 'c.csv', rows: 2, skipped: 1, adjusted: 1, onSale: 1, durationMs: expect.any(Number),
        message: 'c.csv: 2 rows (1 on sale), 1 skipped, 1 adjusted',
      }),
    ]);
  });

  it('row_parsed (debug) records what each line became, only when debug is enabled', () => {
    const text = `${CENTS}\nGS-012;SALMON FILLET 1 LB;949;790\n`;
    expect(events(parseLogged(centsProvider, text, 'h.csv', 'debug').records, 'row_parsed')).toEqual([
      expect.objectContaining({ level: 'debug', line: 2, raw: 'GS-012;SALMON FILLET 1 LB;949;790', sku: 'GS-012', price: 7.9, regularPrice: 9.49, onSale: true }),
    ]);
    expect(events(parseLogged(centsProvider, text, 'h.csv', 'info').records, 'row_parsed')).toEqual([]);
  });

  it('at the warn level a clean feed logs nothing at all', () => {
    expect(parseLogged(centsProvider, `${CENTS}\nGS-001;MILK;360;\n`, 'h.csv', 'warn').records).toEqual([]);
  });

  it('the source defaults to "(text)"', () => {
    expect(events(parseLogged(standardProvider, `${STANDARD}\n,x,1,,false\n`).records, 'row_skipped')[0].source).toBe('(text)');
  });

  it('logging never changes the result (a failing sink, or no logger at all)', () => {
    const text = `${STANDARD}\nGS-001,Milk,3.20,,false\n,x,1,,false\n`;
    const broken = createLogger({ level: 'debug', sinks: [() => { throw new Error('disk full'); }] });
    expect(standardProvider.parse(text, { logger: broken })).toEqual(standardProvider.parse(text));
    expect(standardProvider.parse(text)).toEqual({ rows: [{ sku: 'GS-001', price: 3.2, regularPrice: 3.2, onSale: false }], skipped: 1 });
  });
});

describe('the delivered feeds: exactly the known bad rows are logged', () => {
  const root = join(__dirname, '../../../..');
  const stores = parseCsvRecords(readFileSync(join(root, 'data/stores.csv'), 'utf8'));

  it('all 32 files: two row_skipped warnings (valugrocer 2026-11-09 lines 38 and 39), nothing else above info', () => {
    const sink = memorySink();
    const logger = createLogger({ level: 'warn', sinks: [sink] });
    for (const { chain_id: chain, provider } of stores) {
      for (const file of readdirSync(join(root, 'data/mock-api', chain)).sort()) {
        const source = `data/mock-api/${chain}/${file}`;
        getProvider(provider).parse(readFileSync(join(root, source), 'utf8'), { source, logger });
      }
    }
    expect(sink.records.map(({ level, event, source, line, reason, raw }) => ({ level, event, source, line, reason, raw }))).toEqual([
      { level: 'warn', event: 'row_skipped', source: 'data/mock-api/valugrocer/2026-11-09.csv', line: 38, reason: 'empty_sku', raw: ',Mystery Item,3.50,3.50,false' },
      { level: 'warn', event: 'row_skipped', source: 'data/mock-api/valugrocer/2026-11-09.csv', line: 39, reason: 'invalid_price', raw: 'GS-099,Broken Price Item,abc,abc,false' },
    ]);
  });
});

describe('getProvider logs an unknown id before throwing', () => {
  it('error record with the id and the known providers', () => {
    const sink = memorySink();
    const logger = createLogger({ level: 'debug', sinks: [sink] });
    expect(() => getProvider('toString', { logger })).toThrow(/^Unknown price provider "toString"/);
    expect(sink.records).toEqual([
      expect.objectContaining({
        level: 'error', event: 'unknown_provider', id: 'toString', known: ['standard', 'cents', 'flyer'],
        message: 'Unknown price provider "toString" (known: standard, cents, flyer)',
      }),
    ]);
  });

  it('a non-string id is logged by its type; a known id logs provider_resolved at debug', () => {
    const sink = memorySink();
    const logger = createLogger({ level: 'debug', sinks: [sink] });
    expect(() => getProvider(Symbol('x') as unknown as string, { logger })).toThrow(/^Unknown price provider/);
    expect(sink.records[0].id).toBe('(symbol)');
    getProvider('flyer', { logger });
    expect(sink.records.map((record) => [record.level, record.event, record.id])).toEqual([
      ['error', 'unknown_provider', '(symbol)'],
      ['debug', 'provider_resolved', 'flyer'],
    ]);
  });

  it('a successful lookup is logged at debug only', () => {
    const sink = memorySink();
    getProvider('cents', { logger: createLogger({ level: 'info', sinks: [sink] }) });
    expect(sink.records).toEqual([]);
  });
});
