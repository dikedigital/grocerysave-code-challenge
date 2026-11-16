import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GOLDEN_CHAINS, GOLDEN_PRODUCTS } from '../../../../tests/fixtures/spreadsheet';
import { MAX_AMOUNT_CENTS } from '../parse';
import { expectValidRows, seededRandom } from './helpers';
import { standardProvider } from '../standard';
import type { ProviderParseResult } from '../types';

const HEADER = 'sku,product_name,price,regular_price,on_sale';
/** A feed made of the standard header and the given data lines (LF, final newline). */
const feed = (...lines: string[]) => [HEADER, ...lines].join('\n') + '\n';
const parse = (text: string): ProviderParseResult => standardProvider.parse(text);
/** Parses a feed holding a single data row. */
const one = (line: string) => parse(feed(line));

const MILK = 'GS-001,Whole Milk 1 gal,3.20,3.20,false';
const milkRow = { sku: 'GS-001', price: 3.2, regularPrice: 3.2, onSale: false };

describe('standardProvider: the requested cases', () => {
  it('a normal row', () => {
    expect(one(MILK)).toEqual({ rows: [milkRow], skipped: 0 });
  });

  it('a sale row: price is what the shopper pays, regularPrice the shelf price', () => {
    expect(one('GS-006,Large Eggs dozen,4.99,5.89,true')).toEqual({
      rows: [{ sku: 'GS-006', price: 4.99, regularPrice: 5.89, onSale: true }],
      skipped: 0,
    });
  });

  it('a row with an empty regular price: regularPrice equals price', () => {
    expect(one('GS-008,Butter 1 lb,5.99,,false')).toEqual({
      rows: [{ sku: 'GS-008', price: 5.99, regularPrice: 5.99, onSale: false }],
      skipped: 0,
    });
    expect(one('GS-008,Butter 1 lb,5.99,,true')).toEqual({
      rows: [{ sku: 'GS-008', price: 5.99, regularPrice: 5.99, onSale: true }],
      skipped: 0,
    });
  });

  it('a blank SKU is skipped and counted', () => {
    expect(one(',Mystery Item,3.50,3.50,false')).toEqual({ rows: [], skipped: 1 });
    expect(one('   ,Mystery Item,3.50,3.50,false')).toEqual({ rows: [], skipped: 1 });
  });

  it('a non-numeric price is skipped and counted', () => {
    expect(one('GS-099,Broken Price Item,abc,abc,false')).toEqual({ rows: [], skipped: 1 });
    expect(one('GS-001,Whole Milk 1 gal,n/a,3.20,false')).toEqual({ rows: [], skipped: 1 });
    expect(one('GS-001,Whole Milk 1 gal,,3.20,false')).toEqual({ rows: [], skipped: 1 });
  });

  it('a zero price is skipped and counted', () => {
    expect(one('GS-001,Whole Milk 1 gal,0,0,false')).toEqual({ rows: [], skipped: 1 });
    expect(one('GS-001,Whole Milk 1 gal,0.00,3.20,true')).toEqual({ rows: [], skipped: 1 });
  });

  it('an unrecognised sale flag is skipped and counted', () => {
    expect(one('GS-001,Whole Milk 1 gal,3.20,3.20,maybe')).toEqual({ rows: [], skipped: 1 });
    expect(one('GS-001,Whole Milk 1 gal,3.20,3.20,on sale')).toEqual({ rows: [], skipped: 1 });
  });

  it('a short row (too few fields) is skipped and counted', () => {
    expect(one('GS-001,Whole Milk 1 gal,3.20,3.20')).toEqual({ rows: [], skipped: 1 });
    expect(one('GS-001')).toEqual({ rows: [], skipped: 1 });
  });

  it('a feed with the wrong header skips every data row', () => {
    const misspelt = ['sku,product_name,cost,regular_price,on_sale', MILK, 'GS-002,Olive Oil,17.25,17.25,false'];
    expect(parse(misspelt.join('\n'))).toEqual({ rows: [], skipped: 2 });
    // A `cents` feed handed to the standard adapter: its header has none of the columns.
    const cents = 'item_code;description;price_cents;promo_price_cents\nGS-001;WHOLE MILK 1 GAL;360;\n';
    expect(parse(cents)).toEqual({ rows: [], skipped: 1 });
  });

  it('an empty feed gives no rows and nothing skipped', () => {
    expect(parse('')).toEqual({ rows: [], skipped: 0 });
  });

  it('bad rows never stop the good ones: a mixed feed keeps the valid rows in file order', () => {
    const text = feed(
      MILK,
      ',Mystery Item,3.50,3.50,false',
      'GS-006,Large Eggs dozen,4.99,5.89,true',
      'GS-099,Broken Price Item,abc,abc,false',
      'GS-007,Ground Coffee 12 oz,0,8.17,false',
      'GS-008,Butter 1 lb,5.99,5.99,maybe',
      'GS-009,Laundry Detergent 64 oz,10.00',
      'GS-011,Bananas 1 lb,1.09,,false',
    );
    expect(parse(text)).toEqual({
      rows: [
        milkRow,
        { sku: 'GS-006', price: 4.99, regularPrice: 5.89, onSale: true },
        { sku: 'GS-011', price: 1.09, regularPrice: 1.09, onSale: false },
      ],
      skipped: 5,
    });
  });
});

