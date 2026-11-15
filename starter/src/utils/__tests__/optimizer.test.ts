import { GOLDEN_LINES, GOLDEN_PRICES, GOLDEN_STORES, GOLDEN_STORES_PORT_MARLOWE, goldenStoreId } from '../../../tests/fixtures/golden';
import { ROUTE_HOME } from '../../../tests/fixtures/route';
import { SMALL_HOME, SMALL_LINES, SMALL_PRICES, SMALL_STORES, bruteForceOptimize, type BrutePlan } from '../../../tests/fixtures/optimizerSmall';
import { GOLDEN_CHAINS, GOLDEN_EXPECTED, GOLDEN_PRODUCTS } from '../../../tests/fixtures/spreadsheet';
import type { BasketLine, LatLng, OptimizationResult, OptimizeOptions, PriceTable, ShoppingPlan, Store } from '../../models';
import { roundTo } from '../money';
import { haversineKm } from '../route';
import { compareBasket } from '../comparison';
import { optimizePurchase } from '../optimizer';

const FREE: Omit<OptimizeOptions, 'maxStores'> = { travelCostPerKm: 0, travelMode: 'driving', home: null };
const optimize = (lines: BasketLine[], stores: Store[], prices: PriceTable, maxStores: number): OptimizationResult =>
  optimizePurchase(lines, stores, prices, { ...FREE, maxStores });

function store(id: string): Store {
  return { id, chainId: id, chainName: id.toUpperCase(), name: `Store ${id}`, address: '', city: '', location: { lat: 0, lng: 0 } };
}
const line = (key: string, productId: string | null, quantity = 1): BasketLine => ({ key, label: key, quantity, productId });
const idsOf = (plan: ShoppingPlan | null) => plan?.storeIds ?? null;
/** Which store buys each line key, from a plan. */
const buyers = (plan: ShoppingPlan) => Object.fromEntries(plan.stores.flatMap((s) => s.lines.map((l) => [l.key, s.storeId])));

// ---------- The golden basket ----------

