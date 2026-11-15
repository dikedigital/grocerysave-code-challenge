import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Product } from '../../models';
import { TEST_CATALOG } from '../../../tests/fixtures/catalog';
import { parseCsvRecords } from '../csv';
import { matchProduct, normalizeName, rankProducts } from '../matching';

function bySku(sku: string): Product {
  const product = TEST_CATALOG.find((candidate) => candidate.sku === sku);
  if (!product) throw new Error(`no product ${sku}`);
  return product;
}

function product(sku: string, name: string, aliases: string[] = []): Product {
  return { id: `id-${sku}`, sku, name, category: 'Test', unit: 'each', aliases };
}

/** The sku matchProduct picks, or null. */
function matchedSku(name: string, products: Product[] = TEST_CATALOG, threshold?: number): string | null {
  return matchProduct(name, products, threshold)?.product.sku ?? null;
}

describe('normalizeName', () => {
  it.each([
    ['Eggs', 'egg'],
    ['  Whole   MILK  ', 'whole milk'],
    ['café', 'cafe'],
    ['Crème Fraîche', 'creme fraiche'],
    ['JALAPEÑO', 'jalapeno'],
    ['Straße', 'strasse'],
    ['Smörgåsbord', 'smorgasbord'],
    ['Æbleskiver', 'aebleskiver'],
    ['ﬁsh', 'fish'], // ligature
    ['whole-wheat bread', 'whole wheat bread'],
    ['Salt & Pepper', 'salt pepper'],
    ['Milk (2%), organic!', 'milk 2 organic'],
    ["Jack's", 'jack'], // apostrophe joins, then the plural "s" goes
    ['Ben & Jerry’s', 'ben jerry'],
    ['Vanilla Ice Cream 1.5 qt', 'vanilla ice cream 1.5 qt'],
    ['Rice 1,5 kg', 'rice 1.5 kg'],
    ['end. 5', 'end 5'], // a dot is only kept between two digits
    ['Tomatoes', 'tomato'],
    ['tab\tand\nnewline', 'tab and newline'],
    ['', ''],
    ['  !!!  ', ''],
  ])('%p -> %p', (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });

  it.each([
    ['eggs', 'egg'],
    ['olives', 'olive'],
    ['bananas', 'banana'],
    ['apples', 'apple'],
    ['grapes', 'grape'],
    ['tomatoes', 'tomato'],
    ['potatoes', 'potato'],
    ['berries', 'berry'],
    ['nappies', 'nappy'],
    ['peaches', 'peach'],
    ['radishes', 'radish'],
    ['boxes', 'box'],
    ['glasses', 'glass'],
    ['loaves', 'loaf'],
    ['leaves', 'leaf'],
    ['cookies', 'cookie'],
    ['brownies', 'brownie'],
    ['chips', 'chip'],
    ['wipes', 'wipe'],
  ])('singularises the plural %p -> %p', (plural, singular) => {
    expect(normalizeName(plural)).toBe(singular);
  });

  it.each(['egg', 'olive', 'cookie', 'berry', 'swiss', 'hummus', 'asparagus', 'couscous', 'gas', 'oz', 'lbs', 'tp', 'oj', '12s', 'kiwi', 'tofu'])(
    'leaves %p unchanged',
    (word) => {
      expect(normalizeName(word)).toBe(word);
    }
  );

  it('gives the singular and the plural the same form', () => {
    expect(normalizeName('Roma Tomatoes')).toBe(normalizeName('roma tomato'));
    expect(normalizeName('Cookies')).toBe(normalizeName('cookie'));
    expect(normalizeName('Large Eggs')).toBe(normalizeName('large egg'));
  });

  it('is idempotent on every name and alias of the catalog', () => {
    for (const { name, aliases } of [...TEST_CATALOG, ...loadCatalog()]) {
      for (const form of [name, ...aliases]) expect(normalizeName(normalizeName(form))).toBe(normalizeName(form));
    }
  });
});

describe('matchProduct: the requested examples', () => {
  it('"Eggs" is an exact alias after normalisation', () => {
    expect(matchProduct('Eggs', TEST_CATALOG)).toEqual({ product: bySku('T-003'), score: 1 });
  });

  it('"dozen large eggs" has the same words as "Large Eggs dozen" in another order', () => {
    expect(matchProduct('dozen large eggs', TEST_CATALOG)).toEqual({ product: bySku('T-003'), score: 1 });
  });

  it('"EXTRA virgin olive oil" is an exact alias, whatever the case', () => {
    expect(matchProduct('EXTRA virgin olive oil', TEST_CATALOG)).toEqual({ product: bySku('T-004'), score: 1 });
  });

  it('"olive" ties at 0.5 between the olives and the olive oil; the shorter name wins', () => {
    const ranked = rankProducts('olive', TEST_CATALOG);
    expect(ranked.map((match) => [match.product.sku, match.score])).toEqual([
      ['T-005', 0.5], // "Green Olives" (12 characters)
      ['T-004', 0.5], // "Extra Virgin Olive Oil 1 L" (26 characters)
    ]);
    expect(matchedSku('olive')).toBe('T-005');
    expect(matchedSku('olives')).toBe('T-005');
  });

  it('"café" matches through the accent-free alias, in any case or spelling', () => {
    for (const typed of ['café', 'CAFÉ', 'cafe', 'Café']) {
      expect(matchProduct(typed, TEST_CATALOG)).toEqual({ product: bySku('T-007'), score: 1 });
    }
  });

  it('"tomatoes" is an exact alias of the Roma tomatoes and beats the partial matches', () => {
    expect(matchProduct('tomatoes', TEST_CATALOG)).toEqual({ product: bySku('T-008'), score: 1 });
    expect(matchProduct('tomato', TEST_CATALOG)).toEqual({ product: bySku('T-008'), score: 1 });
    expect(rankProducts('tomatoes', TEST_CATALOG).map((match) => match.product.sku)).toEqual(['T-008', 'T-009', 'T-010']);
  });

  it.each(['dish soap', 'toothpaste', 'xyz', 'bread'])('"%s" matches nothing', (typed) => {
    expect(matchProduct(typed, TEST_CATALOG)).toBeNull();
  });
});