describe('standardProvider: amounts (D-63)', () => {
  it.each([
    ['3.20', 3.2],
    ['3.2', 3.2],
    ['3', 3],
    ['$4.01', 4.01],
    ['0.01', 0.01],
    ['03.20', 3.2],
    [' 3.20 ', 3.2],
    ['1234.56', 1234.56],
    ['99999999.99', 99999999.99],
  ])('accepts %p as %p', (text, value) => {
    expect(one(`GS-001,Milk,${text},,false`).rows[0]?.price).toBe(value);
  });

  it('keeps exact cents (no binary drift from parsing)', () => {
    for (const [text, value] of [['0.29', 0.29], ['1.10', 1.1], ['4.35', 4.35], ['19.99', 19.99], ['0.07', 0.07]] as const) {
      expect(one(`GS-001,Milk,${text},,false`).rows[0].price).toBe(value);
    }
  });

  it.each([
    'abc', 'n/a', '1.999', '.50', '5.', '1,000.00', '$ 3.00', '-3.00', '$-3.00', '+3.00', '0',
    '0.00', '$0', '1e3', '0x10', 'Infinity', 'NaN', '3.20 USD', '3 .20', '3$', 'US$3', '100000000.00',
  ])('rejects the price %p', (text) => {
    expect(one(`GS-001,Milk,${text},3.20,false`)).toEqual({ rows: [], skipped: 1 });
  });

  it.each(['abc', '0', '0.00', '-1', '1.999'])('rejects a present but invalid regular_price %p', (text) => {
    expect(one(`GS-001,Milk,3.20,${text},false`)).toEqual({ rows: [], skipped: 1 });
    expect(one(`GS-001,Milk,3.20,${text},true`)).toEqual({ rows: [], skipped: 1 });
  });

  it('the largest accepted amount is the limit of the numeric(10, 2) price column (D-70)', () => {
    expect(MAX_AMOUNT_CENTS).toBe(9_999_999_999);
    expect(one('GS-001,Milk,99999999.99,,false').rows).toHaveLength(1);
    expect(one('GS-001,Milk,100000000,,false').skipped).toBe(1);
    expect(one('GS-001,Milk,3.20,123456789012345678901234567890,true').skipped).toBe(1);
  });
});

describe('standardProvider: sale flags (D-64)', () => {
  it.each(['true', 'TRUE', 'True', 'y', 'Y', 'yes', 'YES', '1', ' true '])('%p means on sale', (flag) => {
    expect(one(`GS-001,Milk,2.99,3.20,${flag}`).rows).toEqual([
      { sku: 'GS-001', price: 2.99, regularPrice: 3.2, onSale: true },
    ]);
  });

  it.each(['false', 'FALSE', 'n', 'N', 'no', 'No', '0', '', '  '])('%p means not on sale', (flag) => {
    expect(one(`GS-001,Milk,3.20,3.20,${flag}`).rows).toEqual([milkRow]);
  });

  it.each(['maybe', 't', 'f', '2', '-1', 'on', 'off', 'yes!', 'si', 'true false'])('%p is malformed', (flag) => {
    expect(one(`GS-001,Milk,3.20,3.20,${flag}`)).toEqual({ rows: [], skipped: 1 });
  });
});

