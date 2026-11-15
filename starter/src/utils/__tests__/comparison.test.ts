import { SCENARIOS, line, store, type Scenario } from '../../../tests/fixtures/comparisonScenarios';
import { GOLDEN_LINES, GOLDEN_PRICES, GOLDEN_STORES, goldenLineKey, goldenStoreId } from '../../../tests/fixtures/golden';
import { GOLDEN_CHAINS, GOLDEN_EXPECTED, GOLDEN_PRODUCTS } from '../../../tests/fixtures/spreadsheet';
import type { ComparisonResult } from '../../models';
import { compareBasket, filterStores } from '../comparison';
import { roundTo } from '../money';

/*
 * The golden basket: one unit of each of the 16 spreadsheet products at the 8 chains.
 *
 * Two kinds of check, neither with a number typed into this file:
 * - against GOLDEN_EXPECTED, the spreadsheet's own figures. Exact-cent fields must be equal (toBe,
 *   so 135.51000000000002 fails); unrounded fields are shown rounded to 2 decimals in the sheet, so
 *   they must round to that value.
 * - against an independent reference computed below from GOLDEN_PRODUCTS in integer cents, so that
 *   the unrounded fields are proven unrounded (averageTotal is 144.0925, not 144.09).
 */

const result = compareBasket(GOLDEN_LINES, GOLDEN_STORES, GOLDEN_PRICES);

// ---------- Independent reference, from the raw spreadsheet prices ----------

const cents = (amount: number) => Math.round(amount * 100); // safe for the sheet's 2-decimal prices
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const mean = (values: number[]) => sum(values) / values.length;

const priceCents = GOLDEN_PRODUCTS.map((product) => product.prices.map(cents)); // [product][chain]
const refRows = priceCents.map((row) => {
  const low = Math.min(...row);
  const high = Math.max(...row);
  const average = mean(row);
  return { low, high, average, savings: average - low, savingsPct: ((average - low) / average) * 100 };
});
const refStoreTotals = GOLDEN_CHAINS.map((_, chain) => sum(priceCents.map((row) => row[chain])));
const refOptimal = sum(refRows.map((row) => row.low));
const refHigh = sum(refRows.map((row) => row.high));
const refCheapest = Math.min(...refStoreTotals);
const refAverageTotal = mean(refStoreTotals);

const storeTotalOf = (chainIndex: number) => {
  const total = result.storeTotals.find((entry) => entry.storeId === goldenStoreId(GOLDEN_CHAINS[chainIndex].id));
  if (!total) throw new Error(`no store total for ${GOLDEN_CHAINS[chainIndex].id}`);
  return total;
};

const chainCases = GOLDEN_CHAINS.map((chain, index) => [chain.name, index] as const);
const productCases = GOLDEN_PRODUCTS.map((product, index) => [product.name, index] as const);

describe('compareBasket: golden basket, shape', () => {
  it('has one column per store, in the order of the stores argument', () => {
    expect(result.storeIds).toEqual(GOLDEN_STORES.map((store) => store.id));
    expect(result.storeTotals.map((entry) => entry.storeId)).toEqual(result.storeIds);
  });

  it('has one row per line, in basket order, carrying the line fields', () => {
    expect(result.rows.map(({ key, label, quantity, productId }) => ({ key, label, quantity, productId }))).toEqual(GOLDEN_LINES);
  });

  it('prices every line, and every store is complete', () => {
    expect(result.summary.unpricedKeys).toEqual([]);
    for (const entry of result.storeTotals) {
      expect(entry.complete).toBe(true);
      expect(entry.missingKeys).toEqual([]);
    }
  });
});

describe('compareBasket: golden basket, store totals ("Total cost")', () => {
  it.each(chainCases)('%s', (_, chain) => {
    expect(storeTotalOf(chain).total).toBe(GOLDEN_EXPECTED.storeTotals[chain]);
    expect(storeTotalOf(chain).total * 100).toBeCloseTo(refStoreTotals[chain], 9);
  });
});