describe('matchProduct: scoring', () => {
  it('matches the product name itself, not only the aliases', () => {
    expect(matchProduct('Ground Coffee 12 oz', TEST_CATALOG)).toEqual({ product: bySku('T-007'), score: 1 });
    expect(matchProduct('creme fraiche 8 oz', TEST_CATALOG)).toEqual({ product: bySku('T-011'), score: 1 });
  });

  it('scores partial matches with Jaccard overlap against the best of name and aliases', () => {
    // {cherry, tomato, salad} vs alias {cherry, tomato}: 2 shared / 3 in the union
    expect(matchProduct('cherry tomato salad', TEST_CATALOG)?.score).toBeCloseTo(2 / 3, 10);
    expect(matchProduct('cherry tomato salad', TEST_CATALOG)?.product.sku).toBe('T-009');
    // {boneless, chicken} vs alias {boneless, chicken, breast}: 2 / 3
    expect(matchProduct('boneless chicken', TEST_CATALOG)).toEqual({ product: bySku('T-006'), score: 2 / 3 });
  });

  it('counts each word once', () => {
    expect(matchProduct('milk milk milk', TEST_CATALOG)).toEqual({ product: bySku('T-001'), score: 1 });
  });

  it('lets an exact match win over any partial match', () => {
    expect(matchedSku('almond milk')).toBe('T-002');
    expect(matchedSku('milk')).toBe('T-001');
  });

  it('does not depend on the order of the catalog', () => {
    const reversed = [...TEST_CATALOG].reverse();
    for (const typed of ['olive', 'tomatoes', 'oat milk', 'cherry tomato salad', 'Eggs']) {
      expect(matchedSku(typed, reversed)).toBe(matchedSku(typed));
    }
  });

  it('does not modify the products', () => {
    const copy = JSON.parse(JSON.stringify(TEST_CATALOG));
    matchProduct('olive', TEST_CATALOG);
    expect(TEST_CATALOG).toEqual(copy);
  });

  it('sees a product edited after an earlier match (no stale cache)', () => {
    const edited = product('E-1', 'Sparkling Water', ['seltzer']);
    expect(matchProduct('seltzer', [edited])?.score).toBe(1);
    expect(matchProduct('fizzy pop', [edited])).toBeNull();
    edited.aliases = ['fizzy pop'];
    expect(matchProduct('fizzy pop', [edited])?.score).toBe(1);
    expect(matchProduct('seltzer', [edited])).toBeNull();
    edited.name = 'Seltzer';
    expect(matchProduct('seltzer', [edited])?.score).toBe(1);
  });
});

describe('matchProduct: threshold', () => {
  const catalog = [product('A-1', 'Chicken Breast'), product('A-2', 'Peanut Butter Cookies')];

  it('matches a score equal to the threshold (0.5 by default)', () => {
    // {chicken} vs {chicken, breast}: 1/2
    expect(matchProduct('chicken', catalog)).toEqual({ product: catalog[0], score: 0.5 });
  });

  it('returns null below the threshold', () => {
    // {chicken, thigh} vs {chicken, breast}: 1/3
    expect(matchProduct('chicken thighs', catalog)).toBeNull();
    expect(matchProduct('chicken', catalog, 0.51)).toBeNull();
  });

  it('accepts a custom threshold', () => {
    expect(matchProduct('chicken thighs', catalog, 0.3)).toEqual({ product: catalog[0], score: 1 / 3 });
    expect(matchProduct('chicken breast', catalog, 1)).toEqual({ product: catalog[0], score: 1 });
    expect(matchProduct('breast chicken', catalog, 1)).toEqual({ product: catalog[0], score: 1 });
  });

  it('never matches a name that shares no word, even with a threshold of 0', () => {
    expect(matchProduct('dish soap', catalog, 0)).toBeNull();
    expect(rankProducts('dish soap', catalog, 0)).toEqual([]);
  });

  it('returns null for a blank name or an empty catalog', () => {
    expect(matchProduct('', catalog)).toBeNull();
    expect(matchProduct('   ', catalog)).toBeNull();
    expect(matchProduct('!!!', catalog, 0)).toBeNull();
    expect(matchProduct('chicken', [])).toBeNull();
  });

  it('ignores aliases that normalise to nothing', () => {
    const odd = [product('B-1', 'Widget', ['!!!', '', '  '])];
    expect(matchProduct('', odd, 0)).toBeNull();
    expect(matchProduct('gadget', odd, 0)).toBeNull();
    expect(matchedSku('widget', odd)).toBe('B-1');
  });
});