describe('standardProvider: inconsistent sale data is normalised, not skipped (D-65)', () => {
  it('on sale with a regular price below the price: regularPrice is raised to the price', () => {
    expect(one('GS-001,Milk,3.00,2.00,true')).toEqual({
      rows: [{ sku: 'GS-001', price: 3, regularPrice: 3, onSale: true }],
      skipped: 0,
    });
  });

  it('on sale with a regular price equal to the price stays on sale', () => {
    expect(one('GS-001,Milk,3.00,3.00,true').rows).toEqual([
      { sku: 'GS-001', price: 3, regularPrice: 3, onSale: true },
    ]);
  });

  it('not on sale with a different regular price: regularPrice equals price', () => {
    expect(one('GS-001,Milk,3.00,3.50,false').rows).toEqual([
      { sku: 'GS-001', price: 3, regularPrice: 3, onSale: false },
    ]);
    expect(one('GS-001,Milk,3.00,2.50,false').rows).toEqual([
      { sku: 'GS-001', price: 3, regularPrice: 3, onSale: false },
    ]);
  });
});

describe('standardProvider: SKUs (D-66)', () => {
  it('trims the SKU and keeps its case', () => {
    expect(one('  gs-001  ,Milk,3.20,3.20,false').rows[0].sku).toBe('gs-001');
  });

  it('returns SKUs that are not in the catalog (the sync ignores them)', () => {
    expect(one('GS-999,Discontinued,4.99,,false')).toEqual({
      rows: [{ sku: 'GS-999', price: 4.99, regularPrice: 4.99, onSale: false }],
      skipped: 0,
    });
  });

  it('returns a repeated SKU as many times as it appears, in file order', () => {
    expect(parse(feed('GS-001,Milk,3.20,,false', 'GS-001,Milk,2.99,3.20,true')).rows).toEqual([
      milkRow,
      { sku: 'GS-001', price: 2.99, regularPrice: 3.2, onSale: true },
    ]);
  });
});

describe('standardProvider: header (D-61)', () => {
  it('matches column names ignoring case and surrounding spaces', () => {
    expect(parse(' SKU , Product_Name ,PRICE, Regular_Price ,On_Sale\n' + MILK)).toEqual({ rows: [milkRow], skipped: 0 });
  });

  it('finds the columns in any order and ignores extra columns', () => {
    const text = 'on_sale,store,regular_price,sku,price,product_name\nfalse,Beacon,3.20,GS-001,3.20,Whole Milk\n';
    expect(parse(text)).toEqual({ rows: [milkRow], skipped: 0 });
  });

  it('does not need product_name', () => {
    expect(parse('sku,price,regular_price,on_sale\nGS-001,3.20,3.20,false\n')).toEqual({ rows: [milkRow], skipped: 0 });
  });

  it('uses the left-most of two columns with the same name', () => {
    const text = 'sku,price,regular_price,on_sale,price\nGS-001,3.20,3.20,false,9.99\n';
    expect(parse(text).rows).toEqual([milkRow]);
  });

  it.each(['sku', 'price', 'regular_price', 'on_sale'])('skips every row when the header lacks %p', (column) => {
    const header = HEADER.split(',').filter((name) => name !== column).join(',');
    const values = MILK.split(',').filter((_, index) => HEADER.split(',')[index] !== column).join(',');
    expect(parse(`${header}\n${values}\n${values}\n`)).toEqual({ rows: [], skipped: 2 });
  });

  it('a feed without a header line: the first row is taken as the header, the rest are skipped', () => {
    expect(parse(`${MILK}\nGS-002,Olive Oil,17.25,17.25,false\n`)).toEqual({ rows: [], skipped: 1 });
  });

  it('a header alone gives no rows and nothing skipped', () => {
    expect(parse(HEADER)).toEqual({ rows: [], skipped: 0 });
    expect(parse(`${HEADER}\n`)).toEqual({ rows: [], skipped: 0 });
  });
});

