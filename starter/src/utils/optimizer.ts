import type {
  BasketLine,
  LatLng,
  OptimizationResult,
  OptimizeOptions,
  PlanLine,
  PlanStore,
  PriceTable,
  RoutePlan,
  ShoppingPlan,
  Store,
  TravelMode,
} from '../models';
import { fromCents, toCents } from './money';
import { lineTotalCents, unitPriceAt } from './pricing';
import { planRoute } from './route';

/** A priceable line with its line total at each store, in cents (null: that store does not sell it). */
interface PricedLine {
  line: BasketLine;
  unitPrices: (number | undefined)[];
  cents: (number | null)[];
}

/** One candidate plan, before it is turned into a ShoppingPlan. */
interface Candidate {
  /** For each priceable line, the index of the store that buys it, or -1 when unavailable. */
  buyAt: number[];
  /** Indexes (into `stores`) of the stores that buy at least one line, ascending. */
  used: number[];
  unavailable: number;
  itemsCents: number;
  travel: Travel;
  /** itemsCents + travel.costCents: what plans are ranked by. */
  grandCents: number;
}

/** The trip for one set of stores: null route and zero cost without a home location. */
interface Travel {
  route: RoutePlan | null;
  distanceKm: number;
  costCents: number;
}

const NO_TRAVEL: Travel = { route: null, distanceKm: 0, costCents: 0 };

/**
 * The ranking of TECH_SPEC 5.4, on exact integers (decision D-47): fewest unavailable lines, then
 * lowest grand total, then fewest stores, then earliest stores in input order (the store positions
 * compared one by one, first difference decides). Negative when `a` is better.
 */
function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.unavailable !== b.unavailable) return a.unavailable - b.unavailable;
  if (a.grandCents !== b.grandCents) return a.grandCents - b.grandCents;
  if (a.used.length !== b.used.length) return a.used.length - b.used.length;
  for (let i = 0; i < a.used.length; i += 1) if (a.used[i] !== b.used[i]) return a.used[i] - b.used[i];
  return 0;
}

/**
 * The plan for one subset of stores: each line is bought at the cheapest store of the subset that
 * sells it, ties to the earlier store (lower index); stores that buy nothing drop out.
 */
function planForSubset(subset: number[], priced: PricedLine[], travelFor: (used: number[]) => Travel): Candidate {
  const buyAt: number[] = [];
  const usedSet = new Set<number>();
  let unavailable = 0;
  let itemsCents = 0;
  for (const { cents } of priced) {
    let best = -1;
    for (const store of subset) {
      const total = cents[store];
      if (total !== null && (best === -1 || total < (cents[best] as number))) best = store; // ascending: ties keep the earlier
    }
    buyAt.push(best);
    if (best === -1) unavailable += 1;
    else {
      usedSet.add(best);
      itemsCents += cents[best] as number;
    }
  }
  const used = [...usedSet].sort((x, y) => x - y);
  const travel = travelFor(used);
  return { buyAt, used, unavailable, itemsCents, travel, grandCents: itemsCents + travel.costCents };
}

/**
 * Travel for the stores a plan really visits (decision D-54): a round trip from home through them,
 * ordered by planRoute; travelDistanceKm is the route's rounded total and travelCost is
 * roundCents(travelDistanceKm x travelCostPerKm), as TECH_SPEC 5.4 says. Cached per set of stores,
 * since many subsets end up visiting the same stores. Without a home: no route, no cost.
 */
function travelCalculator(stores: Store[], home: LatLng | null, travelCostPerKm: number, mode: TravelMode) {
  if (home === null) return () => NO_TRAVEL;
  const cache = new Map<string, Travel>();
  return (used: number[]): Travel => {
    const key = used.join(',');
    let travel = cache.get(key);
    if (!travel) {
      const route = planRoute(home, used.map((index) => stores[index]), { mode, roundTrip: true });
      travel = { route, distanceKm: route.totalDistanceKm, costCents: toCents(route.totalDistanceKm * travelCostPerKm) };
      cache.set(key, travel);
    }
    return travel;
  };
}

/** Calls `visit` with every subset of {0..n-1} of size 1..maxSize, each in ascending order. */
function forEachSubset(n: number, maxSize: number, visit: (subset: number[]) => void): void {
  const subset: number[] = [];
  const extend = (next: number) => {
    if (subset.length > 0) visit(subset);
    if (subset.length === maxSize) return;
    for (let store = next; store < n; store += 1) {
      subset.push(store);
      extend(store + 1);
      subset.pop();
    }
  };
  extend(0);
}