describe('compareBasket: golden basket, vs optimal ("Comp optimal")', () => {
  it.each(chainCases)('%s: dollars (exact cents) and percent of the optimal total (unrounded)', (_, chain) => {
    const entry = storeTotalOf(chain);
    expect(entry.vsOptimal).toBe(GOLDEN_EXPECTED.vsOptimal[chain]);
    expect(roundTo(entry.vsOptimalPct, 2)).toBe(GOLDEN_EXPECTED.vsOptimalPct[chain]);
    expect(entry.vsOptimalPct).toBeCloseTo(((refStoreTotals[chain] - refOptimal) / refOptimal) * 100, 10);
  });
});

describe('compareBasket: golden basket, vs cheapest store ("Comp lower")', () => {
  it.each(chainCases)('%s: dollars (exact cents) and percent of the cheapest store total (unrounded)', (_, chain) => {
    const entry = storeTotalOf(chain);
    expect(entry.vsCheapestStore).toBe(GOLDEN_EXPECTED.vsCheapestStore[chain]);
    expect(roundTo(entry.vsCheapestStorePct, 2)).toBe(GOLDEN_EXPECTED.vsCheapestStorePct[chain]);
    expect(entry.vsCheapestStorePct).toBeCloseTo(((refStoreTotals[chain] - refCheapest) / refCheapest) * 100, 10);
  });
});

describe('compareBasket: golden basket, summary (totals row)', () => {
  const { summary } = result;

  it('optimal total = sum of row lows (exact cents)', () => {
    expect(summary.optimalTotal).toBe(GOLDEN_EXPECTED.optimalTotal);
    expect(summary.optimalTotal * 100).toBeCloseTo(refOptimal, 9);
  });

  it('high total = sum of row highs (exact cents)', () => {
    expect(summary.highTotal).toBe(GOLDEN_EXPECTED.highTotal);
    expect(summary.highTotal * 100).toBeCloseTo(refHigh, 9);
  });

  it('average total = mean of the store totals (unrounded)', () => {
    expect(roundTo(summary.averageTotal, 2)).toBe(GOLDEN_EXPECTED.averageTotal);
    expect(summary.averageTotal).toBeCloseTo(refAverageTotal / 100, 12);
    expect(summary.averageTotal).not.toBe(GOLDEN_EXPECTED.averageTotal); // 144.0925 is not rounded to 144.09
  });

  it('savings = average total - optimal total, in dollars and percent of the average (unrounded)', () => {
    expect(roundTo(summary.savings, 2)).toBe(GOLDEN_EXPECTED.savings);
    expect(roundTo(summary.savingsPct, 2)).toBe(GOLDEN_EXPECTED.savingsPct);
    expect(summary.savings).toBeCloseTo((refAverageTotal - refOptimal) / 100, 12);
    expect(summary.savingsPct).toBeCloseTo(((refAverageTotal - refOptimal) / refAverageTotal) * 100, 10);
  });

  it('cheapest store is the store of the expected chain', () => {
    expect(summary.cheapestStoreId).toBe(goldenStoreId(GOLDEN_EXPECTED.cheapestChainId));
    const cheapestIndex = refStoreTotals.indexOf(refCheapest);
    expect(summary.cheapestStoreId).toBe(goldenStoreId(GOLDEN_CHAINS[cheapestIndex].id));
  });
});

describe('compareBasket: golden basket, rows (Average / High / Low / Economia / %)', () => {
  it.each(productCases)('%s', (_, index) => {
    const row = result.rows[index];
    const expected = GOLDEN_EXPECTED.rows[index];
    const ref = refRows[index];

    expect(row.key).toBe(goldenLineKey(GOLDEN_PRODUCTS[index].sku));
    // exact cents
    expect(row.high).toBe(expected.high);
    expect(row.low).toBe(expected.low);
    // unrounded, shown with 2 decimals in the sheet
    expect(roundTo(row.average ?? NaN, 2)).toBe(expected.average);
    expect(roundTo(row.savings, 2)).toBe(expected.savings);
    expect(roundTo(row.savingsPct, 2)).toBe(expected.savingsPct);
    expect(row.average).toBeCloseTo(ref.average / 100, 12);
    expect(row.savings).toBeCloseTo(ref.savings / 100, 12);
    expect(row.savingsPct).toBeCloseTo(ref.savingsPct, 10);
  });

  it.each(productCases)('%s: unit prices, line totals and the stores at the low price', (_, index) => {
    const row = result.rows[index];
    const prices = GOLDEN_PRODUCTS[index].prices;
    GOLDEN_CHAINS.forEach((chain, chainIndex) => {
      expect(row.unitPrices[goldenStoreId(chain.id)]).toBe(prices[chainIndex]);
      expect(row.lineTotals[goldenStoreId(chain.id)]).toBe(prices[chainIndex]); // quantity 1
    });
    const lowest = Math.min(...prices);
    expect(row.lowStoreIds).toEqual(GOLDEN_CHAINS.filter((_, i) => prices[i] === lowest).map((chain) => goldenStoreId(chain.id)));
  });
});