describe('standardProvider: file shape (D-60)', () => {
  it('reads CRLF line endings', () => {
    expect(parse(`${HEADER}\r\n${MILK}\r\nGS-006,Eggs,4.99,5.89,true\r\n`)).toEqual({
      rows: [milkRow, { sku: 'GS-006', price: 4.99, regularPrice: 5.89, onSale: true }],
      skipped: 0,
    });
  });

  it('reads a file with a UTF-8 byte order mark', () => {
    expect(parse(`\uFEFF${HEADER}\n${MILK}\n`)).toEqual({ rows: [milkRow], skipped: 0 });
  });

  it('reads quoted fields, including a comma inside a product name', () => {
    expect(parse(`${HEADER}\n"GS-001","Milk, whole, 1 gal","3.20","3.20","false"\n`)).toEqual({ rows: [milkRow], skipped: 0 });
  });

  it('blank and whitespace-only lines are not rows and are not counted', () => {
    expect(parse(`\n\n${HEADER}\n\n${MILK}\n   \n\t\n`)).toEqual({ rows: [milkRow], skipped: 0 });
  });

  it('a line made only of separators is a row with an empty SKU: skipped and counted', () => {
    expect(one(',,,,')).toEqual({ rows: [], skipped: 1 });
  });

  it('empty cells beyond the header are ignored (a trailing comma is harmless) (D-74)', () => {
    expect(one(`${MILK},`)).toEqual({ rows: [milkRow], skipped: 0 });
    expect(one(`${MILK},,`)).toEqual({ rows: [milkRow], skipped: 0 });
  });

  it('a non-empty cell beyond the header makes the row malformed (D-74)', () => {
    expect(one(`${MILK},extra,cells`)).toEqual({ rows: [], skipped: 1 });
    // An unquoted decimal comma in the last column: "false,5" would otherwise pass as "false".
    expect(one('GS-001,Whole Milk 1 gal,3.20,3.20,false,5')).toEqual({ rows: [], skipped: 1 });
  });

  it('an unquoted comma inside a name shifts the columns, and the row is skipped', () => {
    expect(one('GS-001,Milk, whole,3.20,3.20,false')).toEqual({ rows: [], skipped: 1 });
  });

  it('always splits on commas, never guesses the delimiter (D-16, D-60)', () => {
    // parseCsv would guess ';' here: the header line has more semicolons than commas.
    const text = 'sku,price,regular_price,on_sale,"notes; size; origin; brand; aisle; shelf"\nGS-001,3.20,3.20,false,x\n';
    expect(parse(text)).toEqual({ rows: [milkRow], skipped: 0 });
  });

  it('a file with no final newline reads its last row', () => {
    expect(parse(`${HEADER}\n${MILK}`)).toEqual({ rows: [milkRow], skipped: 0 });
  });
});

