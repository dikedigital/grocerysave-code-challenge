import type {
  BasketLine,
  ComparisonResult,
  ComparisonRow,
  PriceTable,
  Store,
  StoreTotal,
  UserPreferences,
} from '../models';
import { fromCents, toCents } from './money';

/**
 * Applies the user's chain preferences. A store is kept when its chain is not excluded and
 * either includedChains is empty or contains the chain.
 */
export function filterStores(
  stores: Store[],
  preferences: Pick<UserPreferences, 'includedChains' | 'excludedChains'>
): Store[] {
  const excluded = new Set(preferences.excludedChains);
  const included = new Set(preferences.includedChains);
  // A new array in the input order; the store objects themselves are kept (not copied).
  return stores.filter((store) => !excluded.has(store.chainId) && (included.size === 0 || included.has(store.chainId)));
}

/**
 * The unit price of a product at a store, or undefined when the store does not sell it: no entry,
 * or an entry that is not a finite number (a NaN price would otherwise count as free).
 */
function unitPriceAt(prices: PriceTable, productId: string | null, storeId: string): number | undefined {
  // Own keys only, at both levels: ids such as "constructor" or "length" must not pick up inherited
  // members (prices["constructor"] is Object, whose own "length" is the number 1).
  if (productId === null || !hasOwn(prices, productId)) return undefined;
  const byStore = prices[productId];
  if (!byStore || !hasOwn(byStore, storeId)) return undefined;
  const price = byStore[storeId];
  return Number.isFinite(price) ? price : undefined;
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** part / whole x 100, or 0 when the whole is 0 (no basket, or everything free). */
function percentOf(part: number, whole: number): number {
  return whole === 0 ? 0 : (part / whole) * 100;
}

/** One row of the matrix plus its line totals in cents, column by column (null: not sold). */
interface PricedRow {
  row: ComparisonRow;
  cents: (number | null)[];
  lowCents: number | null;
  highCents: number | null;
}

function priceRow(line: BasketLine, storeIds: string[], prices: PriceTable): PricedRow {
  const unitPrices: Record<string, number | null> = {};
  const lineTotals: Record<string, number | null> = {};
  const cents = storeIds.map((storeId) => {
    const unitPrice = unitPriceAt(prices, line.productId, storeId);
    if (unitPrice === undefined) {
      unitPrices[storeId] = null;
      lineTotals[storeId] = null;
      return null;
    }
    // Rounded once, on the line total (3.2 x 0.333 = 1.0656 -> 107 cents), without float drift.
    const total = toCents(unitPrice * line.quantity);
    unitPrices[storeId] = unitPrice;
    lineTotals[storeId] = fromCents(total);
    return total;
  });

  const sold = cents.filter((value): value is number => value !== null);
  const base = { key: line.key, label: line.label, quantity: line.quantity, productId: line.productId, unitPrices, lineTotals };
  if (sold.length === 0) {
    const row: ComparisonRow = { ...base, average: null, high: null, low: null, lowStoreIds: [], savings: 0, savingsPct: 0 };
    return { row, cents, lowCents: null, highCents: null };
  }

  const lowCents = Math.min(...sold);
  const highCents = Math.max(...sold);
  // The mean in cents is unrounded (2678 / 8 = 334.75); the fields below are exact ratios of it.
  const averageCents = sold.reduce((sum, value) => sum + value, 0) / sold.length;
  const row: ComparisonRow = {
    ...base,
    average: averageCents / 100,
    high: fromCents(highCents),
    low: fromCents(lowCents),
    lowStoreIds: storeIds.filter((_, index) => cents[index] === lowCents),
    savings: (averageCents - lowCents) / 100,
    savingsPct: percentOf(averageCents - lowCents, averageCents),
  };
  return { row, cents, lowCents, highCents };
}

/**
 * Builds the comparison matrix for a basket across stores (see the field docs in src/models).
 *
 * - A line is "priceable" when it has a productId and at least one store sells it.
 *   Unpriceable lines still get a row (all nulls) and are listed in summary.unpricedKeys.
 * - Row average/high/low are computed over line totals (unit price x quantity).
 * - A store is "complete" when it sells every priceable line. averageTotal and cheapestStoreId
 *   consider complete stores only; if no store is complete, cheapestStoreId is null,
 *   averageTotal is the mean over all stores, and vsCheapestStore/vsCheapestStorePct are 0.
 * - Ties for cheapest store go to the earlier store in `stores`.
 * - With no stores or no lines every total is 0 and nothing throws.
 *
 * Every sum is taken in integer cents. Exact-cent fields are converted back with fromCents;
 * unrounded fields (averages, savings, percentages) are single divisions of those integers.
 *
 * Also (TECH_SPEC 5.3): a percentage whose base is 0 is 0; prices for stores that are not in
 * `stores` are ignored (they neither appear nor make a line priceable); a price that is not a finite
 * number counts as "not sold"; an incomplete store is not compared with the cheapest store (its
 * vsCheapestStore and vsCheapestStorePct are 0), see docs/DECISIONS.md.
 */
export function compareBasket(
  lines: BasketLine[],
  stores: Store[],
  prices: PriceTable
): ComparisonResult {
  const storeIds = stores.map((store) => store.id);
  const priced = lines.map((line) => priceRow(line, storeIds, prices));
  const priceable = priced.filter((entry) => entry.lowCents !== null);

  const optimalCents = priceable.reduce((sum, entry) => sum + (entry.lowCents ?? 0), 0);
  const highCents = priceable.reduce((sum, entry) => sum + (entry.highCents ?? 0), 0);

  const columns = storeIds.map((storeId, index) => {
    let totalCents = 0;
    const missingKeys: string[] = [];
    for (const entry of priceable) {
      const cents = entry.cents[index];
      if (cents === null) missingKeys.push(entry.row.key);
      else totalCents += cents;
    }
    return { storeId, totalCents, missingKeys, complete: missingKeys.length === 0 };
  });

  // Cheapest complete store; strict "<" keeps the earlier store on a tie. With no lines every store
  // is complete (it sells every priceable line, of which there are none), so the first one wins.
  const complete = columns.filter((column) => column.complete);
  let cheapest: (typeof columns)[number] | null = null;
  for (const column of complete) if (cheapest === null || column.totalCents < cheapest.totalCents) cheapest = column;

  // Mean of the complete stores' totals; of all stores when none is complete; 0 without stores.
  const averaged = complete.length > 0 ? complete : columns;
  const averageCents =
    averaged.length === 0 ? 0 : averaged.reduce((sum, column) => sum + column.totalCents, 0) / averaged.length;

  const cheapestCents = cheapest === null ? null : cheapest.totalCents;
  const storeTotals: StoreTotal[] = columns.map((column) => {
    // "vs cheapest store" compares complete stores only (decision D-14). Without a complete store
    // there is nothing to compare with (TECH_SPEC 5.3), and an incomplete store is not compared:
    // its partial total would look cheaper only because it lacks items. Both cases give 0.
    const compared = cheapestCents !== null && column.complete;
    const vsCheapestCents = compared ? column.totalCents - cheapestCents : 0;
    return {
      storeId: column.storeId,
      total: fromCents(column.totalCents),
      missingKeys: column.missingKeys,
      complete: column.complete,
      vsOptimal: fromCents(column.totalCents - optimalCents),
      vsOptimalPct: percentOf(column.totalCents - optimalCents, optimalCents),
      vsCheapestStore: fromCents(vsCheapestCents),
      vsCheapestStorePct: compared ? percentOf(vsCheapestCents, cheapestCents) : 0,
    };
  });

  return {
    storeIds,
    rows: priced.map((entry) => entry.row),
    storeTotals,
    summary: {
      averageTotal: averageCents / 100,
      highTotal: fromCents(highCents),
      optimalTotal: fromCents(optimalCents),
      savings: (averageCents - optimalCents) / 100,
      savingsPct: percentOf(averageCents - optimalCents, averageCents),
      cheapestStoreId: cheapest?.storeId ?? null,
      unpricedKeys: priced.filter((entry) => entry.lowCents === null).map((entry) => entry.row.key),
    },
  };
}
