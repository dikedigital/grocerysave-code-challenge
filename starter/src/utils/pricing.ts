/**
 * How one basket line is priced at one store. Shared by compareBasket and optimizePurchase so the
 * comparison matrix and the plans can never disagree by a cent. Internal: not re-exported from
 * src/utils/index.ts.
 */
import type { PriceTable } from '../models';
import { toCents } from './money';

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * The unit price of a product at a store, or undefined when the store does not sell it: no entry,
 * or an entry that is not a finite number (a NaN price would otherwise count as free). Decision D-25.
 */
export function unitPriceAt(prices: PriceTable, productId: string | null, storeId: string): number | undefined {
  // Own keys only, at both levels: ids such as "constructor" or "length" must not pick up inherited
  // members (prices["constructor"] is Object, whose own "length" is the number 1).
  if (productId === null || !hasOwn(prices, productId)) return undefined;
  const byStore = prices[productId];
  if (!byStore || !hasOwn(byStore, storeId)) return undefined;
  const price = byStore[storeId];
  return Number.isFinite(price) ? price : undefined;
}

/** unit price x quantity in whole cents, rounded once on the line total (3.2 x 0.333 = 1.0656 -> 107 cents). */
export function lineTotalCents(unitPrice: number, quantity: number): number {
  return toCents(unitPrice * quantity);
}