describe('compareBasket: golden prices with quantities 1, 2 and 3', () => {
  // Same matrix, but quantity = 1, 2, 3, 1, 2, 3, ... Ten of these line totals drift in binary
  // floats (14.03 x 3 = 42.089999999999996), so exact-cent line totals and totals are a real check.
  const quantities = GOLDEN_LINES.map((_, index) => (index % 3) + 1);
  const lines = GOLDEN_LINES.map((line, index) => ({ ...line, quantity: quantities[index] }));
  const scaled = compareBasket(lines, GOLDEN_STORES, GOLDEN_PRICES);
  const lineCents = priceCents.map((row, index) => row.map((value) => value * quantities[index])); // exact integers

  it('line totals are unit price x quantity, in exact cents', () => {
    scaled.rows.forEach((row, index) => {
      GOLDEN_CHAINS.forEach((chain, chainIndex) => {
        expect(row.lineTotals[goldenStoreId(chain.id)]).toBe(lineCents[index][chainIndex] / 100);
        expect(row.unitPrices[goldenStoreId(chain.id)]).toBe(GOLDEN_PRODUCTS[index].prices[chainIndex]);
      });
    });
  });

  it('row high, low, average and savings come from the line totals', () => {
    scaled.rows.forEach((row, index) => {
      const totals = lineCents[index];
      const average = mean(totals);
      expect(row.quantity).toBe(quantities[index]);
      expect(row.high).toBe(Math.max(...totals) / 100);
      expect(row.low).toBe(Math.min(...totals) / 100);
      expect(row.average).toBeCloseTo(average / 100, 12);
      expect(row.savings).toBeCloseTo((average - Math.min(...totals)) / 100, 12);
    });
  });

  it('store totals, optimal and high totals are exact cents', () => {
    GOLDEN_CHAINS.forEach((chain, chainIndex) => {
      const expected = sum(lineCents.map((row) => row[chainIndex])) / 100;
      expect(scaled.storeTotals[chainIndex]).toMatchObject({ storeId: goldenStoreId(chain.id), total: expected });
    });
    expect(scaled.summary.optimalTotal).toBe(sum(lineCents.map((row) => Math.min(...row))) / 100);
    expect(scaled.summary.highTotal).toBe(sum(lineCents.map((row) => Math.max(...row))) / 100);
  });
});

// ---------- Edge cases (scenarios in tests/fixtures/comparisonScenarios.ts) ----------

function run(scenario: Scenario): ComparisonResult {
  return compareBasket(scenario.lines, scenario.stores, scenario.prices);
}

function totalOf(result: ComparisonResult, storeId: string) {
  const total = result.storeTotals.find((entry) => entry.storeId === storeId);
  if (!total) throw new Error(`no store total for ${storeId}`);
  return total;
}

function rowOf(result: ComparisonResult, key: string) {
  const row = result.rows.find((entry) => entry.key === key);
  if (!row) throw new Error(`no row ${key}`);
  return row;
}

/** No NaN or Infinity anywhere in the result. */
function expectAllFinite(result: ComparisonResult): void {
  const numbers: number[] = [];
  JSON.stringify(result, (_, value) => {
    if (typeof value === 'number') numbers.push(value);
    return value;
  });
  // JSON turns NaN and Infinity into null, so look at the raw values too.
  for (const total of result.storeTotals) numbers.push(...Object.values(total).filter((value): value is number => typeof value === 'number'));
  numbers.push(...Object.values(result.summary).filter((value): value is number => typeof value === 'number'));
  for (const row of result.rows) numbers.push(row.savings, row.savingsPct);
  expect(numbers.every(Number.isFinite)).toBe(true);
}

