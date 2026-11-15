/**
 * A small optimizePurchase instance and an independent brute-force optimiser for it. Used by
 * src/utils/__tests__/optimizer.test.ts and tests/manual/optimize-bruteforce.ts.
 *
 * The brute force shares no code with src/utils/optimizer.ts: it tries EVERY assignment of each
 * priceable item to a store that sells it (or to no store), with at most maxStores distinct stores,
 * takes the shortest round trip through the stores used by trying every visiting order, applies the
 * spec's rounding (distance to 2 decimals, travel cost = rounded distance x rate, in cents) and ranks
 * with TECH_SPEC 5.4: fewest unavailable items, lowest grand total, fewest stores, earliest stores.
 */
import type { BasketLine, LatLng, PriceTable, Store } from '../../src/models';
import { roundTo, toCents } from '../../src/utils/money';
import { haversineKm } from '../../src/utils/route';

export const SMALL_HOME: LatLng = { lat: 0, lng: 0 };

const at = (id: string, name: string, lat: number, lng: number): Store => ({ id, chainId: id, chainName: name, name, address: '', city: '', location: { lat, lng } });

/**
 * Five stores around home: North 1.11 km, East 2.22 km, South 1.67 km, Far (north-east) 7.86 km, and
 * West, the mirror image of East: same distance, same prices, listed last. Plans with East and plans
 * with West tie exactly, so the last tie-break (stores listed earliest) decides between them, and in a
 * set holding both, West buys nothing (every tie goes to East) and drops out.
 */
export const SMALL_STORES: Store[] = [
  at('n', 'North', 0.01, 0),
  at('e', 'East', 0, 0.02),
  at('s', 'South', -0.015, 0),
  at('f', 'Far', 0.05, 0.05),
  at('w', 'West', 0, -0.02),
];

/** Eight items: a price tie (milk at North and South), a half-cent line (eggs x 1.5 at 1.99), an item
 * only two stores sell (rice: North, or cheaper at Far), one with no product (mystery) and one sold
 * only by a store not in the list (caviar). Far is cheapest for coffee, rice and cheese but 7.86 km away. */
export const SMALL_LINES: BasketLine[] = [
  { key: 'milk', label: 'Milk', quantity: 2, productId: 'milk' },
  { key: 'bread', label: 'Bread', quantity: 1, productId: 'bread' },
  { key: 'coffee', label: 'Coffee', quantity: 1, productId: 'coffee' },
  { key: 'eggs', label: 'Eggs', quantity: 1.5, productId: 'eggs' },
  { key: 'rice', label: 'Rice', quantity: 1, productId: 'rice' },
  { key: 'cheese', label: 'Cheese', quantity: 1, productId: 'cheese' },
  { key: 'mystery', label: 'Mystery', quantity: 1, productId: null },
  { key: 'caviar', label: 'Caviar', quantity: 1, productId: 'caviar' },
];

export const SMALL_PRICES: PriceTable = {
  milk: { n: 1.1, e: 1.3, s: 1.1, f: 1.2, w: 1.3 },
  bread: { n: 2.5, e: 2.2, f: 2.4, w: 2.2 },
  coffee: { n: 8.6, e: 9.0, f: 6.5, w: 9.0 },
  eggs: { s: 1.99, e: 2.2, f: 2.1, w: 2.2 },
  rice: { n: 4.2, f: 3.0 },
  cheese: { n: 5.0, e: 4.2, s: 4.6, f: 4.0, w: 4.2 },
  caviar: { z: 80 },
};

export interface BrutePlan {
  /** Stores used, in input order. */
  storeIds: string[];
  /** Which store buys each bought item. */
  buyers: Record<string, string>;
  itemsCents: number;
  travelKm: number;
  travelCents: number;
  grandCents: number;
  unavailableKeys: string[];
}

export interface BruteResult {
  best: BrutePlan | null;
  single: BrutePlan | null;
  /** Best plan using exactly k stores, for each k that has one. */
  byCount: Map<number, BrutePlan>;
  savingsCents: number;
  unpricedKeys: string[];
}

function shortestRoundTripKm(home: LatLng, points: LatLng[]): number {
  if (points.length === 0) return 0;
  let best = Infinity;
  const go = (from: LatLng, left: LatLng[], sofar: number) => {
    if (left.length === 0) return void (best = Math.min(best, sofar + haversineKm(from, home)));
    left.forEach((p, i) => go(p, [...left.slice(0, i), ...left.slice(i + 1)], sofar + haversineKm(from, p)));
  };
  go(home, points, 0);
  return best;
}

