import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GOLDEN_CHAINS, GOLDEN_PRODUCTS } from '../../../../tests/fixtures/spreadsheet';
import { flyerProvider } from '../flyer';
import type { ProviderParseResult } from '../types';
import { expectValidRows, seededRandom } from './helpers';

const HEADER = 'SKU,Name,Unit Price,Sale?,Was';
/** A feed made of the flyer header and the given data lines (LF, final newline). */
const feed = (...lines: string[]) => [HEADER, ...lines].join('\n') + '\n';
const parse = (text: string): ProviderParseResult => flyerProvider.parse(text);
/** Parses a feed holding a single data row. */
const one = (line: string) => parse(feed(line));

const MILK = 'GS-001,Whole Milk 1 gal,$3.46,N,';
const milkRow = { sku: 'GS-001', price: 3.46, regularPrice: 3.46, onSale: false };
const CHICKEN = 'GS-003,Chicken Breast 2 lb,$9.13,Y,$11.49';
const chickenRow = { sku: 'GS-003', price: 9.13, regularPrice: 11.49, onSale: true };

describe('flyerProvider: the requested cases', () => {
  it('a sale with no "was" price: on sale, regularPrice equals the price', () => {
    expect(one('GS-003,Chicken Breast 2 lb,$9.13,Y,')).toEqual({
      rows: [{ sku: 'GS-003', price: 9.13, regularPrice: 9.13, onSale: true }],
      skipped: 0,
    });
    expect(one('GS-003,Chicken Breast 2 lb,$9.13,Y,   ')).toEqual({
      rows: [{ sku: 'GS-003', price: 9.13, regularPrice: 9.13, onSale: true }],
      skipped: 0,
    });
  });

  it('a bad "was" is skipped and counted, whatever the flag says', () => {
    for (const was of ['abc', 'n/a', '$1.999', '$0.00', '$-11.49', '$ 11.49', '"$11,49"']) {
      expect([was, one(`GS-003,Chicken Breast 2 lb,$9.13,Y,${was}`)]).toEqual([was, { rows: [], skipped: 1 }]);
      expect([was, one(`GS-003,Chicken Breast 2 lb,$9.13,N,${was}`)]).toEqual([was, { rows: [], skipped: 1 }]);
    }
  });

  it('a bad flag is skipped and counted', () => {
    for (const flag of ['maybe', 'S', 'sale', 'Y/N', '?', 'YN', '2']) {
      expect([flag, one(`GS-003,Chicken Breast 2 lb,$9.13,${flag},$11.49`)]).toEqual([flag, { rows: [], skipped: 1 }]);
    }
  });

  it('a non-numeric price is skipped and counted', () => {
    for (const price of ['abc', '$abc', 'n/a', '$', '', 'FREE', '$4.01.5']) {
      expect([price, one(`GS-001,Whole Milk 1 gal,${price},N,`)]).toEqual([price, { rows: [], skipped: 1 }]);
    }
  });

  it('the usual rows: not on sale, and on sale with a was price', () => {
    expect(parse(feed(MILK, CHICKEN))).toEqual({ rows: [milkRow, chickenRow], skipped: 0 });
  });

  it('bad rows never stop the good ones: a mixed feed keeps the valid rows in file order', () => {
    const text = feed(
      MILK,
      'GS-002,Olive Oil,$abc,N,',
      CHICKEN,
      'GS-004,Ground Beef,$13.90,maybe,',
      'GS-005,Cheddar,$14.32,Y,abc',
      ',No SKU,$1.00,N,',
      'GS-006,Eggs,$0.00,N,',
      'GS-007,Coffee,$9.13,N',
      'GS-008,Butter 1 lb,$6.12,Y,',
    );
    expect(parse(text)).toEqual({
      rows: [milkRow, chickenRow, { sku: 'GS-008', price: 6.12, regularPrice: 6.12, onSale: true }],
      skipped: 6,
    });
  });
});