describe('compareBasket: a store that does not sell one item', () => {
  const result = run(SCENARIOS.storeMissingItem); // C has no eggs

  it("totals only what the store sells and lists the missing line", () => {
    expect(totalOf(result, 'c')).toMatchObject({ total: 3.5, complete: false, missingKeys: ['eggs'] }); // 2.00 + 1.50
    expect(totalOf(result, 'a')).toMatchObject({ total: 9, complete: true, missingKeys: [] });
    expect(totalOf(result, 'b')).toMatchObject({ total: 9.2, complete: true, missingKeys: [] });
  });

  it('averages the complete stores only', () => {
    expect(result.summary.averageTotal).toBeCloseTo(9.1, 12); // (9.00 + 9.20) / 2, not (9.00 + 9.20 + 3.50) / 3
  });

  it('picks the cheapest complete store, not the cheaper incomplete one', () => {
    expect(result.summary.cheapestStoreId).toBe('a');
  });

  it('does not compare the incomplete store with the cheapest store (decision D-14)', () => {
    // Its 3.50 - 9.00 = -5.50 would read as "cheaper than the cheapest" only because it lacks eggs.
    expect(totalOf(result, 'c')).toMatchObject({ vsCheapestStore: 0, vsCheapestStorePct: 0 });
  });

  it('still compares the complete stores with the cheapest one', () => {
    expect(totalOf(result, 'b').vsCheapestStore).toBe(0.2); // 9.20 - 9.00
    expect(totalOf(result, 'b').vsCheapestStorePct).toBeCloseTo((0.2 / 9) * 100, 10);
    expect(totalOf(result, 'a')).toMatchObject({ vsCheapestStore: 0, vsCheapestStorePct: 0 });
  });

  it('takes row figures over the stores that sell the item', () => {
    const eggs = rowOf(result, 'eggs');
    expect(eggs.lineTotals).toEqual({ a: 4, b: 4.5, c: null });
    expect(eggs.unitPrices).toEqual({ a: 4, b: 4.5, c: null });
    expect(eggs).toMatchObject({ high: 4.5, low: 4, lowStoreIds: ['a'] });
    expect(eggs.average).toBeCloseTo(4.25, 12);
    expect(eggs.savings).toBeCloseTo(0.25, 12);
  });

  it('builds the optimal and high totals from every row', () => {
    expect(result.summary.optimalTotal).toBe(7.5); // 2.00 (C) + 4.00 (A) + 1.50 (C)
    expect(result.summary.highTotal).toBe(9.7); // 3.00 + 4.50 + 2.20
    expect(totalOf(result, 'c').vsOptimal).toBe(-4); // 3.50 - 7.50
    expect(result.summary.savings).toBeCloseTo(1.6, 12); // 9.10 - 7.50
    expect(result.summary.unpricedKeys).toEqual([]);
  });
});

describe('compareBasket: an item with no product', () => {
  const result = run(SCENARIOS.unmatchedItem);

  it('still gives the item a row, with nulls everywhere', () => {
    for (const key of ['mystery', 'discontinued']) {
      expect(rowOf(result, key)).toMatchObject({
        unitPrices: { a: null, b: null },
        lineTotals: { a: null, b: null },
        average: null,
        high: null,
        low: null,
        lowStoreIds: [],
        savings: 0,
        savingsPct: 0,
      });
    }
    expect(result.rows.map((row) => row.key)).toEqual(['milk', 'mystery', 'discontinued', 'milk-2']);
  });

  it('lists it as unpriced, in line order (no product, or a product nobody sells)', () => {
    expect(result.summary.unpricedKeys).toEqual(['mystery', 'discontinued']);
  });

  it('does not make any store incomplete or change the totals', () => {
    expect(totalOf(result, 'a')).toMatchObject({ total: 6, complete: true, missingKeys: [] }); // 2 x 3.00
    expect(totalOf(result, 'b')).toMatchObject({ total: 5, complete: true, missingKeys: [] });
    expect(result.summary).toMatchObject({ optimalTotal: 5, highTotal: 6, cheapestStoreId: 'b' });
  });
});

