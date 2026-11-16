/** Shared by the adapter tests. Not a test file (no `.test.ts`), so Jest does not run it alone. */
import type { ProviderParseResult } from '../types';

/** Deterministic pseudo-random numbers in [0, 1) (mulberry32), so a failing run can be replayed. */
export function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The invariants of TECH_SPEC 4.1 that every returned row must satisfy. */
export function expectValidRows(result: ProviderParseResult): void {
  for (const row of result.rows) {
    expect(row.sku).not.toBe('');
    expect(row.sku).toBe(row.sku.trim());
    expect(row.price).toBeGreaterThan(0);
    expect(Math.round(row.price * 100) / 100).toBe(row.price);
    expect(Math.round(row.regularPrice * 100) / 100).toBe(row.regularPrice);
    expect(row.regularPrice).toBeGreaterThanOrEqual(row.price);
    if (!row.onSale) expect(row.regularPrice).toBe(row.price);
  }
}