describe('matchProduct: ties', () => {
  it('goes to the shorter product name', () => {
    const catalog = [product('C-1', 'Olive Oil Extra Virgin', ['olive oil']), product('C-2', 'Olive Oil', ['oil'])];
    expect(matchProduct('olive oil', catalog)).toEqual({ product: catalog[1], score: 1 });
  });

  it('compares the product names, not the alias that matched', () => {
    // Both score 1 through an alias; the long alias belongs to the product with the short name.
    const catalog = [product('D-1', 'Long product name', ['soda']), product('D-2', 'Soda', ['soda pop drink'])];
    expect(matchProduct('soda', catalog)?.product.sku).toBe('D-2');
    const aliasOnly = [product('D-3', 'A much longer name', ['fizz']), product('D-4', 'Short', ['fizz'])];
    expect(matchProduct('fizz', aliasOnly)?.product.sku).toBe('D-4');
  });

  it('then goes to the lower sku', () => {
    const catalog = [product('SKU-9', 'Milk A', ['milk']), product('SKU-10', 'Milk B', ['milk']), product('SKU-2', 'Milk C', ['milk'])];
    // Plain code-unit order: "SKU-10" < "SKU-2" < "SKU-9".
    expect(matchedSku('milk', catalog)).toBe('SKU-10');
    expect(matchedSku('milk', [...catalog].reverse())).toBe('SKU-10');
  });

  it('ranks a higher partial score above a shorter name', () => {
    const catalog = [product('E-1', 'Tea'), product('E-2', 'Green Tea Bags')];
    // {green, tea} vs {tea}: 1/2; vs {green, tea, bag}: 2/3
    expect(matchedSku('green tea', catalog)).toBe('E-2');
  });
});

describe('rankProducts', () => {
  it('lists every candidate at or above the threshold, in matchProduct order', () => {
    const ranked = rankProducts('tomato', TEST_CATALOG);
    expect(ranked.map(({ product: { sku }, score }) => [sku, score])).toEqual([
      ['T-008', 1],
      ['T-009', 0.5],
      ['T-010', 0.5],
    ]);
    expect(ranked[0]).toEqual(matchProduct('tomato', TEST_CATALOG));
  });

  it('is empty when nothing reaches the threshold', () => {
    expect(rankProducts('dish soap', TEST_CATALOG)).toEqual([]);
  });
});

/** data/products.csv, the seeded catalog. */
function loadCatalog(): Product[] {
  const csv = readFileSync(join(__dirname, '../../../data/products.csv'), 'utf8');
  return parseCsvRecords(csv).map((row) => ({
    id: row.sku,
    sku: row.sku,
    name: row.name,
    category: row.category,
    unit: row.unit,
    aliases: row.aliases === '' ? [] : row.aliases.split('|'),
  }));
}

describe('matchProduct on the seeded catalog (data/products.csv)', () => {
  const catalog = loadCatalog();

  it('loads the 40 products', () => {
    expect(catalog).toHaveLength(40);
  });

  it('matches every product name and alias to its own product with score 1', () => {
    const wrong: string[] = [];
    for (const own of catalog) {
      for (const form of [own.name, ...own.aliases]) {
        const match = matchProduct(form, catalog);
        if (match?.product.sku !== own.sku || match.score !== 1) wrong.push(`${form} -> ${match?.product.sku ?? 'null'}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('has no normalised alias shared by two products', () => {
    const owner = new Map<string, string>();
    const shared: string[] = [];
    for (const { sku, name, aliases } of catalog) {
      for (const form of new Set([name, ...aliases].map(normalizeName))) {
        const previous = owner.get(form);
        if (previous && previous !== sku) shared.push(`${form}: ${previous}, ${sku}`);
        owner.set(form, sku);
      }
    }
    expect(shared).toEqual([]);
  });

  it.each([
    ['Milk', 'GS-001'],
    ['EVOO', 'GS-002'],
    ['chicken breasts', 'GS-003'],
    ['Eggs', 'GS-006'],
    ['banana', 'GS-011'],
    ['Tomato', 'GS-018'],
    ['Nappy', 'GS-015'],
    ['loo rolls', 'GS-010'],
    ['OJ', 'GS-014'],
    ['Yoghurt', 'GS-022'],
    ['Corn-flakes', 'GS-030'],
  ])('%p -> %p', (typed, sku) => {
    expect(matchedSku(typed, catalog)).toBe(sku);
  });

  it('matches 500 names against the catalog quickly (the API accepts up to 500 items)', () => {
    const started = Date.now();
    for (let i = 0; i < 500; i++) matchProduct(`boneless chicken thighs ${i}`, catalog);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