describe('compareBasket: quantities', () => {
  const result = run(SCENARIOS.quantities);

  it('multiplies by 3 without float drift', () => {
    expect(4.35 * 3).not.toBe(13.05); // the drift being avoided: 13.049999999999999
    expect(rowOf(result, 'milk').lineTotals).toEqual({ a: 13.05, b: 11.97 });
    expect(rowOf(result, 'milk')).toMatchObject({ quantity: 3, high: 13.05, low: 11.97 });
    expect(rowOf(result, 'milk').unitPrices).toEqual({ a: 4.35, b: 3.99 }); // unit prices stay per unit
  });

  it('rounds fractional line totals once, half away from zero', () => {
    expect(rowOf(result, 'rice').lineTotals).toEqual({ a: 2.99, b: 3.15 }); // 1.99 x 1.5 = 2.985
    expect(rowOf(result, 'cheese').lineTotals).toEqual({ a: 1.07, b: 1 }); // 3.20 x 0.333 = 1.0656; 3.00 x 0.333 = 0.999
  });

  it('totals the rounded line totals', () => {
    expect(totalOf(result, 'a').total).toBe(17.11); // 13.05 + 2.99 + 1.07
    expect(totalOf(result, 'b').total).toBe(16.12); // 11.97 + 3.15 + 1.00
    expect(result.summary.optimalTotal).toBe(15.96); // 11.97 + 2.99 + 1.00
    expect(result.summary.highTotal).toBe(17.27); // 13.05 + 3.15 + 1.07
    expect(result.summary.cheapestStoreId).toBe('b');
    expect(totalOf(result, 'a').vsCheapestStore).toBe(0.99); // 17.11 - 16.12
  });

  it('computes row averages over line totals, not unit prices', () => {
    expect(rowOf(result, 'milk').average).toBeCloseTo(12.51, 12); // (13.05 + 11.97) / 2
    expect(rowOf(result, 'milk').savings).toBeCloseTo(0.54, 12); // 12.51 - 11.97
  });
});

describe('compareBasket: no stores', () => {
  const result = run(SCENARIOS.noStores);

  it('returns empty columns, rows with nulls and zero totals without throwing', () => {
    expect(result.storeIds).toEqual([]);
    expect(result.storeTotals).toEqual([]);
    expect(result.rows.map((row) => [row.key, row.unitPrices, row.lineTotals, row.average, row.low])).toEqual([
      ['milk', {}, {}, null, null],
      ['mystery', {}, {}, null, null],
    ]);
    expect(result.summary).toEqual({
      averageTotal: 0,
      highTotal: 0,
      optimalTotal: 0,
      savings: 0,
      savingsPct: 0,
      cheapestStoreId: null,
      unpricedKeys: ['milk', 'mystery'], // nobody in the (empty) list sells milk
    });
    expectAllFinite(result);
  });

  it('also works with no stores and no lines', () => {
    const empty = compareBasket([], [], {});
    expect(empty).toEqual({
      storeIds: [],
      rows: [],
      storeTotals: [],
      summary: { averageTotal: 0, highTotal: 0, optimalTotal: 0, savings: 0, savingsPct: 0, cheapestStoreId: null, unpricedKeys: [] },
    });
  });
});

describe('compareBasket: no lines', () => {
  const result = run(SCENARIOS.noLines);

  it('gives every store a zero total, complete, with zero differences (no NaN)', () => {
    expect(result.rows).toEqual([]);
    for (const storeId of ['a', 'b']) {
      expect(totalOf(result, storeId)).toEqual({
        storeId,
        total: 0,
        missingKeys: [],
        complete: true,
        vsOptimal: 0,
        vsOptimalPct: 0,
        vsCheapestStore: 0,
        vsCheapestStorePct: 0,
      });
    }
    expect(result.summary).toMatchObject({ averageTotal: 0, highTotal: 0, optimalTotal: 0, savings: 0, savingsPct: 0, unpricedKeys: [] });
    expectAllFinite(result);
  });

  it('counts every store as complete, so the first store is the cheapest (tie at 0)', () => {
    expect(result.summary.cheapestStoreId).toBe('a');
  });
});