function toShoppingPlan(candidate: Candidate, priced: PricedLine[], stores: Store[]): ShoppingPlan {
  // Route order when there is a route, else input order (decision D-49).
  const { route } = candidate.travel;
  const visitOrder = route
    ? route.stops.map((stop) => candidate.used.find((index) => stores[index].id === stop.storeId)!)
    : candidate.used;
  const planStores: PlanStore[] = visitOrder.map((index) => {
    const lines: PlanLine[] = [];
    let subtotalCents = 0;
    priced.forEach(({ line, unitPrices, cents }, lineIndex) => {
      if (candidate.buyAt[lineIndex] !== index) return;
      subtotalCents += cents[index] as number;
      lines.push({
        key: line.key,
        label: line.label,
        quantity: line.quantity,
        unitPrice: unitPrices[index] as number,
        lineTotal: fromCents(cents[index] as number),
      });
    });
    return { storeId: stores[index].id, lines, subtotal: fromCents(subtotalCents) };
  });
  return {
    storeIds: planStores.map((store) => store.storeId),
    stores: planStores,
    itemsTotal: fromCents(candidate.itemsCents),
    travelDistanceKm: candidate.travel.distanceKm,
    travelCost: fromCents(candidate.travel.costCents),
    grandTotal: fromCents(candidate.grandCents),
    unavailableKeys: priced.filter((_, i) => candidate.buyAt[i] === -1).map(({ line }) => line.key),
    route,
  };
}

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
 *
 * A NaN maxStores throws RangeError; a fractional one is rounded down before clamping (D-48). With a
 * home location, a negative or non-finite travelCostPerKm throws RangeError (D-55); the home and
 * the travel mode are checked by planRoute. Exactness with travel: decision D-56.
 */
export function optimizePurchase(
  lines: BasketLine[],
  stores: Store[],
  prices: PriceTable,
  options: OptimizeOptions
): OptimizationResult {
  if (typeof options.maxStores !== 'number' || Number.isNaN(options.maxStores)) {
    throw new RangeError(`optimizePurchase: maxStores must be a number (got ${String(options.maxStores)})`);
  }
  const home = options.home ?? null;
  if (home !== null && (typeof options.travelCostPerKm !== 'number' || !Number.isFinite(options.travelCostPerKm) || options.travelCostPerKm < 0)) {
    throw new RangeError(`optimizePurchase: travelCostPerKm must be a finite number >= 0 (got ${String(options.travelCostPerKm)})`);
  }

  // Priceable lines (a productId and at least one of `stores` sells it) and the rest, in basket order.
  const priced: PricedLine[] = [];
  const unpricedKeys: string[] = [];
  for (const line of lines) {
    const unitPrices = stores.map((store) => unitPriceAt(prices, line.productId, store.id));
    if (unitPrices.every((price) => price === undefined)) {
      unpricedKeys.push(line.key);
      continue;
    }
    const cents = unitPrices.map((price) => (price === undefined ? null : lineTotalCents(price, line.quantity)));
    priced.push({ line, unitPrices, cents });
  }

  if (stores.length === 0) {
    return { cheapestSingleStore: null, bestPlan: null, byStoreCount: [], savingsVsSingleStore: 0, unpricedKeys };
  }
  const maxStores = Math.min(stores.length, Math.max(1, Math.floor(options.maxStores)));
  const travelFor = travelCalculator(stores, home, options.travelCostPerKm, options.travelMode);

  let best: Candidate | null = null;
  let bestSingle: Candidate | null = null;
  const bestByCount = new Map<number, Candidate>();
  forEachSubset(stores.length, maxStores, (subset) => {
    const candidate = planForSubset(subset, priced, travelFor);
    if (!best || compareCandidates(candidate, best) < 0) best = candidate;
    if (subset.length === 1 && (!bestSingle || compareCandidates(candidate, bestSingle) < 0)) bestSingle = candidate;
    const count = candidate.used.length;
    const current = bestByCount.get(count);
    if (count > 0 && (!current || compareCandidates(candidate, current) < 0)) bestByCount.set(count, candidate);
  });

  // Both are set: there is at least one store, so at least one subset of size 1 was visited.
  const bestPlan = toShoppingPlan(best!, priced, stores);
  const cheapestSingleStore = toShoppingPlan(bestSingle!, priced, stores);
  const byStoreCount = [...bestByCount.keys()]
    .sort((a, b) => a - b)
    .map((count) => toShoppingPlan(bestByCount.get(count)!, priced, stores));
  return {
    cheapestSingleStore,
    bestPlan,
    byStoreCount,
    savingsVsSingleStore: fromCents(bestSingle!.grandCents - best!.grandCents),
    unpricedKeys,
  };
}