describe('flyerProvider: prices, flags and the was column', () => {
  it.each([
    ['$4.01', 4.01],
    ['4.01', 4.01],
    ['$4', 4],
    ['$4.5', 4.5],
    [' $4.01 ', 4.01],
    ['$0.01', 0.01],
    ['$99999999.99', 99999999.99],
  ])('unit price %p is %p (the $ is optional, D-63)', (text, value) => {
    expect(one(`GS-001,Milk,${text},N,`).rows).toEqual([{ sku: 'GS-001', price: value, regularPrice: value, onSale: false }]);
  });

  it.each(['$0', '$0.00', '0', '-$4.01', '$-4.01', '$4.011', '$$4.01', '4.01$', 'US$4.01', '$1,000.00', '$100000000.00'])(
    'rejects the unit price %p',
    (text) => {
      expect(one(`GS-001,Milk,${text},N,`)).toEqual({ rows: [], skipped: 1 });
    },
  );

  it.each(['Y', 'y', 'yes', 'YES', 'true', '1', ' Y '])('Sale? %p means on sale', (flag) => {
    expect(one(`GS-003,Chicken,$9.13,${flag},$11.49`).rows).toEqual([chickenRow]);
  });

  it.each(['N', 'n', 'no', 'false', '0', '', ' '])('Sale? %p means not on sale', (flag) => {
    expect(one(`GS-001,Milk,$3.46,${flag},`).rows).toEqual([milkRow]);
  });

  it('Sale? N with a valid was: not on sale, the was is ignored (D-65)', () => {
    expect(one('GS-001,Milk,$3.46,N,$4.00').rows).toEqual([milkRow]);
  });

  it('Sale? Y with a was below the price: regularPrice is raised to the price (D-65)', () => {
    expect(one('GS-003,Chicken,$9.13,Y,$8.00').rows).toEqual([{ sku: 'GS-003', price: 9.13, regularPrice: 9.13, onSale: true }]);
  });

  it('a was without $ is accepted like the unit price', () => {
    expect(one('GS-003,Chicken,$9.13,Y,11.49').rows).toEqual([chickenRow]);
  });
});

describe('flyerProvider: rows, header and file shape (D-60 to D-62, D-66)', () => {
  it('has the id stored in chains.provider', () => {
    expect(flyerProvider.id).toBe('flyer');
  });

  it('a blank SKU is skipped; a zero price is skipped', () => {
    expect(one(',Whole Milk 1 gal,$3.46,N,')).toEqual({ rows: [], skipped: 1 });
    expect(one('  ,Whole Milk 1 gal,$3.46,N,')).toEqual({ rows: [], skipped: 1 });
    expect(one('GS-001,Whole Milk 1 gal,$0.00,N,')).toEqual({ rows: [], skipped: 1 });
  });

  it('a short row (no Was cell, no trailing comma) is skipped: product owner decision (D-62)', () => {
    expect(one('GS-001,Whole Milk 1 gal,$3.46,N')).toEqual({ rows: [], skipped: 1 });
    expect(one('GS-003,Chicken Breast 2 lb,$9.13,Y')).toEqual({ rows: [], skipped: 1 });
    expect(one('GS-001,Whole Milk 1 gal,$3.46')).toEqual({ rows: [], skipped: 1 });
  });

  it('reads CRLF line endings, including an empty Was at the end of the line', () => {
    expect(parse(`${HEADER}\r\n${MILK}\r\n${CHICKEN}\r\n`)).toEqual({ rows: [milkRow, chickenRow], skipped: 0 });
  });

  it('reads a byte order mark and quoted fields (a comma inside a name)', () => {
    expect(parse(`\uFEFF${HEADER}\n"GS-003","Chicken Breast, 2 lb","$9.13","Y","$11.49"\n`)).toEqual({ rows: [chickenRow], skipped: 0 });
  });

  it('matches the header ignoring case, spaces and order; Name is optional', () => {
    expect(parse(' was ,sale?, UNIT PRICE ,sku\n$11.49,Y,$9.13,GS-003\n')).toEqual({ rows: [chickenRow], skipped: 0 });
  });

  it('"Unit Price" must keep its inner space; "Sale" without "?" is a different column', () => {
    expect(parse('SKU,Name,UnitPrice,Sale?,Was\nGS-001,Milk,$3.46,N,\n')).toEqual({ rows: [], skipped: 1 });
    expect(parse('SKU,Name,Unit Price,Sale,Was\nGS-001,Milk,$3.46,N,\n')).toEqual({ rows: [], skipped: 1 });
  });

  it.each(['SKU', 'Unit Price', 'Sale?', 'Was'])('skips every row when the header lacks %p', (column) => {
    const names = HEADER.split(',');
    const keep = (line: string) => line.split(',').filter((_, index) => names[index] !== column).join(',');
    expect(parse(`${keep(HEADER)}\n${keep(CHICKEN)}\n${keep(MILK)}\n`)).toEqual({ rows: [], skipped: 2 });
  });

  it('a standard feed handed to the flyer adapter skips every row', () => {
    expect(parse('sku,product_name,price,regular_price,on_sale\nGS-001,Milk,3.20,3.20,false\n')).toEqual({ rows: [], skipped: 1 });
  });

  it('an empty feed, a header alone and blank lines give nothing and skip nothing', () => {
    expect(parse('')).toEqual({ rows: [], skipped: 0 });
    expect(parse(HEADER)).toEqual({ rows: [], skipped: 0 });
    expect(parse(`\n${HEADER}\n\n${MILK}\n  \n`)).toEqual({ rows: [milkRow], skipped: 0 });
  });

  it('an unquoted decimal comma in Was makes an extra cell: skipped, not read as $11 (D-74)', () => {
    expect(one('GS-003,Chicken Breast 2 lb,$9.13,Y,11,49')).toEqual({ rows: [], skipped: 1 });
    expect(one('GS-003,Chicken Breast 2 lb,$9.13,N,$11,49')).toEqual({ rows: [], skipped: 1 });
  });

  it('empty cells beyond the header are ignored; a non-empty one makes the row malformed (D-74)', () => {
    expect(one(`${CHICKEN},`)).toEqual({ rows: [chickenRow], skipped: 0 });
    expect(one(`${CHICKEN},, ,`)).toEqual({ rows: [chickenRow], skipped: 0 });
    expect(one(`${CHICKEN},extra`)).toEqual({ rows: [], skipped: 1 });
  });
});