describe('compareBasket: two stores tied on price', () => {
  const scenario = SCENARIOS.tiedStores;
  const result = run(scenario);

  it('lists every store at the row low, in store order', () => {
    expect(rowOf(result, 'milk').lowStoreIds).toEqual(['a', 'b']);
    expect(rowOf(result, 'eggs').lowStoreIds).toEqual(['c']);
  });

  it('gives the cheapest store to the earlier of the tied stores', () => {
    expect(totalOf(result, 'a').total).toBe(7);
    expect(totalOf(result, 'b').total).toBe(7);
    expect(totalOf(result, 'c').total).toBe(7.25);
    expect(result.summary.cheapestStoreId).toBe('a');
    expect(totalOf(result, 'b')).toMatchObject({ vsCheapestStore: 0, vsCheapestStorePct: 0 });
  });

  it('follows the order of the stores argument, not the ids', () => {
    const [a, b, c] = scenario.stores;
    const reordered = compareBasket(scenario.lines, [c, b, a], scenario.prices);
    expect(reordered.summary.cheapestStoreId).toBe('b');
    expect(rowOf(reordered, 'milk').lowStoreIds).toEqual(['b', 'a']);
    expect(reordered.storeIds).toEqual(['c', 'b', 'a']);
  });
});

describe('compareBasket: prices for a store that is not in the list', () => {
  const result = run(SCENARIOS.unlistedStorePrices);

  it('ignores them: no column, no effect on the row figures', () => {
    const milk = rowOf(result, 'milk');
    expect(Object.keys(milk.unitPrices)).toEqual(['a', 'b']);
    expect(Object.keys(milk.lineTotals)).toEqual(['a', 'b']);
    expect(milk).toMatchObject({ low: 2.5, high: 3, lowStoreIds: ['b'] }); // not Z's 0.01
    expect(milk.average).toBeCloseTo(2.75, 12);
  });

  it('does not make a line priceable when only that store sells it', () => {
    expect(result.summary.unpricedKeys).toEqual(['caviar']);
    expect(rowOf(result, 'caviar')).toMatchObject({ unitPrices: { a: null, b: null }, average: null });
    expect(totalOf(result, 'a').complete).toBe(true);
  });

  it('leaves the totals and the summary as if the store did not exist', () => {
    expect(result.summary).toMatchObject({ optimalTotal: 2.5, highTotal: 3, cheapestStoreId: 'b' });
    expect(result.storeIds).toEqual(['a', 'b']);
  });
});

describe('compareBasket: no store sells everything', () => {
  const result = run(SCENARIOS.noCompleteStore);

  it('has no cheapest store and zero vs-cheapest fields', () => {
    expect(result.summary.cheapestStoreId).toBeNull();
    for (const storeId of ['a', 'b']) {
      expect(totalOf(result, storeId)).toMatchObject({ complete: false, vsCheapestStore: 0, vsCheapestStorePct: 0 });
    }
  });

  it('averages all stores', () => {
    expect(result.summary.averageTotal).toBeCloseTo(3.5, 12); // (3.00 + 4.00) / 2
  });

  it('still compares with the optimal split', () => {
    expect(result.summary.optimalTotal).toBe(7); // 3.00 (A) + 4.00 (B)
    expect(totalOf(result, 'a')).toMatchObject({ total: 3, missingKeys: ['eggs'], vsOptimal: -4 });
    expect(result.summary.savings).toBeCloseTo(-3.5, 12); // 3.50 - 7.00: an average of partial totals
    expect(result.summary.savingsPct).toBeCloseTo(-100, 10);
  });
});

