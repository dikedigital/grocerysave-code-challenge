import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GOLDEN_CHAINS, GOLDEN_PRODUCTS } from '../../../../tests/fixtures/spreadsheet';
import { centsProvider } from '../cents';
import type { ProviderParseResult } from '../types';
import { expectValidRows, seededRandom } from './helpers';

const HEADER = 'item_code;description;price_cents;promo_price_cents';
/** A feed made of the cents header and the given data lines (LF, final newline). */
const feed = (...lines: string[]) => [HEADER, ...lines].join('\n') + '\n';
const parse = (text: string): ProviderParseResult => centsProvider.parse(text);
/** Parses a feed holding a single data row. */
const one = (line: string) => parse(feed(line));

const MILK = 'GS-001;WHOLE MILK 1 GAL;360;';
const milkRow = { sku: 'GS-001', price: 3.6, regularPrice: 3.6, onSale: false };
const SALMON = 'GS-012;SALMON FILLET 1 LB;949;790';
const salmonRow = { sku: 'GS-012', price: 7.9, regularPrice: 9.49, onSale: true };

describe('centsProvider: the requested cases', () => {
  it('CRLF line endings', () => {
    expect(parse(`${HEADER}\r\n${MILK}\r\n${SALMON}\r\n`)).toEqual({ rows: [milkRow, salmonRow], skipped: 0 });
    // CRLF with the empty promo as the last cell: the \r must not end up in the promo cell.
    expect(parse(`${HEADER}\r\nGS-001;WHOLE MILK 1 GAL;360;\r\n`)).toEqual({ rows: [milkRow], skipped: 0 });
  });

  it('a promo row: the promo is the price paid, price_cents becomes the regular price', () => {
    expect(one(SALMON)).toEqual({ rows: [salmonRow], skipped: 0 });
  });

  it('a row where the cents value is "3.99" is skipped and counted', () => {
    expect(one('GS-001;WHOLE MILK 1 GAL;3.99;')).toEqual({ rows: [], skipped: 1 });
    expect(one('GS-012;SALMON FILLET 1 LB;9.49;790')).toEqual({ rows: [], skipped: 1 });
  });

  it('a bad promo is skipped and counted (not read as "no promo")', () => {
    for (const promo of ['abc', '7.90', '0', '-790', 'n/a']) {
      expect([promo, one(`GS-012;SALMON FILLET 1 LB;949;${promo}`)]).toEqual([promo, { rows: [], skipped: 1 }]);
    }
  });

  it('a blank item code is skipped and counted', () => {
    expect(one(';WHOLE MILK 1 GAL;360;')).toEqual({ rows: [], skipped: 1 });
    expect(one('   ;WHOLE MILK 1 GAL;360;')).toEqual({ rows: [], skipped: 1 });
  });

  it('a zero price is skipped and counted', () => {
    expect(one('GS-001;WHOLE MILK 1 GAL;0;')).toEqual({ rows: [], skipped: 1 });
    expect(one('GS-012;SALMON FILLET 1 LB;0;790')).toEqual({ rows: [], skipped: 1 });
    expect(one('GS-001;WHOLE MILK 1 GAL;000;')).toEqual({ rows: [], skipped: 1 });
  });

  it('bad rows never stop the good ones: a mixed feed keeps the valid rows in file order', () => {
    const text = feed(
      MILK,
      'GS-002;OLIVE OIL;3.99;',
      SALMON,
      'GS-003;CHICKEN;1390;abc',
      ';NO CODE;500;',
      'GS-004;BEEF;0;',
      'GS-005;CHEDDAR;1020',
      'GS-040;BABY WIPES 72 COUNT;811;705',
    );
    expect(parse(text)).toEqual({
      rows: [milkRow, salmonRow, { sku: 'GS-040', price: 7.05, regularPrice: 8.11, onSale: true }],
      skipped: 5,
    });
  });
});

describe('centsProvider: the promo column changes what price_cents means', () => {
  it('the same price_cents is the price paid without a promo, and the regular price with one', () => {
    expect(one('GS-012;SALMON;949;').rows).toEqual([{ sku: 'GS-012', price: 9.49, regularPrice: 9.49, onSale: false }]);
    expect(one('GS-012;SALMON;949;790').rows).toEqual([{ sku: 'GS-012', price: 7.9, regularPrice: 9.49, onSale: true }]);
  });

  it('a promo equal to price_cents is still on sale, with no discount (D-65)', () => {
    expect(one('GS-012;SALMON;949;949').rows).toEqual([{ sku: 'GS-012', price: 9.49, regularPrice: 9.49, onSale: true }]);
  });

  it('a promo above price_cents is still the price paid; regularPrice is raised to it (D-65, product owner)', () => {
    expect(one('GS-012;SALMON;790;949')).toEqual({
      rows: [{ sku: 'GS-012', price: 9.49, regularPrice: 9.49, onSale: true }],
      skipped: 0,
    });
  });

  it('a promo cell of spaces is "no promo"', () => {
    expect(one('GS-001;WHOLE MILK 1 GAL;360;   ')).toEqual({ rows: [milkRow], skipped: 0 });
  });
});

