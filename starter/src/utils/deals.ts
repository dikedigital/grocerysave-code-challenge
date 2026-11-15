import type { Deal, PricePoint } from '../models';
import { fromCents, roundTo, toCents } from './money';

/** Feed dates are calendar dates written 'YYYY-MM-DD', so plain string order is date order. */
const FEED_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Plain code-unit order (not locale order), so ids sort the same everywhere (decision D-44). */
const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * A point that can be a snapshot: a finite, non-negative price and a 'YYYY-MM-DD' date. Anything
 * else is ignored, as if the feed had not listed the product that week (decision D-42).
 */
function isUsable(point: PricePoint): boolean {
  return (
    typeof point.price === 'number' &&
    Number.isFinite(point.price) &&
    point.price >= 0 &&
    typeof point.date === 'string' &&
    FEED_DATE.test(point.date)
  );
}

/**
 * Finds price drops. For each (store, product) the two most recent snapshots are compared;
 * a deal is reported when the latest price is lower than the previous one by at least
 * `thresholdPct` percent. Pairs with a single snapshot never produce a deal.
 * Results are sorted by dropPct descending, then productId, then storeId.
 *
 * Several points for the same pair on the same date count as one snapshot (the last one given wins).
 *
 * Decisions (docs/DECISIONS.md D-39 to D-45): `price` (what the shopper pays) is compared, in whole
 * cents; the latest price must be strictly lower, and a drop exactly at the threshold counts
 * (decided exactly, without float noise); `date` and `onSale` come from the latest snapshot; points
 * with an unusable price or date are ignored; a negative or non-finite threshold throws RangeError.
 */
export function detectDeals(points: PricePoint[], thresholdPct: number): Deal[] {
  if (typeof thresholdPct !== 'number' || !Number.isFinite(thresholdPct) || thresholdPct < 0) {
    throw new RangeError(`detectDeals: thresholdPct must be a finite number >= 0 (got ${String(thresholdPct)})`);
  }

  // storeId -> productId -> date -> the last point given for that date. Maps, not objects, so ids
  // such as "constructor" or "__proto__" are ordinary keys.
  const snapshots = new Map<string, Map<string, Map<string, PricePoint>>>();
  for (const point of points) {
    if (!isUsable(point)) continue;
    let byProduct = snapshots.get(point.storeId);
    if (!byProduct) snapshots.set(point.storeId, (byProduct = new Map()));
    let byDate = byProduct.get(point.productId);
    if (!byDate) byProduct.set(point.productId, (byDate = new Map()));
    byDate.set(point.date, point); // same date again: the later point replaces the earlier one
  }

  const deals: Deal[] = [];
  for (const byProduct of snapshots.values()) {
    for (const byDate of byProduct.values()) {
      if (byDate.size < 2) continue; // a single snapshot never yields a deal
      const [latestDate, previousDate] = [...byDate.keys()].sort().reverse();
      const latest = byDate.get(latestDate)!;
      const previous = byDate.get(previousDate)!;

      const oldCents = toCents(previous.price);
      const newCents = toCents(latest.price);
      const dropCents = oldCents - newCents;
      if (dropCents <= 0) continue; // not lower (this also covers an old price of 0)
      // drop / old >= threshold / 100, compared in integers: drop x 100 >= threshold x old. The
      // right side is snapped to 6 decimals so that float noise in the product (0.07 x 10000 is
      // 700.0000000000001) cannot flip a drop that is exactly at the threshold (decision D-40).
      if (dropCents * 100 < roundTo(thresholdPct * oldCents, 6)) continue;

      deals.push({
        storeId: latest.storeId,
        productId: latest.productId,
        date: latestDate,
        oldPrice: fromCents(oldCents),
        newPrice: fromCents(newCents),
        // One division of exact integers: equal ratios give identical numbers (5.00 -> 4.50 and
        // 10.00 -> 9.00 are both exactly 10), so ties in the sort are real ties.
        dropPct: (dropCents * 100) / oldCents,
        onSale: latest.onSale,
      });
    }
  }

  return deals.sort(
    (a, b) => b.dropPct - a.dropPct || compareIds(a.productId, b.productId) || compareIds(a.storeId, b.storeId)
  );
}