describe('compareBasket: invalid prices and zero bases', () => {
  it('treats a price that is not a finite number as not sold', () => {
    const result = run(SCENARIOS.invalidPrice);
    expect(rowOf(result, 'milk')).toMatchObject({ unitPrices: { a: null, b: 2.5 }, lineTotals: { a: null, b: 2.5 }, low: 2.5 });
    expect(totalOf(result, 'a')).toMatchObject({ total: 0, complete: false, missingKeys: ['milk'], vsCheapestStore: 0, vsCheapestStorePct: 0 });
    expect(result.summary.cheapestStoreId).toBe('b');
    expectAllFinite(result);
  });

  it('gives 0 percentages when every price is 0', () => {
    const result = compareBasket([line('bag', 'p-bag')], [store('a'), store('b')], { 'p-bag': { a: 0, b: 0 } });
    expect(rowOf(result, 'bag')).toMatchObject({ average: 0, low: 0, savings: 0, savingsPct: 0, lowStoreIds: ['a', 'b'] });
    expect(totalOf(result, 'b')).toMatchObject({ total: 0, vsOptimalPct: 0, vsCheapestStorePct: 0 });
    expect(result.summary).toMatchObject({ averageTotal: 0, savingsPct: 0, cheapestStoreId: 'a' });
    expectAllFinite(result);
  });

  it('gives 0 vs-optimal percentages when the optimal total is 0 but a store charges', () => {
    const result = compareBasket([line('bag', 'p-bag')], [store('a'), store('b')], { 'p-bag': { a: 0, b: 0.1 } });
    expect(totalOf(result, 'b')).toMatchObject({ vsOptimal: 0.1, vsOptimalPct: 0 });
  });

  it('does not read inherited properties as prices', () => {
    const result = compareBasket([line('milk', 'p-milk')], [store('constructor'), store('toString')], { 'p-milk': {} });
    expect(result.summary.unpricedKeys).toEqual(['milk']);
    expect(rowOf(result, 'milk').unitPrices).toEqual({ constructor: null, toString: null });
  });

  it('does not read an inherited product entry (prices.constructor is Object, whose length is 1)', () => {
    const result = compareBasket([line('x', 'constructor')], [store('length'), store('name')], {});
    expect(rowOf(result, 'x').unitPrices).toEqual({ length: null, name: null });
    expect(result.summary.unpricedKeys).toEqual(['x']);
  });

  it('does not read a numeric price inherited through the prototype', () => {
    const inherited = Object.create({ a: 1.5 }) as Record<string, number>;
    inherited.b = 2;
    const result = compareBasket([line('milk', 'p-milk')], [store('a'), store('b')], { 'p-milk': inherited });
    expect(rowOf(result, 'milk').unitPrices).toEqual({ a: null, b: 2 });
  });

  it('does not modify its inputs', () => {
    const scenario = SCENARIOS.storeMissingItem;
    const before = JSON.stringify(scenario);
    run(scenario);
    expect(JSON.stringify(scenario)).toBe(before);
  });
});

describe('filterStores', () => {
  const stores = [store('s1', 'freshmart'), store('s2', 'sunrise'), store('s3', 'harvest'), store('s4', 'sunrise')];
  const ids = (result: ReturnType<typeof filterStores>) => result.map((entry) => entry.id);

  it('keeps every store when nothing is included or excluded', () => {
    expect(ids(filterStores(stores, { includedChains: [], excludedChains: [] }))).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('keeps only the included chains', () => {
    expect(ids(filterStores(stores, { includedChains: ['sunrise'], excludedChains: [] }))).toEqual(['s2', 's4']);
    expect(ids(filterStores(stores, { includedChains: ['harvest', 'freshmart'], excludedChains: [] }))).toEqual(['s1', 's3']);
  });

  it('drops the excluded chains', () => {
    expect(ids(filterStores(stores, { includedChains: [], excludedChains: ['sunrise'] }))).toEqual(['s1', 's3']);
  });

  it('lets an exclusion win over an inclusion of the same chain', () => {
    expect(ids(filterStores(stores, { includedChains: ['sunrise', 'harvest'], excludedChains: ['sunrise'] }))).toEqual(['s3']);
    expect(ids(filterStores(stores, { includedChains: ['sunrise'], excludedChains: ['sunrise'] }))).toEqual([]);
  });

  it('keeps nothing when the included chains match no store', () => {
    expect(filterStores(stores, { includedChains: ['unknown'], excludedChains: [] })).toEqual([]);
  });

  it('ignores unknown excluded chains', () => {
    expect(ids(filterStores(stores, { includedChains: [], excludedChains: ['unknown'] }))).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('compares chain ids exactly (case-sensitive)', () => {
    expect(filterStores(stores, { includedChains: ['Sunrise'], excludedChains: [] })).toEqual([]);
  });

  it('keeps the input order and the store objects, and returns a new array', () => {
    const input = [...stores];
    const result = filterStores(input, { includedChains: [], excludedChains: [] });
    expect(result).not.toBe(input);
    expect(result[1]).toBe(stores[1]);
    expect(input).toEqual(stores);
  });

  it('handles no stores', () => {
    expect(filterStores([], { includedChains: ['sunrise'], excludedChains: ['harvest'] })).toEqual([]);
  });
});