describe('centsProvider: whole cents (D-63)', () => {
  it.each([
    ['1', 0.01],
    ['99', 0.99],
    ['100', 1],
    ['360', 3.6],
    ['0360', 3.6],
    [' 360 ', 3.6],
    ['123456', 1234.56],
    ['9999999999', 99999999.99],
  ])('price_cents %p is %p', (text, value) => {
    expect(one(`GS-001;MILK;${text};`).rows).toEqual([{ sku: 'GS-001', price: value, regularPrice: value, onSale: false }]);
  });

  it.each([
    '3.99', '3,99', '0', '00', '-360', '+360', '$360', '360c', '3 60', '1e3', '0x10', 'abc', '', 'NaN',
    'Infinity', '360.0', '10000000000', '99999999999999999999',
  ])('rejects price_cents %p', (text) => {
    expect(one(`GS-001;MILK;${text};`)).toEqual({ rows: [], skipped: 1 });
  });

  it.each(['3.99', '3,99', '0', '-1', '+5', '$5', '10000000000'])('rejects promo_price_cents %p', (text) => {
    expect(one(`GS-001;MILK;360;${text}`)).toEqual({ rows: [], skipped: 1 });
  });

  it('keeps exact cents (no binary drift)', () => {
    for (const [cents, value] of [['29', 0.29], ['110', 1.1], ['435', 4.35], ['1999', 19.99], ['7', 0.07]] as const) {
      expect(one(`GS-001;MILK;${cents};`).rows[0].price).toBe(value);
    }
  });
});

describe('centsProvider: rows, header and file shape (D-60 to D-62, D-66)', () => {
  it('has the id stored in chains.provider', () => {
    expect(centsProvider.id).toBe('cents');
  });

  it('a row without its trailing ";" has too few fields and is skipped', () => {
    expect(one('GS-001;WHOLE MILK 1 GAL;360')).toEqual({ rows: [], skipped: 1 });
    expect(one('GS-001')).toEqual({ rows: [], skipped: 1 });
  });

  it('empty cells beyond the header are ignored; a non-empty one makes the row malformed (D-74)', () => {
    expect(one(`${MILK};`)).toEqual({ rows: [milkRow], skipped: 0 });
    expect(one(`${MILK};extra;cells`)).toEqual({ rows: [], skipped: 1 });
    // A promo split by a stray separator: "7;90" would otherwise pass as a promo of 7 cents.
    expect(one('GS-012;SALMON FILLET 1 LB;949;7;90')).toEqual({ rows: [], skipped: 1 });
  });

  it('a comma is data, not a separator', () => {
    expect(one('GS-001;MILK, WHOLE, 1 GAL;360;')).toEqual({ rows: [milkRow], skipped: 0 });
  });

  it('an empty feed, a header alone, and blank lines give nothing and skip nothing', () => {
    expect(parse('')).toEqual({ rows: [], skipped: 0 });
    expect(parse(HEADER)).toEqual({ rows: [], skipped: 0 });
    expect(parse(`\n${HEADER}\n\n${MILK}\n   \n`)).toEqual({ rows: [milkRow], skipped: 0 });
  });

  it('a standard (comma) feed handed to the cents adapter skips every row', () => {
    expect(parse('sku,product_name,price,regular_price,on_sale\nGS-001,Milk,3.20,3.20,false\nGS-002,Oil,1,,false\n')).toEqual({
      rows: [],
      skipped: 2,
    });
  });

  it.each(['item_code', 'price_cents', 'promo_price_cents'])('skips every row when the header lacks %p', (column) => {
    const names = HEADER.split(';');
    const keep = (line: string) => line.split(';').filter((_, index) => names[index] !== column).join(';');
    expect(parse(`${keep(HEADER)}\n${keep(SALMON)}\n${keep(MILK)}\n`)).toEqual({ rows: [], skipped: 2 });
  });

  it('matches the header ignoring case, spaces and order; description is optional', () => {
    expect(parse(' PROMO_PRICE_CENTS ;Item_Code;Price_Cents\n790;GS-012;949\n')).toEqual({ rows: [salmonRow], skipped: 0 });
  });

  it('reads a byte order mark and quoted fields', () => {
    expect(parse(`\uFEFF${HEADER}\n"GS-012";"SALMON; FRESH";"949";"790"\n`)).toEqual({ rows: [salmonRow], skipped: 0 });
  });

  it('trims item codes, keeps their case, and does not check them against the catalog', () => {
    expect(one('  gs-999 ;DISCONTINUED ITEM;499;').rows).toEqual([{ sku: 'gs-999', price: 4.99, regularPrice: 4.99, onSale: false }]);
  });
});

