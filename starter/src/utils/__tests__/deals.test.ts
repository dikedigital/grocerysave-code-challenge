import { DEAL_SCENARIOS, point } from '../../../tests/fixtures/dealScenarios';
import type { Deal, PricePoint } from '../../models';
import { detectDeals } from '../deals';

const W1 = '2026-10-19';
const W2 = '2026-10-26';
const W3 = '2026-11-02';

/** Deals for one pair with two snapshots, old -> new, at a threshold. */
const pair = (oldPrice: number, newPrice: number, thresholdPct: number) =>
  detectDeals([point('s', 'p', W1, oldPrice), point('s', 'p', W2, newPrice)], thresholdPct);

// ---------- The scenarios (also shown by tests/manual/deals-cases.ts) ----------

describe('detectDeals: scenarios worked out by hand', () => {
  it.each(Object.entries(DEAL_SCENARIOS).map(([name, scenario]) => [name, scenario] as const))('%s', (_name, scenario) => {
    expect(detectDeals(scenario.points, scenario.thresholdPct)).toEqual(scenario.expected);
  });
});

// ---------- The threshold ----------

describe('detectDeals: the threshold is inclusive and exact', () => {
  it('counts $1.00 -> $0.90 at 10% (the float formula gives 9.999999999999998)', () => {
    expect(((1.0 - 0.9) / 1.0) * 100).toBeLessThan(10); // the trap
    expect(pair(1.0, 0.9, 10)).toEqual([{ storeId: 's', productId: 'p', date: W2, oldPrice: 1, newPrice: 0.9, dropPct: 10, onSale: false }]);
  });

  it('matches an integer-only reference for every old price from $0.01 to $50.00 at several thresholds', () => {
    // Thresholds with up to 2 decimals (the database column is numeric(5,2)). Reference, in integers
    // only: drop / old >= t / 100  <=>  drop x 10000 >= (t x 100) x old.
    const thresholds = [0.01, 5, 10, 12.5, 15, 20, 25, 33.33, 50, 99.99, 100];
    let checked = 0;
    for (const t of thresholds) {
      const tHundredths = Math.round(t * 100);
      for (let oldCents = 1; oldCents <= 5000; oldCents += 1) {
        // The smallest whole-cent drop that reaches the threshold, and one cent less.
        const minDrop = Math.ceil((tHundredths * oldCents) / 10000);
        for (const drop of [minDrop - 1, minDrop]) {
          if (drop < 1 || drop > oldCents) continue;
          const expectedDeal = drop * 10000 >= tHundredths * oldCents;
          const deals = pair(oldCents / 100, (oldCents - drop) / 100, t);
          if (deals.length !== (expectedDeal ? 1 : 0)) {
            throw new Error(`old ${oldCents}c, drop ${drop}c, threshold ${t}: expected ${expectedDeal ? 'a deal' : 'none'}`);
          }
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(100000);
  });

  it('is not fooled by float noise in threshold x old price (0.07 x 10000 is 700.0000000000001)', () => {
    // $100.00 -> $99.93 is exactly 0.07%; $50.00 -> $49.93 exactly 0.14%. Found by a search over all
    // 2-decimal thresholds; without snapping the product, both deals are missed (D-40).
    expect(0.07 * 10000).toBeGreaterThan(700);
    expect(pair(100, 99.93, 0.07)).toHaveLength(1);
    expect(pair(50, 49.93, 0.14)).toHaveLength(1);
    expect(pair(100, 99.94, 0.07)).toEqual([]); // one cent less of a drop: 0.06%
  });

  it('needs a real drop: at threshold 0 an unchanged price is not a deal, one cent less is', () => {
    expect(pair(2.5, 2.5, 0)).toEqual([]);
    expect(pair(2.5, 2.49, 0)).toHaveLength(1);
    expect(pair(2.5, 2.6, 0)).toEqual([]);
  });

  it('threshold 100: only a drop to 0 qualifies; above 100 nothing does', () => {
    expect(pair(3, 0.01, 100)).toEqual([]);
    expect(pair(3, 0, 100)).toEqual([{ storeId: 's', productId: 'p', date: W2, oldPrice: 3, newPrice: 0, dropPct: 100, onSale: false }]);
    expect(pair(3, 0, 100.01)).toEqual([]);
  });

  it('a previous price of 0 can never drop (no division by zero, no NaN or Infinity)', () => {
    expect(pair(0, 0, 0)).toEqual([]);
    expect(pair(0, 1, 0)).toEqual([]);
  });

  it.each([NaN, Infinity, -Infinity, -0.01, -10, '10' as unknown as number, undefined as unknown as number])(
    'rejects the threshold %p with a RangeError',
    (threshold) => {
      expect(() => detectDeals([], threshold)).toThrow(RangeError);
    }
  );
});

// ---------- What is compared ----------

describe('detectDeals: snapshots and fields', () => {
  it('returns [] for no points', () => {
    expect(detectDeals([], 10)).toEqual([]);
  });

  it('compares the price paid, not the regular price', () => {
    // On sale: price drops, regular price does not -> deal. Regular price drops, price does not -> none.
    expect(detectDeals([point('s', 'p', W1, 5), point('s', 'p', W2, 4, true, 5)], 10)).toHaveLength(1);
    expect(detectDeals([point('s', 'p', W1, 5, false, 9), point('s', 'p', W2, 5, false, 5)], 10)).toEqual([]);
  });

  it('takes date and onSale from the latest snapshot', () => {
    const [deal] = detectDeals([point('s', 'p', W1, 5, true, 6), point('s', 'p', W2, 4, false)], 10);
    expect(deal.date).toBe(W2);
    expect(deal.onSale).toBe(false);
    const [sale] = detectDeals([point('s', 'p', W1, 5), point('s', 'p', W2, 4, true, 5)], 10);
    expect(sale.onSale).toBe(true);
  });

  it('only the two latest dates matter, wherever the points are in the input', () => {
    const points = [point('s', 'p', W3, 4.5), point('s', 'p', W1, 100), point('s', 'p', W2, 5)];
    expect(detectDeals(points, 10)).toEqual([{ storeId: 's', productId: 'p', date: W3, oldPrice: 5, newPrice: 4.5, dropPct: 10, onSale: false }]);
    expect(detectDeals([...points].reverse(), 10)).toEqual(detectDeals(points, 10));
  });

  it('same date: the last point given wins, also for the previous snapshot', () => {
    const points = [point('s', 'p', W1, 9), point('s', 'p', W1, 5), point('s', 'p', W2, 4.5)];
    expect(detectDeals(points, 10)).toEqual([{ storeId: 's', productId: 'p', date: W2, oldPrice: 5, newPrice: 4.5, dropPct: 10, onSale: false }]);
  });

  it('same date: the last point also supplies onSale', () => {
    const points = [point('s', 'p', W1, 5), point('s', 'p', W2, 4, true, 5), point('s', 'p', W2, 4, false)];
    expect(detectDeals(points, 10)[0].onSale).toBe(false);
  });

  it('pairs are independent: same product at other stores, other products at the same store', () => {
    const points = [
      point('a', 'milk', W1, 5), point('a', 'milk', W2, 4), // 20%
      point('b', 'milk', W1, 5), point('b', 'milk', W2, 5), // flat
      point('a', 'eggs', W2, 1), // single snapshot
    ];
    expect(detectDeals(points, 10).map((d) => [d.storeId, d.productId])).toEqual([['a', 'milk']]);
  });

  it('prices are whole cents; dropPct is unrounded, from exact cents', () => {
    const [deal] = pair(2.999, 2.0, 10); // 2.999 is 3.00 in cents
    expect([deal.oldPrice, deal.newPrice]).toEqual([3, 2]);
    expect(deal.dropPct).toBe(10000 / 300); // 33.333333333333336
    const [small] = pair(0.07, 0.03, 10);
    expect(small.dropPct).toBe(400 / 7); // 57.142857142857146, the nearest double to 4/7 x 100
    expect(((0.07 - 0.03) / 0.07) * 100).not.toBe(400 / 7); // the float formula gives 57.14285714285715
  });

  it('equal ratios give identical dropPct values, so they tie in the sort', () => {
    const deals = detectDeals(
      [point('a', 'x', W1, 5), point('a', 'x', W2, 4.5), point('a', 'y', W1, 1234.5), point('a', 'y', W2, 1111.05)],
      10
    );
    expect(deals.map((d) => d.dropPct)).toEqual([10, 10]);
    expect(deals.map((d) => d.productId)).toEqual(['x', 'y']);
  });

  it('does not modify the input', () => {
    const points = Object.freeze(DEAL_SCENARIOS.mixedSortOrder.points.map((p) => Object.freeze({ ...p }))) as PricePoint[];
    const before = JSON.stringify(points);
    detectDeals(points, 10);
    expect(JSON.stringify(points)).toBe(before);
  });
});

// ---------- Sorting ----------

describe('detectDeals: sort order', () => {
  it('dropPct descending, then productId, then storeId, in plain character order', () => {
    const drop20 = (store: string, product: string) => [point(store, product, W1, 5), point(store, product, W2, 4)];
    const deals = detectDeals(
      [...drop20('b', 'p2'), ...drop20('a', 'p10'), ...drop20('B', 'p2'), ...drop20('a', 'P9'), ...drop20('a', 'p2')],
      10
    );
    // 'P' (80) < 'p' (112); 'p10' < 'p2' (character by character); 'B' (66) < 'a' < 'b'.
    expect(deals.map((d) => `${d.productId}@${d.storeId}`)).toEqual(['P9@a', 'p10@a', 'p2@B', 'p2@a', 'p2@b']);
  });

  it('a bigger drop always comes first, whatever the ids', () => {
    const deals = detectDeals([point('z', 'z', W1, 10), point('z', 'z', W2, 1), point('a', 'a', W1, 10), point('a', 'a', W2, 8)], 10);
    expect(deals.map((d) => d.dropPct)).toEqual([90, 20]);
  });
});

// ---------- Unusable points and odd ids ----------

describe('detectDeals: unusable points are ignored (as if not listed that week)', () => {
  it.each([
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['negative', -1],
    ['a string', '3.50' as unknown as number],
    ['null', null as unknown as number],
  ])('a %s latest price: the two earlier snapshots are compared instead', (_label, bad) => {
    const points = [point('s', 'p', W1, 5), point('s', 'p', W2, 4), point('s', 'p', W3, bad)];
    expect(detectDeals(points, 10)).toEqual([{ storeId: 's', productId: 'p', date: W2, oldPrice: 5, newPrice: 4, dropPct: 20, onSale: false }]);
  });

  it.each(['2026-1-5', '26-10-19', '2026/10/26', '', 'yesterday', '2026-10-26T00:00:00Z'])('a point dated %p is ignored', (date) => {
    const points = [point('s', 'p', W1, 5), point('s', 'p', date, 1)];
    expect(detectDeals(points, 10)).toEqual([]);
  });

  it('an unusable point does not replace a usable one on the same date', () => {
    const points = [point('s', 'p', W1, 5), point('s', 'p', W2, 4), point('s', 'p', W2, NaN)];
    expect(detectDeals(points, 10)).toHaveLength(1);
  });

  it('ids such as constructor, __proto__ and toString are ordinary ids', () => {
    const ids = ['constructor', '__proto__', 'toString', 'hasOwnProperty'];
    const points = ids.flatMap((id) => [point(id, id, W1, 5), point(id, id, W2, 4)]);
    expect(detectDeals(points, 10).map((d) => d.productId)).toEqual([...ids].sort());
  });
});

// ---------- Against an independent reference ----------

describe('detectDeals: random inputs against a straightforward reference', () => {
  /** Obvious implementation, in integer cents; only usable, valid-looking inputs are generated. */
  function reference(points: PricePoint[], thresholdPct: number): Deal[] {
    const groups = new Map<string, PricePoint[]>();
    points.forEach((p) => {
      const key = JSON.stringify([p.storeId, p.productId]);
      groups.set(key, [...(groups.get(key) ?? []), p]);
    });
    const deals: Deal[] = [];
    for (const group of groups.values()) {
      const lastPerDate = new Map<string, PricePoint>();
      group.forEach((p) => lastPerDate.set(p.date, p));
      const dates = [...lastPerDate.keys()].sort();
      if (dates.length < 2) continue;
      const prev = lastPerDate.get(dates[dates.length - 2])!;
      const last = lastPerDate.get(dates[dates.length - 1])!;
      const oldC = Math.round(prev.price * 100);
      const newC = Math.round(last.price * 100);
      const tH = Math.round(thresholdPct * 100);
      if (newC >= oldC || (oldC - newC) * 10000 < tH * oldC) continue;
      deals.push({ storeId: last.storeId, productId: last.productId, date: last.date, oldPrice: oldC / 100, newPrice: newC / 100, dropPct: ((oldC - newC) * 100) / oldC, onSale: last.onSale });
    }
    const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    return deals.sort((a, b) => b.dropPct - a.dropPct || cmp(a.productId, b.productId) || cmp(a.storeId, b.storeId));
  }

  it('agrees on 300 random inputs (duplicate dates, shuffled order, ties)', () => {
    let seed = 56;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
    const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
    const dates = ['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09'];
    let totalDeals = 0;
    for (let run = 0; run < 300; run += 1) {
      const points = Array.from({ length: 1 + Math.floor(random() * 40) }, () =>
        point(pick(['a', 'b', 'c']), pick(['milk', 'eggs', 'rice', 'tea']), pick(dates), pick([0, 1, 2, 2.5, 3, 4, 4.5, 5, 9.99, 10]), random() < 0.3)
      );
      const threshold = pick([0, 5, 10, 12.5, 20, 50, 100]);
      const got = detectDeals(points, threshold);
      expect(got).toEqual(reference(points, threshold));
      totalDeals += got.length;
    }
    expect(totalDeals).toBeGreaterThan(100); // the inputs really produce deals
  });
});
