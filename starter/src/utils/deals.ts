import type { Deal, PricePoint } from '../models';
import { notImplemented } from './notImplemented';

/**
 * Finds price drops. For each (store, product) the two most recent snapshots are compared;
 * a deal is reported when the latest price is lower than the previous one by at least
 * `thresholdPct` percent. Pairs with a single snapshot never produce a deal.
 * Results are sorted by dropPct descending, then productId, then storeId.
 *
 * Several points for the same pair on the same date count as one snapshot (the last one given wins).
 */
export function detectDeals(points: PricePoint[], thresholdPct: number): Deal[] {
  return notImplemented(points, thresholdPct);
}