export function bruteForceOptimize(
  lines: BasketLine[],
  stores: Store[],
  prices: PriceTable,
  options: { maxStores: number; travelCostPerKm: number; home: LatLng | null }
): BruteResult {
  const priceOf = (productId: string | null, storeId: string): number | undefined => {
    if (productId === null || !Object.prototype.hasOwnProperty.call(prices, productId)) return undefined;
    const row = prices[productId];
    if (!Object.prototype.hasOwnProperty.call(row, storeId)) return undefined;
    return Number.isFinite(row[storeId]) ? row[storeId] : undefined;
  };
  const sellers = lines.map((l) =>
    stores.map((s, i) => ({ i, price: priceOf(l.productId, s.id) })).filter((x) => x.price !== undefined)
      .map((x) => ({ i: x.i, cents: Math.round(toCents(x.price!) * l.quantity) })) // whole-cent price x quantity, half up
  );
  const unpricedKeys = lines.filter((_, li) => sellers[li].length === 0).map((l) => l.key);
  const priceable = lines.map((l, li) => ({ line: l, sellers: sellers[li] })).filter((x) => x.sellers.length > 0);
  if (stores.length === 0) return { best: null, single: null, byCount: new Map(), savingsCents: 0, unpricedKeys };
  const limit = Math.min(stores.length, Math.max(1, Math.floor(options.maxStores)));

  const tripCache = new Map<string, number>();
  const travelOf = (used: number[]) => {
    if (options.home === null) return { km: 0, cents: 0 };
    const key = used.join(',');
    if (!tripCache.has(key)) tripCache.set(key, shortestRoundTripKm(options.home, used.map((i) => stores[i].location)));
    const km = roundTo(tripCache.get(key)!, 2);
    return { km, cents: toCents(km * options.travelCostPerKm) };
  };
  const rank = (a: BrutePlan & { pos: number[] }, b: BrutePlan & { pos: number[] }) =>
    a.unavailableKeys.length - b.unavailableKeys.length || a.grandCents - b.grandCents || a.pos.length - b.pos.length ||
    (a.pos.find((v, k) => v !== b.pos[k]) ?? 0) - (b.pos.find((v, k) => v !== a.pos[k]) ?? 0);
  /** The spec's plan content for a set of stores: each item at the set's cheapest seller, ties to the earlier. */
  const followsRule = (choice: number[], usedSet: Set<number>) =>
    priceable.every((p, li) => {
      const inSet = p.sellers.filter((x) => usedSet.has(x.i)).sort((x, y) => x.cents - y.cents || x.i - y.i);
      return inSet.length === 0 ? choice[li] === -1 : choice[li] === inSet[0].i;
    });

  let best: (BrutePlan & { pos: number[] }) | null = null;
  let single: (BrutePlan & { pos: number[] }) | null = null;
  const byCount = new Map<number, BrutePlan & { pos: number[] }>();
  const choice: number[] = [];
  const walk = (li: number) => {
    if (new Set(choice.filter((c) => c >= 0)).size > limit) return;
    if (li === priceable.length) {
      const pos = [...new Set(choice.filter((c) => c >= 0))].sort((a, b) => a - b);
      const itemsCents = choice.reduce((sum, c, k) => sum + (c < 0 ? 0 : priceable[k].sellers.find((x) => x.i === c)!.cents), 0);
      const travel = travelOf(pos);
      const plan = {
        pos,
        storeIds: pos.map((i) => stores[i].id),
        buyers: Object.fromEntries(choice.flatMap((c, k) => (c < 0 ? [] : [[priceable[k].line.key, stores[c].id]]))),
        itemsCents,
        travelKm: travel.km,
        travelCents: travel.cents,
        grandCents: itemsCents + travel.cents,
        unavailableKeys: choice.flatMap((c, k) => (c < 0 ? [priceable[k].line.key] : [])),
      };
      const rule = followsRule(choice, new Set(pos));
      // Among equally ranked assignments, keep the one that follows the spec's buying rule.
      const better = (cur: typeof plan | null) => !cur || rank(plan, cur) < 0 || (rank(plan, cur) === 0 && rule);
      if (better(best)) best = plan;
      if (pos.length <= 1 && better(single)) single = plan;
      if (pos.length > 0 && rule && (!byCount.has(pos.length) || rank(plan, byCount.get(pos.length)!) < 0)) byCount.set(pos.length, plan);
      return;
    }
    choice[li] = -1;
    walk(li + 1);
    for (const { i } of priceable[li].sellers) {
      choice[li] = i;
      walk(li + 1);
    }
    choice.length = li;
  };
  walk(0);
  const strip = (p: (BrutePlan & { pos: number[] }) | null): BrutePlan | null => {
    if (!p) return null;
    const { storeIds, buyers, itemsCents, travelKm, travelCents, grandCents, unavailableKeys } = p;
    return { storeIds, buyers, itemsCents, travelKm, travelCents, grandCents, unavailableKeys };
  };
  return {
    best: strip(best),
    single: strip(single),
    byCount: new Map([...byCount].map(([k, p]) => [k, strip(p)!])),
    savingsCents: single!.grandCents - best!.grandCents,
    unpricedKeys,
  };
}
