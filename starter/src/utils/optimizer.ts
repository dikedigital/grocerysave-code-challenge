import type { BasketLine, OptimizationResult, OptimizeOptions, PriceTable, Store } from '../models';
import { notImplemented } from './notImplemented';

/**
 * Finds the cheapest way to buy a basket, visiting at most options.maxStores stores.
 *
 * For every subset of stores up to maxStores: each priceable line is bought at the cheapest store
 * of the subset that sells it (ties go to the earlier store in `stores`); stores that end up with
 * no lines are dropped from the plan. When options.home is set, the stores are ordered with
 * planRoute() (round trip from home) and travelCost = distance x travelCostPerKm.
 *
 * Plans are ranked by: fewest unavailable lines, then lowest grandTotal, then fewest stores,
 * then earliest stores in input order.
 *
 * - cheapestSingleStore: best plan restricted to one store.
 * - bestPlan: best plan overall.
 * - byStoreCount: the best plan that visits exactly k stores, for each k that has one, ascending.
 * - unpricedKeys: lines with no productId or sold nowhere (they appear in no plan).
 *
 * The search is exhaustive (it is exact); it must handle 8 stores and maxStores up to 8.
 *
 * Notes: the number of subsets grows as 2^stores, so callers should keep the store list short
 * (the product allows at most 8 chains). maxStores is clamped to 1..stores.length. A plan that
 * ends up with no lines (an empty basket, or a single store that sells nothing wanted) has no
 * stores and is never listed in byStoreCount.
 */
export function optimizePurchase(
  lines: BasketLine[],
  stores: Store[],
  prices: PriceTable,
  options: OptimizeOptions
): OptimizationResult {
  return notImplemented(lines, stores, prices, options);
}
