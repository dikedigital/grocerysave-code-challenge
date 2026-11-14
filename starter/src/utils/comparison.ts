import type { BasketLine, ComparisonResult, PriceTable, Store, UserPreferences } from '../models';
import { notImplemented } from './notImplemented';

/**
 * Applies the user's chain preferences. A store is kept when its chain is not excluded and
 * either includedChains is empty or contains the chain.
 */
export function filterStores(
  stores: Store[],
  preferences: Pick<UserPreferences, 'includedChains' | 'excludedChains'>
): Store[] {
  return notImplemented(stores, preferences);
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
 */
export function compareBasket(
  lines: BasketLine[],
  stores: Store[],
  prices: PriceTable
): ComparisonResult {
  return notImplemented(lines, stores, prices);
}