describe('standardProvider: never throws', () => {
  it('has the id stored in chains.provider, and parse works detached from the object', () => {
    expect(standardProvider.id).toBe('standard');
    const { parse: detached } = standardProvider;
    expect(detached(feed(MILK))).toEqual({ rows: [milkRow], skipped: 0 });
  });

  it.each([undefined, null, 42, {}, []])('treats the non-string input %p as an empty feed', (input) => {
    expect(standardProvider.parse(input as unknown as string)).toEqual({ rows: [], skipped: 0 });
  });

  it('survives an unterminated quote, stray quotes, NUL bytes and other delimiters', () => {
    for (const text of [
      `${HEADER}\n"GS-001,Milk,3.20,3.20,false\n`,
      `${HEADER}\nGS-"001,Mi"lk,3.20,3.20,false\n`,
      `${HEADER}\nGS-001\u0000,Milk,3.20,3.20,false\n`,
      `${HEADER}\nGS-001;Milk;3.20;3.20;false\n`,
      '\uFEFF',
      '\r\n\r\n',
      ',,,,\n,,,,',
    ]) {
      expect(() => parse(text)).not.toThrow();
    }
  });

  it('on random feeds: never throws, every row is valid and rows + skipped = non-blank data lines', () => {
    const random = seededRandom(20261109);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
    const skus = ['GS-001', 'GS-999', '', ' ', 'gs-002', '"GS-003"'];
    const amounts = ['3.20', '0', '0.00', '', 'abc', '1.999', '$4.01', '-1', '12', '.5', '99999999.99', '100000000'];
    const flags = ['true', 'false', 'Y', 'n', '', 'maybe', '1', '0', 'yes'];

    for (let run = 0; run < 300; run += 1) {
      const lines: string[] = [];
      const count = Math.floor(random() * 12);
      for (let i = 0; i < count; i += 1) {
        const cells = [pick(skus), 'Name', pick(amounts), pick(amounts), pick(flags)];
        lines.push(cells.slice(0, 1 + Math.floor(random() * 5)).join(','));
      }
      const text = [HEADER, ...lines].join(pick(['\n', '\r\n']));
      const result = parse(text);
      // A generated line that is empty or only spaces is a blank line, not a row (D-60).
      expect(result.rows.length + result.skipped).toBe(lines.filter((line) => line.trim() !== '').length);
      expectValidRows(result);
    }
  });
});

describe('standardProvider: the delivered feeds (data/mock-api, M14.6)', () => {
  const dataDir = join(__dirname, '../../../../data/mock-api');
  const read = (chain: string, date: string) => parse(readFileSync(join(dataDir, chain, `${date}.csv`), 'utf8'));

  it.each([
    ['freshmart', [37, 37, 37, 37], [0, 0, 0, 0]],
    ['valugrocer', [36, 36, 36, 36], [0, 0, 0, 2]],
    ['greenleaf', [35, 35, 35, 35], [0, 0, 0, 0]],
  ])('%s: rows and skipped per snapshot', (chain, rows, skipped) => {
    const dates = readdirSync(join(dataDir, chain)).sort().map((file) => file.slice(0, 10));
    expect(dates).toEqual(['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09']);
    expect(dates.map((date) => read(chain, date).rows.length)).toEqual(rows);
    expect(dates.map((date) => read(chain, date).skipped)).toEqual(skipped);
  });

  it('valugrocer 2026-11-09 skips exactly the empty-SKU row and the `abc` row', () => {
    const { rows } = read('valugrocer', '2026-11-09');
    expect(rows.map((row) => row.sku)).not.toContain('GS-099');
    expect(rows.map((row) => row.sku)).not.toContain('');
    expect(rows.at(-1)).toEqual({ sku: 'GS-040', price: 7.5, regularPrice: 7.5, onSale: false });
  });

  it.each(['freshmart', 'valugrocer', 'greenleaf'])(
    '%s 2026-11-09 reproduces the golden spreadsheet prices for GS-001 to GS-016',
    (chain) => {
      const column = GOLDEN_CHAINS.findIndex((golden) => golden.id === chain);
      const bySku = new Map(read(chain, '2026-11-09').rows.map((row) => [row.sku, row.price]));
      for (const product of GOLDEN_PRODUCTS) {
        expect([product.sku, bySku.get(product.sku)]).toEqual([product.sku, product.prices[column]]);
      }
    },
  );

  it('reads the sale rows of the latest FreshMart snapshot', () => {
    const onSale = read('freshmart', '2026-11-09').rows.filter((row) => row.onSale);
    expect(onSale).toEqual([
      { sku: 'GS-006', price: 4.99, regularPrice: 5.89, onSale: true },
      { sku: 'GS-019', price: 3.43, regularPrice: 3.94, onSale: true },
      { sku: 'GS-032', price: 7.29, regularPrice: 8.38, onSale: true },
      { sku: 'GS-036', price: 5.2, regularPrice: 5.98, onSale: true },
    ]);
  });
});