describe('optimizePurchase: golden basket, free travel', () => {
  // Independent reference from the raw spreadsheet prices, in cents: for each k, the cheapest set of
  // exactly k chains, where a set costs the sum of each product's lowest price within it.
  const priceCents = GOLDEN_PRODUCTS.map((product) => product.prices.map((price) => Math.round(price * 100)));
  const chainIds = GOLDEN_CHAINS.map((chain) => chain.id);
  const referenceFor = (k: number) => {
    let best = { cents: Infinity, chains: [] as string[] };
    for (let mask = 1; mask < 1 << chainIds.length; mask += 1) {
      const chosen = chainIds.map((_, i) => i).filter((i) => mask & (1 << i));
      if (chosen.length !== k) continue;
      const cents = priceCents.reduce((sum, row) => sum + Math.min(...chosen.map((i) => row[i])), 0);
      if (cents < best.cents) best = { cents, chains: chosen.map((i) => chainIds[i]) };
    }
    return best;
  };

  it('acceptance numbers (TECH_SPEC 9): maxStores 1 gives 134.61 at Sunrise, 8 gives 115.56', () => {
    const one = optimize(GOLDEN_LINES, GOLDEN_STORES, GOLDEN_PRICES, 1);
    expect(one.bestPlan!.grandTotal).toBe(134.61);
    expect(one.bestPlan!.storeIds).toEqual([goldenStoreId(GOLDEN_EXPECTED.cheapestChainId)]);
    const eight = optimize(GOLDEN_LINES, GOLDEN_STORES, GOLDEN_PRICES, 8);
    expect(eight.bestPlan!.grandTotal).toBe(115.56);
    expect(eight.bestPlan!.grandTotal).toBe(GOLDEN_EXPECTED.optimalTotal);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('maxStores %i: the best plan equals the cheapest set of at most that many chains', (k) => {
    const result = optimize(GOLDEN_LINES, GOLDEN_STORES, GOLDEN_PRICES, k);
    const reference = referenceFor(k); // more stores never cost more here, so "exactly k" is the best "at most k"
    expect(result.bestPlan!.grandTotal).toBe(reference.cents / 100);
    expect(result.bestPlan!.itemsTotal).toBe(reference.cents / 100);
    expect(result.bestPlan!.storeIds).toEqual(reference.chains.map(goldenStoreId));
    expect(result.bestPlan!.unavailableKeys).toEqual([]);
  });

  it('reports the figures shown to the product owner for maxStores 2 and 3', () => {
    expect(idsOf(optimize(GOLDEN_LINES, GOLDEN_STORES, GOLDEN_PRICES, 2).bestPlan)).toEqual(['store-greenleaf', 'store-sunrise']);
    expect(optimize(GOLDEN_LINES, GOLDEN_STORES, GOLDEN_PRICES, 2).bestPlan!.grandTotal).toBe(124.7);
    expect(idsOf(optimize(GOLDEN_LINES, GOLDEN_STORES, GOLDEN_PRICES, 3).bestPlan)).toEqual(['store-greenleaf', 'store-citypantry', 'store-sunrise']);
    expect(optimize(GOLDEN_LINES, GOLDEN_STORES, GOLDEN_PRICES, 3).bestPlan!.grandTotal).toBe(119.36);
  });

  it('byStoreCount lists the best plan for each k = 1..8; cheapestSingleStore is Sunrise; savings 19.05', () => {
    const result = optimize(GOLDEN_LINES, GOLDEN_STORES, GOLDEN_PRICES, 8);
    expect(result.byStoreCount.map((plan) => plan.storeIds.length)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    result.byStoreCount.forEach((plan, i) => expect(plan.grandTotal).toBe(referenceFor(i + 1).cents / 100));
    expect(result.cheapestSingleStore!.storeIds).toEqual(['store-sunrise']);
    expect(result.cheapestSingleStore!.grandTotal).toBe(134.61);
    expect(result.savingsVsSingleStore).toBe(19.05); // 134.61 - 115.56, exact cents
    expect(result.unpricedKeys).toEqual([]);
  });

  it('plans agree with compareBasket to the cent (same line totals; maxStores 8 = the optimal split)', () => {
    const comparison = compareBasket(GOLDEN_LINES, GOLDEN_STORES, GOLDEN_PRICES);
    const result = optimize(GOLDEN_LINES, GOLDEN_STORES, GOLDEN_PRICES, 8);
    expect(result.bestPlan!.itemsTotal).toBe(comparison.summary.optimalTotal);
    for (const plan of result.byStoreCount) {
      for (const planStore of plan.stores) {
        for (const planLine of planStore.lines) {
          const row = comparison.rows.find((r) => r.key === planLine.key)!;
          expect(planLine.lineTotal).toBe(row.lineTotals[planStore.storeId]);
          expect(planLine.unitPrice).toBe(row.unitPrices[planStore.storeId]);
        }
      }
    }
    // maxStores 1 = the cheapest store total of the comparison.
    expect(optimize(GOLDEN_LINES, GOLDEN_STORES, GOLDEN_PRICES, 1).bestPlan!.grandTotal).toBe(
      comparison.storeTotals.find((t) => t.storeId === comparison.summary.cheapestStoreId)!.total
    );
  });

  it('each plan is consistent: every line once, subtotals add up, items total = grand total without travel', () => {
    for (let k = 1; k <= 8; k += 1) {
      const plan = optimize(GOLDEN_LINES, GOLDEN_STORES, GOLDEN_PRICES, k).bestPlan!;
      const keys = plan.stores.flatMap((s) => s.lines.map((l) => l.key));
      expect([...keys].sort()).toEqual(GOLDEN_LINES.map((l) => l.key).sort());
      const cents = (n: number) => Math.round(n * 100);
      plan.stores.forEach((s) => expect(cents(s.subtotal)).toBe(s.lines.reduce((sum, l) => sum + cents(l.lineTotal), 0)));
      expect(cents(plan.itemsTotal)).toBe(plan.stores.reduce((sum, s) => sum + cents(s.subtotal), 0));
      expect([plan.travelDistanceKm, plan.travelCost, plan.route]).toEqual([0, 0, null]);
      expect(plan.grandTotal).toBe(plan.itemsTotal);
      expect(plan.storeIds).toEqual(plan.stores.map((s) => s.storeId));
      // storeIds in input order (no route without a home)
      const order = plan.storeIds.map((id) => GOLDEN_STORES.findIndex((s) => s.id === id));
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(plan.stores.every((s) => s.lines.length > 0)).toBe(true);
    }
  });

  it('is fast: 8 stores, 16 lines, maxStores 8 in well under 2 seconds', () => {
    const started = Date.now();
    for (let i = 0; i < 10; i += 1) optimize(GOLDEN_LINES, GOLDEN_STORES, GOLDEN_PRICES, 8);
    expect(Date.now() - started).toBeLessThan(2000); // ten runs
  });
});

// ---------- Exactness against exhaustive assignment ----------

describe('optimizePurchase: exact, checked against every possible assignment', () => {
  /**
   * Reference that does not use subsets: every way to buy each priceable line at any store that sells
   * it, or not at all, with at most `limit` distinct stores. Ranked by the spec: unavailable lines,
   * total, number of stores, store positions. Returns the best key.
   *
   * With `exactly`, only assignments that use exactly that many stores AND follow the spec's rule
   * are kept: each line bought at the cheapest store of the stores used (ties: the earlier one), and
   * left unbought only when none of them sells it. (Without the rule, "exactly k" could be reached by
   * buying something at a dearer store, which the spec does not count as a plan.)
   */
  function bestByAssignment(lines: BasketLine[], stores: Store[], prices: PriceTable, limit: number, exactly?: number) {
    const options = lines.map((l) => {
      const sellers = stores
        .map((s, i) => ({ i, price: l.productId !== null ? prices[l.productId]?.[s.id] : undefined }))
        .filter((x): x is { i: number; price: number } => typeof x.price === 'number' && Number.isFinite(x.price))
        .map((x) => ({ i: x.i, cents: Math.round(x.price * l.quantity * 100) }));
      return sellers;
    }).filter((sellers) => sellers.length > 0);
    let best: { unavailable: number; cents: number; used: number[] } | null = null;
    const better = (a: NonNullable<typeof best>, b: NonNullable<typeof best>) =>
      a.unavailable - b.unavailable || a.cents - b.cents || a.used.length - b.used.length ||
      (a.used.find((v, i) => v !== b.used[i]) ?? 0) - (b.used.find((v, i) => v !== a.used[i]) ?? 0);
    const chosen: number[] = []; // store index per line, -1 for not bought
    const followsRule = (used: Set<number>) =>
      options.every((sellers, li) => {
        const inPlan = sellers.filter((x) => used.has(x.i)).sort((a, b) => a.cents - b.cents || a.i - b.i);
        return inPlan.length === 0 ? chosen[li] === -1 : chosen[li] === inPlan[0].i;
      });
    const walk = (i: number, unavailable: number, cents: number, used: Set<number>) => {
      if (used.size > limit) return;
      if (i === options.length) {
        if (exactly !== undefined && (used.size !== exactly || !followsRule(used))) return;
        const candidate = { unavailable, cents, used: [...used].sort((a, b) => a - b) };
        if (!best || better(candidate, best) < 0) best = candidate;
        return;
      }
      chosen[i] = -1;
      walk(i + 1, unavailable + 1, cents, used); // leave it
      for (const { i: s, cents: c } of options[i]) {
        const had = used.has(s);
        used.add(s);
        chosen[i] = s;
        walk(i + 1, unavailable, cents + c, used);
        if (!had) used.delete(s);
      }
    };
    walk(0, 0, 0, new Set());
    return best as { unavailable: number; cents: number; used: number[] } | null;
  }

  const keyOf = (plan: ShoppingPlan, stores: Store[]) => ({
    unavailable: plan.unavailableKeys.length,
    cents: Math.round(plan.grandTotal * 100),
    used: plan.storeIds.map((id) => stores.findIndex((s) => s.id === id)),
  });

  it('agrees on 400 random instances (1-4 stores, 1-6 lines, gaps, ties, quantities, maxStores 0..5)', () => {
    let seed = 47;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
    const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
    for (let run = 0; run < 400; run += 1) {
      const stores = Array.from({ length: 1 + Math.floor(random() * 4) }, (_, i) => store(`s${i}`));
      const lines = Array.from({ length: 1 + Math.floor(random() * 6) }, (_, i) => line(`l${i}`, random() < 0.1 ? null : `p${i}`, pick([1, 1, 2, 0.5, 1.5])));
      const prices: PriceTable = {};
      lines.forEach((l) => {
        if (l.productId === null) return;
        prices[l.productId] = {};
        stores.forEach((s) => { if (random() < 0.7) prices[l.productId!][s.id] = pick([1, 1.5, 2, 2, 3, 4.99]); });
      });
      const maxStores = Math.floor(random() * 6);
      const limit = Math.min(stores.length, Math.max(1, maxStores));
      const result = optimize(lines, stores, prices, maxStores);
      expect(keyOf(result.bestPlan!, stores)).toEqual(bestByAssignment(lines, stores, prices, limit));
      expect(keyOf(result.cheapestSingleStore!, stores)).toEqual(bestByAssignment(lines, stores, prices, 1));
      for (let k = 1; k <= limit; k += 1) {
        const expected = bestByAssignment(lines, stores, prices, k, k);
        const got = result.byStoreCount.find((p) => p.storeIds.length === k);
        if (expected === null) expect(got).toBeUndefined();
        else expect(keyOf(got!, stores)).toEqual(expected);
      }
      expect(result.byStoreCount.every((p) => p.storeIds.length <= limit && p.storeIds.length > 0)).toBe(true);
    }
  });
});

// ---------- The rules of TECH_SPEC 5.4 ----------

describe('optimizePurchase: ranking and assignment rules', () => {
  const A = store('a');
  const B = store('b');
  const C = store('c');

  it('a line is bought at the cheapest store of the plan; a tie goes to the earlier store', () => {
    const lines = [line('milk', 'm'), line('eggs', 'e'), line('tea', 't')];
    const prices = { m: { a: 2, b: 1 }, e: { a: 3, b: 3 }, t: { a: 1, b: 5 } };
    const plan = optimize(lines, [A, B], prices, 2).bestPlan!;
    expect(buyers(plan)).toEqual({ milk: 'b', eggs: 'a', tea: 'a' });
    const reversed = optimize(lines, [B, A], prices, 2).bestPlan!;
    expect(buyers(reversed).eggs).toBe('b'); // b is now the earlier store
  });

  it('a cheaper plan that cannot buy an item loses to a dearer plan that can', () => {
    const lines = [line('milk', 'm'), line('caviar', 'c')];
    const prices = { m: { a: 1, b: 5 }, c: { b: 50 } };
    const result = optimize(lines, [A, B], prices, 1);
    expect(idsOf(result.bestPlan)).toEqual(['b']);
    expect(result.bestPlan!.grandTotal).toBe(55);
    expect(result.bestPlan!.unavailableKeys).toEqual([]);
  });

  it('at equal totals, fewer stores wins', () => {
    const lines = [line('milk', 'm'), line('eggs', 'e')];
    const prices = { m: { a: 2, b: 2 }, e: { a: 3, b: 3 } };
    expect(idsOf(optimize(lines, [A, B], prices, 2).bestPlan)).toEqual(['a']);
  });

  it('at equal totals and store counts, the earliest stores in input order win', () => {
    const lines = [line('milk', 'm'), line('eggs', 'e')];
    const prices = { m: { a: 1, b: 9, c: 1 }, e: { a: 9, b: 1, c: 1 } };
    // {c} alone costs 2.00; {a, b} also 2.00 but 2 stores: c wins on fewer stores.
    expect(idsOf(optimize(lines, [A, B, C], prices, 2).bestPlan)).toEqual(['c']);
    const tie = { m: { a: 1, b: 1, c: 1 }, e: { a: 1, b: 1, c: 1 } };
    expect(idsOf(optimize(lines, [C, B, A], tie, 3).bestPlan)).toEqual(['c']); // first in input order
    // Two-store tie: {a, c} and {b, c} cost the same; positions (0, 2) beat (1, 2).
    const twoStore = { m: { a: 1, b: 1, c: 5 }, e: { a: 5, b: 5, c: 1 } };
    expect(idsOf(optimize(lines, [A, B, C], twoStore, 2).bestPlan)).toEqual(['a', 'c']);
  });

  it('stores that end up with no lines are dropped from the plan', () => {
    const lines = [line('milk', 'm')];
    const prices = { m: { a: 1, b: 2 } };
    const result = optimize(lines, [A, B], prices, 2);
    expect(idsOf(result.bestPlan)).toEqual(['a']);
    expect(result.byStoreCount.map((p) => p.storeIds.length)).toEqual([1]); // no plan really uses 2 stores
  });

  it('byStoreCount only has entries for store counts some plan really uses, ascending', () => {
    const lines = [line('milk', 'm'), line('eggs', 'e')];
    const prices = { m: { a: 1 }, e: { b: 1 } }; // c sells nothing
    const result = optimize(lines, [A, B, C], prices, 3);
    expect(result.byStoreCount.map((p) => p.storeIds)).toEqual([['a'], ['a', 'b']]);
  });

  it('savingsVsSingleStore = single store grand total - best grand total, exact cents', () => {
    const lines = [line('milk', 'm'), line('eggs', 'e')];
    const prices = { m: { a: 1.1, b: 1.3 }, e: { a: 2.2, b: 2.0 } };
    const result = optimize(lines, [A, B], prices, 2);
    expect(result.cheapestSingleStore!.grandTotal).toBe(3.3);
    expect(result.bestPlan!.grandTotal).toBe(3.1);
    expect(result.savingsVsSingleStore).toBe(0.2); // not 0.19999999999999973
  });

  it('savingsVsSingleStore can be negative: the best plan buys more items than any single store (D-51)', () => {
    const lines = [line('milk', 'm'), line('caviar', 'c')];
    const prices = { m: { a: 1 }, c: { b: 100 } };
    const result = optimize(lines, [A, B], prices, 2);
    expect(result.cheapestSingleStore!.storeIds).toEqual(['a']); // 1 item missing, 1.00
    expect(result.bestPlan!.grandTotal).toBe(101); // nothing missing
    expect(result.savingsVsSingleStore).toBe(-100);
  });

  it('quantities are priced like compareBasket (line total rounded once, in cents)', () => {
    const lines = [line('milk', 'm', 3), line('rice', 'r', 1.5), line('cheese', 'ch', 0.333)];
    const prices = { m: { a: 4.35 }, r: { a: 1.99 }, ch: { a: 3.2 } };
    const plan = optimize(lines, [A], prices, 1).bestPlan!;
    expect(plan.stores[0].lines.map((l) => [l.unitPrice, l.lineTotal])).toEqual([[4.35, 13.05], [1.99, 2.99], [3.2, 1.07]]);
    expect(plan.itemsTotal).toBe(17.11);
  });
});

describe('optimizePurchase: unpriced lines, empty input, maxStores', () => {
  const A = store('a');
  const B = store('b');

  it('unpricedKeys: no productId, sold only by a store not in the list, or only at a non-finite price', () => {
    const lines = [line('mystery', null), line('milk', 'm'), line('caviar', 'c'), line('broken', 'x')];
    const prices = { m: { a: 1 }, c: { z: 99 }, x: { a: NaN } };
    const result = optimize(lines, [A], prices, 1);
    expect(result.unpricedKeys).toEqual(['mystery', 'caviar', 'broken']);
    expect(result.bestPlan!.unavailableKeys).toEqual([]); // unpriced lines are in no plan
    expect(result.bestPlan!.stores[0].lines.map((l) => l.key)).toEqual(['milk']);
  });

  it('ids such as constructor or toString are not prices', () => {
    const lines = [line('a', 'constructor'), line('b', 'toString')];
    expect(optimize(lines, [store('length')], {}, 1).unpricedKeys).toEqual(['a', 'b']);
  });

  it('no stores: everything null, byStoreCount empty, every line unpriced', () => {
    const lines = [line('milk', 'm')];
    expect(optimize(lines, [], { m: { a: 1 } }, 3)).toEqual({
      cheapestSingleStore: null,
      bestPlan: null,
      byStoreCount: [],
      savingsVsSingleStore: 0,
      unpricedKeys: ['milk'],
    });
  });

  it('empty basket: plans with no stores (not null), never listed in byStoreCount', () => {
    const result = optimize([], [A, B], {}, 2);
    const empty = { storeIds: [], stores: [], itemsTotal: 0, travelDistanceKm: 0, travelCost: 0, grandTotal: 0, unavailableKeys: [], route: null };
    expect(result.bestPlan).toEqual(empty);
    expect(result.cheapestSingleStore).toEqual(empty);
    expect(result.byStoreCount).toEqual([]);
    expect(result.savingsVsSingleStore).toBe(0);
  });

  it('a single store that sells nothing wanted: cheapestSingleStore has no stores and every line unavailable', () => {
    const lines = [line('milk', 'm')];
    const result = optimize(lines, [A, B], { m: { b: 2 } }, 1);
    expect(idsOf(result.cheapestSingleStore)).toEqual(['b']);
    const onlyA = optimize(lines, [A], { m: { a: NaN } }, 1);
    expect(onlyA.unpricedKeys).toEqual(['milk']);
  });

  it.each([
    [0, 1], [-5, 1], [-Infinity, 1], [1, 1], [2.9, 2], [3, 3], [100, 3], [Infinity, 3],
  ])('maxStores %p is used as %p (3 stores)', (maxStores, used) => {
    // Three stores, each the only seller of one line: the best plan uses exactly min(maxStores, 3) when allowed.
    const lines = [line('x', 'x'), line('y', 'y'), line('z', 'z')];
    const prices = { x: { a: 1 }, y: { b: 1 }, z: { c: 1 } };
    const result = optimize(lines, [store('a'), store('b'), store('c')], prices, maxStores);
    expect(result.bestPlan!.storeIds).toHaveLength(used);
    expect(Math.max(...result.byStoreCount.map((p) => p.storeIds.length))).toBe(used);
  });

  it.each([NaN, '3' as unknown as number, undefined as unknown as number])('maxStores %p throws a RangeError', (maxStores) => {
    expect(() => optimize([], [A], {}, maxStores)).toThrow(RangeError);
  });

  it('does not modify its inputs', () => {
    const lines = [line('milk', 'm'), line('eggs', 'e')];
    const prices = { m: { a: 1, b: 2 }, e: { a: 3, b: 1 } };
    const stores = [A, B];
    const before = JSON.stringify([lines, prices, stores]);
    optimize(lines, stores, prices, 2);
    expect(JSON.stringify([lines, prices, stores])).toBe(before);
  });
});

// ---------- With a home location: travel ----------

/** Shortest round trip from home through the points, by trying every order (independent of planRoute). */
function bruteForceRoundTripKm(home: LatLng, points: LatLng[]): number {
  if (points.length === 0) return 0;
  let best = Infinity;
  const visit = (from: LatLng, left: LatLng[], sofar: number) => {
    if (sofar >= best) return;
    if (left.length === 0) {
      best = Math.min(best, sofar + haversineKm(from, home));
      return;
    }
    left.forEach((p, i) => visit(p, [...left.slice(0, i), ...left.slice(i + 1)], sofar + haversineKm(from, p)));
  };
  visit(home, points, 0);
  return best;
}

/** Spec 5.4: travelDistanceKm = the route's rounded total; travelCost = roundCents(km x rate), in cents. */
const travelCents = (km: number, rate: number) => Math.round(roundTo(roundTo(km, 2) * rate, 2) * 100);

const withHome = (home: LatLng, rate: number, maxStores: number, mode: 'driving' | 'walking' = 'driving'): OptimizeOptions => ({
  maxStores,
  travelCostPerKm: rate,
  travelMode: mode,
  home,
});

describe('optimizePurchase with a home: golden basket at the real store locations', () => {
  const stores = GOLDEN_STORES_PORT_MARLOWE;
  const priceCents = GOLDEN_PRODUCTS.map((p) => p.prices.map((x) => Math.round(x * 100)));

  /** Every non-empty set of the 8 stores with its items total (cents) and brute-force round trip (km). */
  function allSets(home: LatLng) {
    const sets: { idx: number[]; itemsCents: number; km: number }[] = [];
    for (let mask = 1; mask < 256; mask += 1) {
      const idx = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => mask & (1 << i));
      const itemsCents = priceCents.reduce((sum, row) => sum + Math.min(...idx.map((i) => row[i])), 0);
      sets.push({ idx, itemsCents, km: bruteForceRoundTripKm(home, idx.map((i) => stores[i].location)) });
    }
    return sets;
  }

  /** Reference best for "exactly k stores used" and "at most k": lowest grand total, then fewer, then earlier. */
  function referenceBest(sets: ReturnType<typeof allSets>, rate: number, filter: (size: number) => boolean) {
    // Only sets whose cheapest assignment really uses every store count as "using" them.
    const usesAll = (idx: number[]) => idx.every((s) => priceCents.some((row) => idx.reduce((b, i) => (row[i] < row[b] ? i : b), idx[0]) === s));
    const ranked = sets
      .filter((set) => filter(set.idx.length) && usesAll(set.idx))
      .map((set) => ({ ...set, grand: set.itemsCents + travelCents(set.km, rate) }))
      .sort((a, b) => a.grand - b.grand || a.idx.length - b.idx.length || (a.idx.find((v, i) => v !== b.idx[i]) ?? 0) - (b.idx.find((v, i) => v !== a.idx[i]) ?? 0));
    return ranked[0];
  }

  const homes: [string, LatLng][] = [
    ['town centre (ROUTE_HOME)', ROUTE_HOME],
    ['next to Sunrise', { lat: 29.18, lng: -81.015 }],
    ['north-west, near Harvest', { lat: 29.25, lng: -81.09 }],
  ];
  const setsByHome = new Map(homes.map(([name, home]) => [name, allSets(home)]));

  it.each(homes.flatMap(([name]) => [0, 0.35, 1, 5].map((rate) => [name, rate] as const)))(
    'home %s, %p per km: bestPlan and byStoreCount equal the brute-force reference for maxStores 1..8',
    (name, rate) => {
      const home = homes.find(([n]) => n === name)![1];
      const sets = setsByHome.get(name)!;
      for (let maxStores = 1; maxStores <= 8; maxStores += 1) {
        const result = optimizePurchase(GOLDEN_LINES, stores, GOLDEN_PRICES, withHome(home, rate, maxStores));
        const ref = referenceBest(sets, rate, (size) => size <= maxStores);
        const best = result.bestPlan!;
        expect(Math.round(best.grandTotal * 100)).toBe(ref.grand);
        expect([...best.storeIds].sort()).toEqual(ref.idx.map((i) => stores[i].id).sort());
        expect(best.travelDistanceKm).toBe(roundTo(ref.km, 2));
        for (const plan of result.byStoreCount) {
          const exact = referenceBest(sets, rate, (size) => size === plan.storeIds.length);
          expect(Math.round(plan.grandTotal * 100)).toBe(exact.grand);
        }
      }
    }
  );

  it('the figures shown to the product owner: home 29.2,-81.05, 0.35 per km, maxStores 3', () => {
    const result = optimizePurchase(GOLDEN_LINES, stores, GOLDEN_PRICES, withHome(ROUTE_HOME, 0.35, 3));
    const rows = result.byStoreCount.map((p) => [p.storeIds, p.itemsTotal, p.travelDistanceKm, p.travelCost, p.grandTotal]);
    expect(rows).toEqual([
      [['store-freshmart'], 135.51, 4.33, 1.52, 137.03],
      [['store-freshmart', 'store-greenleaf'], 126.2, 7.82, 2.74, 128.94],
      [['store-citypantry', 'store-greenleaf', 'store-cornercoop'], 119.97, 11.22, 3.93, 123.9],
    ]);
    expect(result.bestPlan!.grandTotal).toBe(123.9);
    expect(result.cheapestSingleStore!.storeIds).toEqual(['store-freshmart']); // not Sunrise: 134.61 + 2.89 = 137.50
    expect(result.savingsVsSingleStore).toBe(13.13);
  });

  it('travel cost 0 with a home: the same totals as without a home', () => {
    for (let maxStores = 1; maxStores <= 8; maxStores += 1) {
      const free = optimize(GOLDEN_LINES, GOLDEN_STORES, GOLDEN_PRICES, maxStores);
      const zero = optimizePurchase(GOLDEN_LINES, stores, GOLDEN_PRICES, withHome(ROUTE_HOME, 0, maxStores));
      expect(zero.bestPlan!.grandTotal).toBe(free.bestPlan!.grandTotal);
      expect([...zero.bestPlan!.storeIds].sort()).toEqual([...free.bestPlan!.storeIds].sort());
      expect(zero.bestPlan!.travelCost).toBe(0);
      expect(zero.bestPlan!.route).not.toBeNull();
    }
  });

  it('meets the performance budget: 8 stores, 16 lines, maxStores 8, with a home, in under 2 seconds', () => {
    let started = Date.now();
    optimizePurchase(GOLDEN_LINES, stores, GOLDEN_PRICES, withHome(ROUTE_HOME, 0.35, 8));
    expect(Date.now() - started).toBeLessThan(2000);
    // Worst case: each store is the only cheapest seller of 2 items, so all 255 subsets visit all
    // their stores and each needs its own exact route.
    const worstLines = Array.from({ length: 16 }, (_, i) => line(`w${i}`, `w${i}`));
    const worstPrices: PriceTable = Object.fromEntries(
      worstLines.map((l, i) => [l.productId!, Object.fromEntries(stores.map((s, j) => [s.id, j === Math.floor(i / 2) ? 1 : 5 + j]))])
    );
    started = Date.now();
    const worst = optimizePurchase(worstLines, stores, worstPrices, withHome(ROUTE_HOME, 0.35, 8));
    expect(Date.now() - started).toBeLessThan(2000);
    expect(worst.byStoreCount).toHaveLength(8);
  });
});

describe('optimizePurchase with a home: exact, checked against every possible assignment', () => {
  it('agrees on 300 random instances (1-4 stores at random places, 1-5 lines, rates 0..3)', () => {
    let seed = 4711;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
    const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
    const at = (): LatLng => ({ lat: 29.15 + random() * 0.1, lng: -81.1 + random() * 0.1 });
    for (let run = 0; run < 300; run += 1) {
      const stores = Array.from({ length: 1 + Math.floor(random() * 4) }, (_, i) => ({ ...store(`s${i}`), location: at() }));
      const lines = Array.from({ length: 1 + Math.floor(random() * 5) }, (_, i) => line(`l${i}`, `p${i}`));
      const prices: PriceTable = {};
      lines.forEach((l) => {
        prices[l.productId!] = {};
        stores.forEach((s) => { if (random() < 0.75) prices[l.productId!][s.id] = pick([1, 1.5, 2, 3, 4.99, 7]); });
      });
      const home = at();
      const rate = pick([0, 0.2, 0.35, 1, 3]);
      const maxStores = 1 + Math.floor(random() * 4);
      const limit = Math.min(maxStores, stores.length);
      const result = optimizePurchase(lines, stores, prices, withHome(home, rate, maxStores));

      // Every assignment of each line to a seller (or to nobody), any stores, at most `limit` of them.
      const sellers = lines.map((l) => stores.map((s, i) => ({ i, c: prices[l.productId!][s.id] })).filter((x) => x.c !== undefined).map((x) => ({ i: x.i, c: Math.round(x.c! * 100) })));
      const priceable = sellers.filter((x) => x.length > 0);
      let best: { un: number; grand: number; used: number[] } | null = null;
      const walk = (i: number, un: number, items: number, used: number[]) => {
        if (new Set(used).size > limit) return;
        if (i === priceable.length) {
          const u = [...new Set(used)].sort((a, b) => a - b);
          const km = bruteForceRoundTripKm(home, u.map((x) => stores[x].location));
          const cand = { un, grand: items + travelCents(km, rate), used: u };
          const cmp = !best ? -1 : cand.un - best.un || cand.grand - best.grand || cand.used.length - best.used.length ||
            (cand.used.find((v, k) => v !== best!.used[k]) ?? 0) - (best.used.find((v, k) => v !== cand.used[k]) ?? 0);
          if (cmp < 0) best = cand;
          return;
        }
        walk(i + 1, un + 1, items, used);
        for (const { i: s, c } of priceable[i]) walk(i + 1, un, items + c, [...used, s]);
      };
      walk(0, 0, 0, []);
      const plan = result.bestPlan!;
      expect({
        un: plan.unavailableKeys.length,
        grand: Math.round(plan.grandTotal * 100),
        used: plan.storeIds.map((id) => stores.findIndex((s) => s.id === id)).sort((a, b) => a - b),
      }).toEqual(best);
    }
  });
});

describe('optimizePurchase with a home: travel rules', () => {
  const home = { lat: 0, lng: 0 };
  const kmPerDegree = (6371 * Math.PI) / 180;
  const north = (id: string, km: number): Store => ({ ...store(id), location: { lat: km / kmPerDegree, lng: 0 } });

  it('travelCost is computed from the ROUNDED distance, as the spec says (2.01 km x 10 = 20.10, not 20.15)', () => {
    const far = north('a', 1.00745); // round trip 2.0149 km -> travelDistanceKm 2.01
    const plan = optimizePurchase([line('milk', 'm')], [far], { m: { a: 1 } }, withHome(home, 10, 1)).bestPlan!;
    expect(plan.travelDistanceKm).toBe(2.01);
    expect(plan.travelCost).toBe(20.1);
    expect(plan.grandTotal).toBe(21.1);
  });

  it('a store whose saving is smaller than its detour is left out; a bigger saving is worth the trip', () => {
    const near = north('near', 1); // round trip 2 km
    const far = north('far', 11); // 20 km further there and back: 7.00 at 0.35/km
    const lines = [line('milk', 'm'), line('tv', 't')];
    const small = optimizePurchase(lines, [near, far], { m: { near: 2, far: 1 }, t: { near: 100, far: 95 } }, withHome(home, 0.35, 2)).bestPlan!;
    expect(small.storeIds).toEqual(['near']); // saves 6.00 on items, the detour costs 7.00
    const big = optimizePurchase(lines, [near, far], { m: { near: 2, far: 1 }, t: { near: 100, far: 90 } }, withHome(home, 0.35, 2)).bestPlan!;
    expect([...big.storeIds].sort()).toEqual(['far']); // saves 11.00 for 7.00 of extra travel: far alone beats both
  });

  it('storeIds, stores and route.stops follow the route order; the route is a round trip from home', () => {
    const stores = [north('c', 3), north('a', 1), north('b', 2)];
    const lines = [line('x', 'x'), line('y', 'y'), line('z', 'z')];
    const prices = { x: { a: 1 }, y: { b: 1 }, z: { c: 1 } };
    const plan = optimizePurchase(lines, stores, prices, withHome(home, 0.35, 3)).bestPlan!;
    expect(plan.route!.roundTrip).toBe(true);
    expect(plan.route!.origin).toEqual(home);
    expect(plan.storeIds).toEqual(plan.route!.stops.map((s) => s.storeId));
    expect(plan.stores.map((s) => s.storeId)).toEqual(plan.storeIds);
    expect(plan.storeIds).toEqual(['c', 'b', 'a']); // a line: both directions tie, planRoute keeps the input sequence (c first)
    expect(plan.travelDistanceKm).toBe(plan.route!.totalDistanceKm);
  });

  it('the travel mode changes durations only, never the choice or the cost', () => {
    const stores = GOLDEN_STORES_PORT_MARLOWE;
    const drive = optimizePurchase(GOLDEN_LINES, stores, GOLDEN_PRICES, withHome(ROUTE_HOME, 0.35, 3, 'driving')).bestPlan!;
    const walk = optimizePurchase(GOLDEN_LINES, stores, GOLDEN_PRICES, withHome(ROUTE_HOME, 0.35, 3, 'walking')).bestPlan!;
    expect(walk.storeIds).toEqual(drive.storeIds);
    expect(walk.grandTotal).toBe(drive.grandTotal);
    expect(walk.route!.totalDurationMin).toBeGreaterThan(drive.route!.totalDurationMin * 7);
    expect(walk.route!.mode).toBe('walking');
  });

  it('an incomplete plan never beats a complete one, however much cheaper it is with travel', () => {
    const near = north('near', 0.5);
    const far = north('far', 20);
    const lines = [line('milk', 'm'), line('bread', 'b'), line('coffee', 'c')];
    const prices = { m: { near: 1, far: 2 }, b: { near: 1, far: 2 }, c: { far: 8 } };
    const result = optimizePurchase(lines, [near, far], prices, withHome(home, 0.35, 1));
    expect(result.bestPlan!.storeIds).toEqual(['far']); // 12.00 + 14.00 travel = 26.00
    expect(result.bestPlan!.grandTotal).toBe(26);
    expect(result.cheapestSingleStore!.storeIds).toEqual(['far']); // near would be 2.00 + 0.35, but misses coffee
  });

  it('an empty basket with a home: a plan with no stores and a zero-length route (not null)', () => {
    const result = optimizePurchase([], [north('a', 1)], {}, withHome(home, 0.35, 1));
    expect(result.bestPlan!.storeIds).toEqual([]);
    expect(result.bestPlan!.route).toEqual({ mode: 'driving', origin: home, stops: [], roundTrip: true, returnDistanceKm: 0, totalDistanceKm: 0, totalDurationMin: 0 });
    expect([result.bestPlan!.travelDistanceKm, result.bestPlan!.travelCost]).toEqual([0, 0]);
  });

  it.each([NaN, -0.01, Infinity, '0.35' as unknown as number])('with a home, travelCostPerKm %p throws a RangeError', (rate) => {
    expect(() => optimizePurchase([], [north('a', 1)], {}, withHome(home, rate, 1))).toThrow(RangeError);
  });

  it('without a home, travelCostPerKm is not used (any value accepted)', () => {
    expect(() => optimizePurchase([], [north('a', 1)], {}, { ...FREE, travelCostPerKm: -5, maxStores: 1 })).not.toThrow();
  });

  it('an invalid home is rejected by planRoute (RangeError)', () => {
    expect(() => optimizePurchase([line('m', 'm')], [north('a', 1)], { m: { a: 1 } }, withHome({ lat: NaN, lng: 0 }, 0.35, 1))).toThrow(RangeError);
  });
});

// ---------- Cross-check on a small instance, for every maxStores ----------

describe('optimizePurchase equals a brute-force search on a small instance, for every maxStores', () => {
  // tests/fixtures/optimizerSmall.ts: 4 stores, 8 items (a price tie, a half-cent line, an item only
  // one store sells, an item with no product, an item sold nowhere). The brute force tries every
  // assignment of items to stores and every visiting order; it shares no code with the optimizer.
  const RATE = 0.35;
  const cents = (n: number) => Math.round(n * 100);
  const inInputOrder = (ids: string[]) => [...ids].sort((a, b) => SMALL_STORES.findIndex((s) => s.id === a) - SMALL_STORES.findIndex((s) => s.id === b));

  const inOrder = (ids: string[]) => inInputOrder(ids);
  /** Every field of a plan against the brute force's plan. */
  function expectSamePlan(plan: ShoppingPlan | null, brute: BrutePlan | null, withHome: boolean) {
    if (brute === null) return expect(plan).toBeNull();
    expect(plan).not.toBeNull();
    const p = plan!;
    expect(inInputOrder(p.storeIds)).toEqual(brute.storeIds);
    expect(buyers(p)).toEqual(brute.buyers);
    expect(cents(p.itemsTotal)).toBe(brute.itemsCents);
    expect(p.travelDistanceKm).toBe(brute.travelKm);
    expect(cents(p.travelCost)).toBe(brute.travelCents);
    expect(cents(p.grandTotal)).toBe(brute.grandCents);
    expect(p.unavailableKeys).toEqual(brute.unavailableKeys);
    if (withHome) {
      expect(p.route!.stops.map((s) => s.storeId)).toEqual(p.storeIds); // stores listed in route order
      expect(p.route!.totalDistanceKm).toBe(brute.travelKm);
    } else {
      expect(p.route).toBeNull();
      expect(p.storeIds).toEqual(brute.storeIds); // input order without a route
    }
  }

  const cases = [null, SMALL_HOME].flatMap((home) => [-2, 0, 1, 2, 3, 4, 5, 9].map((maxStores) => [home ? 'with a home' : 'free travel', maxStores, home] as const));

  it.each(cases)('%s, maxStores %p', (_label, maxStores, home) => {
    const options = { maxStores, travelCostPerKm: RATE, travelMode: 'driving' as const, home };
    const result = optimizePurchase(SMALL_LINES, SMALL_STORES, SMALL_PRICES, options);
    const brute = bruteForceOptimize(SMALL_LINES, SMALL_STORES, SMALL_PRICES, { maxStores, travelCostPerKm: RATE, home });

    expectSamePlan(result.bestPlan, brute.best, home !== null);
    expectSamePlan(result.cheapestSingleStore, brute.single, home !== null);
    expect(result.byStoreCount.map((p) => p.storeIds.length)).toEqual([...brute.byCount.keys()].sort((a, b) => a - b));
    result.byStoreCount.forEach((p) => expectSamePlan(p, brute.byCount.get(p.storeIds.length)!, home !== null));
    expect(cents(result.savingsVsSingleStore)).toBe(brute.savingsCents);
    expect(result.unpricedKeys).toEqual(brute.unpricedKeys);
  });

  it('the instance is not trivial: the best plan changes with maxStores and with travel', () => {
    const bestFor = (maxStores: number, home: LatLng | null) =>
      optimizePurchase(SMALL_LINES, SMALL_STORES, SMALL_PRICES, { maxStores, travelCostPerKm: RATE, travelMode: 'driving', home }).bestPlan!.storeIds.join(',');
    const free = new Set([1, 2, 3, 4].map((k) => bestFor(k, null)));
    const travel = new Set([1, 2, 3, 4].map((k) => bestFor(k, SMALL_HOME)));
    expect(free.size).toBeGreaterThanOrEqual(3);
    expect(travel.size).toBeGreaterThanOrEqual(2);
    expect([1, 2, 3, 4].some((k) => bestFor(k, null) !== bestFor(k, SMALL_HOME))).toBe(true);
  });

  it('the instance has the edge features it claims: a tie, a half-cent line, unpriced items, an item only two stores sell', () => {
    const result = optimizePurchase(SMALL_LINES, SMALL_STORES, SMALL_PRICES, { maxStores: 1, travelCostPerKm: 0, travelMode: 'driving', home: null });
    expect(result.unpricedKeys).toEqual(['mystery', 'caviar']);
    expect(SMALL_PRICES.milk.n).toBe(SMALL_PRICES.milk.s);
    expect((SMALL_PRICES.eggs.s * 1.5 * 100) % 1).not.toBe(0); // 298.5 cents before rounding
    expect(Object.keys(SMALL_PRICES.rice).sort()).toEqual(['f', 'n']);
    // West mirrors East: same prices, same distance from home, listed later.
    expect(SMALL_PRICES.bread.w).toBe(SMALL_PRICES.bread.e);
    const east = SMALL_STORES.find((s) => s.id === 'e')!.location;
    const west = SMALL_STORES.find((s) => s.id === 'w')!.location;
    expect(haversineKm(SMALL_HOME, west)).toBe(haversineKm(SMALL_HOME, east));
  });

  it('the last tie-break decides here: with a home, North + East beats North + West (same cost, East listed first)', () => {
    const result = optimizePurchase(SMALL_LINES, SMALL_STORES, SMALL_PRICES, { maxStores: 2, travelCostPerKm: 0.35, travelMode: 'driving', home: SMALL_HOME });
    expect(inOrder(result.bestPlan!.storeIds)).toEqual(['n', 'e']);
    const mirrored = [...SMALL_STORES].sort((a, b) => (a.id === 'w' ? -1 : b.id === 'w' ? 1 : 0)); // West listed first
    const flipped = optimizePurchase(SMALL_LINES, mirrored, SMALL_PRICES, { maxStores: 2, travelCostPerKm: 0.35, travelMode: 'driving', home: SMALL_HOME });
    expect([...flipped.bestPlan!.storeIds].sort()).toEqual(['n', 'w']);
    expect(flipped.bestPlan!.grandTotal).toBe(result.bestPlan!.grandTotal);
  });
});

// ---------- Edge cases a real caller hits: nothing throws ----------

describe('optimizePurchase: edge cases a caller hits never throw', () => {
  const A = store('a');
  const B = store('b');
  const prices = { milk: { a: 1, b: 2 }, eggs: { b: 2 }, nothing: {}, caviar: { z: 9 }, gold: { a: NaN } };
  const items = [line('milk', 'milk'), line('eggs', 'eggs')];
  const cases: [string, BasketLine[], Store[], number][] = [
    ['no stores', items, [], 3],
    ['no lines', [], [A, B], 3],
    ['no stores and no lines', [], [], 3],
    ['an item nobody sells', [...items, line('nothing', 'nothing')], [A, B], 2],
    ['an item sold only by a store not in the list', [...items, line('caviar', 'caviar')], [A, B], 2],
    ['an item whose only price is NaN', [...items, line('gold', 'gold')], [A, B], 2],
    ['an item with no product', [...items, line('mystery', null)], [A, B], 2],
    ['every item unpriced', [line('mystery', null), line('nothing', 'nothing')], [A, B], 2],
    ['maxStores 0', items, [A, B], 0],
    ['maxStores -3', items, [A, B], -3],
    ['maxStores 0.5', items, [A, B], 0.5],
    ['maxStores -Infinity', items, [A, B], -Infinity],
    ['maxStores 10', items, [A, B], 10],
    ['maxStores Infinity', items, [A, B], Infinity],
  ];
  const homes = [null, { lat: 0, lng: 0 }];

  it.each(homes.flatMap((home) => cases.map(([name, l, s, m]) => [home ? 'with a home' : 'no home', name, l, s, m, home] as const)))(
    '%s: %s',
    (_h, _name, lines, stores, maxStores, home) => {
      const run = () => optimizePurchase(lines, stores, prices, { maxStores, travelCostPerKm: 0.35, travelMode: 'driving', home });
      expect(run).not.toThrow();
      const result = run();
      if (stores.length === 0) {
        expect([result.bestPlan, result.cheapestSingleStore, result.byStoreCount, result.savingsVsSingleStore]).toEqual([null, null, [], 0]);
      } else {
        expect(result.bestPlan).not.toBeNull();
        expect(result.cheapestSingleStore).not.toBeNull();
        expect(result.bestPlan!.storeIds.length).toBeLessThanOrEqual(Math.min(stores.length, Math.max(1, Math.floor(maxStores))));
        if (home) expect(result.bestPlan!.route).not.toBeNull();
      }
      expect(Number.isFinite(result.savingsVsSingleStore)).toBe(true);
      // Unpriced items are reported, and appear in no plan.
      const priceable = lines.filter((l) => l.productId !== null && stores.some((s) => Number.isFinite((prices as PriceTable)[l.productId!]?.[s.id])));
      expect(result.unpricedKeys).toEqual(lines.filter((l) => !priceable.includes(l)).map((l) => l.key));
      for (const plan of [result.bestPlan, result.cheapestSingleStore, ...result.byStoreCount]) {
        if (!plan) continue;
        const inPlan = [...plan.stores.flatMap((s) => s.lines.map((x) => x.key)), ...plan.unavailableKeys];
        expect(inPlan.filter((key) => result.unpricedKeys.includes(key))).toEqual([]);
      }
    }
  );
});