describe('centsProvider: never throws', () => {
  it.each([undefined, null, 42, {}, []])('treats the non-string input %p as an empty feed', (input) => {
    expect(centsProvider.parse(input as unknown as string)).toEqual({ rows: [], skipped: 0 });
  });

  it('survives an unterminated quote, stray quotes and NUL bytes', () => {
    for (const text of [`${HEADER}\n"GS-001;MILK;360;\n`, `${HEADER}\nGS-"001;MI"LK;360;\n`, `${HEADER}\nGS-001\u0000;M;360;\n`, ';;;\n;;;']) {
      expect(() => parse(text)).not.toThrow();
    }
  });

  it('on random feeds: never throws, every row is valid and rows + skipped = non-blank data lines', () => {
    const random = seededRandom(20261019);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
    const codes = ['GS-001', 'GS-999', '', ' ', 'gs-002'];
    const cents = ['360', '0', '', '3.99', 'abc', '949', '790', '-5', '1', '9999999999', '10000000000', ' 12 '];

    for (let run = 0; run < 300; run += 1) {
      const lines: string[] = [];
      const count = Math.floor(random() * 12);
      for (let i = 0; i < count; i += 1) {
        const cells = [pick(codes), 'NAME', pick(cents), pick(cents)];
        lines.push(cells.slice(0, 1 + Math.floor(random() * 4)).join(';'));
      }
      const result = parse([HEADER, ...lines].join(pick(['\n', '\r\n'])));
      expect(result.rows.length + result.skipped).toBe(lines.filter((line) => line.trim() !== '').length);
      expectValidRows(result);
    }
  });
});

describe('centsProvider: the delivered feeds (data/mock-api, M14.6)', () => {
  const dataDir = join(__dirname, '../../../../data/mock-api');
  const raw = (chain: string, date: string) => readFileSync(join(dataDir, chain, `${date}.csv`), 'utf8');
  const read = (chain: string, date: string) => parse(raw(chain, date));

  it.each([
    ['harvest', [34, 34, 34, 34], [0, 2, 4, 4]],
    ['citypantry', [37, 37, 37, 37], [1, 0, 3, 2]],
    ['budgetbasket', [36, 36, 36, 37], [2, 1, 4, 2]],
  ])('%s: rows and rows on sale per snapshot, nothing skipped', (chain, rows, onSale) => {
    const dates = readdirSync(join(dataDir, chain)).sort().map((file) => file.slice(0, 10));
    expect(dates).toEqual(['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09']);
    expect(dates.map((date) => read(chain, date).rows.length)).toEqual(rows);
    expect(dates.map((date) => read(chain, date).rows.filter((row) => row.onSale).length)).toEqual(onSale);
    expect(dates.map((date) => read(chain, date).skipped)).toEqual([0, 0, 0, 0]);
  });

  it('budgetbasket 2026-11-09 returns GS-999, which is not in the catalog (the sync ignores it)', () => {
    expect(read('budgetbasket', '2026-11-09').rows.at(-1)).toEqual({ sku: 'GS-999', price: 4.99, regularPrice: 4.99, onSale: false });
  });

  it('every sale row of the latest harvest snapshot', () => {
    expect(read('harvest', '2026-11-09').rows.filter((row) => row.onSale)).toEqual([
      { sku: 'GS-012', price: 7.9, regularPrice: 9.49, onSale: true },
      { sku: 'GS-021', price: 3.52, regularPrice: 4.05, onSale: true },
      { sku: 'GS-026', price: 7.56, regularPrice: 8.69, onSale: true },
      { sku: 'GS-040', price: 7.05, regularPrice: 8.11, onSale: true },
    ]);
  });

  it.each(['harvest', 'citypantry', 'budgetbasket'])(
    '%s 2026-11-09 reproduces the golden spreadsheet prices (the price paid) for GS-001 to GS-016',
    (chain) => {
      const column = GOLDEN_CHAINS.findIndex((golden) => golden.id === chain);
      const bySku = new Map(read(chain, '2026-11-09').rows.map((row) => [row.sku, row.price]));
      for (const product of GOLDEN_PRODUCTS) {
        expect([product.sku, bySku.get(product.sku)]).toEqual([product.sku, product.prices[column]]);
      }
    },
  );
});