describe('flyerProvider: never throws', () => {
  it.each([undefined, null, 42, {}, []])('treats the non-string input %p as an empty feed', (input) => {
    expect(flyerProvider.parse(input as unknown as string)).toEqual({ rows: [], skipped: 0 });
  });

  it('on random feeds: never throws, every row is valid and rows + skipped = non-blank data lines', () => {
    const random = seededRandom(20261026);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
    const skus = ['GS-001', 'GS-999', '', ' ', 'gs-002'];
    const amounts = ['$4.01', '4.01', '$0', '', 'abc', '$1.999', '$11.49', '$-1', '$99999999.99', '$100000000', ' $2 '];
    const flags = ['Y', 'N', 'y', 'n', '', 'maybe', 'yes', 'no', 'S'];

    for (let run = 0; run < 300; run += 1) {
      const lines: string[] = [];
      const count = Math.floor(random() * 12);
      for (let i = 0; i < count; i += 1) {
        const cells = [pick(skus), 'Name', pick(amounts), pick(flags), pick(amounts)];
        lines.push(cells.slice(0, 1 + Math.floor(random() * 5)).join(','));
      }
      const result = parse([HEADER, ...lines].join(pick(['\n', '\r\n'])));
      expect(result.rows.length + result.skipped).toBe(lines.filter((line) => line.trim() !== '').length);
      expectValidRows(result);
    }
  });
});

describe('flyerProvider: the delivered feeds (data/mock-api, M14.6)', () => {
  const dataDir = join(__dirname, '../../../../data/mock-api');
  const read = (chain: string, date: string) => parse(readFileSync(join(dataDir, chain, `${date}.csv`), 'utf8'));

  it.each([
    ['cornercoop', 35, [0, 5, 2, 4]],
    ['sunrise', 34, [2, 1, 4, 3]],
  ])('%s: %p rows in every snapshot, rows on sale per snapshot, nothing skipped', (chain, rows, onSale) => {
    const dates = readdirSync(join(dataDir, chain)).sort().map((file) => file.slice(0, 10));
    expect(dates).toEqual(['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09']);
    expect(dates.map((date) => read(chain, date).rows.length)).toEqual([rows, rows, rows, rows]);
    expect(dates.map((date) => read(chain, date).rows.filter((row) => row.onSale).length)).toEqual(onSale);
    expect(dates.map((date) => read(chain, date).skipped)).toEqual([0, 0, 0, 0]);
  });

  it('every sale row of the latest cornercoop and sunrise snapshots', () => {
    expect(read('cornercoop', '2026-11-09').rows.filter((row) => row.onSale)).toEqual([
      { sku: 'GS-003', price: 9.13, regularPrice: 11.49, onSale: true },
      { sku: 'GS-018', price: 2.48, regularPrice: 2.85, onSale: true },
      { sku: 'GS-022', price: 6.79, regularPrice: 7.81, onSale: true },
      { sku: 'GS-038', price: 10.2, regularPrice: 11.73, onSale: true },
    ]);
    expect(read('sunrise', '2026-11-09').rows.filter((row) => row.onSale)).toEqual([
      { sku: 'GS-001', price: 4.01, regularPrice: 4.69, onSale: true },
      { sku: 'GS-010', price: 8.9, regularPrice: 10.49, onSale: true },
      { sku: 'GS-017', price: 4.24, regularPrice: 4.88, onSale: true },
    ]);
  });

  it.each(['cornercoop', 'sunrise'])('%s 2026-11-09 reproduces the golden spreadsheet prices for GS-001 to GS-016', (chain) => {
    const column = GOLDEN_CHAINS.findIndex((golden) => golden.id === chain);
    const bySku = new Map(read(chain, '2026-11-09').rows.map((row) => [row.sku, row.price]));
    for (const product of GOLDEN_PRODUCTS) {
      expect([product.sku, bySku.get(product.sku)]).toEqual([product.sku, product.prices[column]]);
    }
  });
});
