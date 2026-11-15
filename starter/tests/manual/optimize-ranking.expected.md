### 1. A plan that cannot buy every item never beats one that can

Near sells milk and bread for 2.00 and is 0.5 km away, but has no coffee. Far has all three for 12.00 and is 20 km away. maxStores 1.

Stores (km from home): near 0.5, far 20.0; 0.35 per km; maxStores 1.

| Rank | Stores visited | Missing items | Items | km | Travel | Grand total | Below the one above because |
|---:|---|---:|---:|---:|---:|---:|---|
| 1 | far | 0 | 12.00 | 40.00 | 14.00 | 26.00 | **best** |
| 2 | near | 1 | 2.00 | 1.00 | 0.35 | 2.35 | more items missing |

optimizePurchase: bestPlan ["far"] 26.00 (missing []) OK; cheapestSingleStore ["far"] OK; byStoreCount [["far"]]

### 2. Same stores, maxStores 2: buying at both is complete and cheapest

Milk and bread at near, coffee at far: every item, and cheaper than far alone.

Stores (km from home): near 0.5, far 20.0; 0.35 per km; maxStores 2.

| Rank | Stores visited | Missing items | Items | km | Travel | Grand total | Below the one above because |
|---:|---|---:|---:|---:|---:|---:|---|
| 1 | near → far | 0 | 10.00 | 40.00 | 14.00 | 24.00 | **best** |
| 2 | far | 0 | 12.00 | 40.00 | 14.00 | 26.00 | higher grand total |
| 3 | near | 1 | 2.00 | 1.00 | 0.35 | 2.35 | more items missing |

optimizePurchase: bestPlan ["near","far"] 24.00 (missing []) OK; cheapestSingleStore ["far"] OK; byStoreCount [["far"],["near","far"]]

### 3. Equal grand totals: fewer stores wins

c sells milk 1.00 and eggs 2.00 (3.00); a has milk at 1.00, b eggs at 2.00. c alone, {a, b} and {a, c} all cost 3.00: c wins with one store; between the two-store plans, {a, b} (positions 1, 2) beats {a, c} (1, 3). Travel is free (0 per km) so that the totals really tie.

Stores (km from home): a 1.0, b 2.0, c 3.0; 0.00 per km; maxStores 3.

| Rank | Stores visited | Missing items | Items | km | Travel | Grand total | Below the one above because |
|---:|---|---:|---:|---:|---:|---:|---|
| 1 | c | 0 | 3.00 | 6.00 | 0.00 | 3.00 | **best** |
| 2 | a → b | 0 | 3.00 | 4.00 | 0.00 | 3.00 | same total, more stores |
| 3 | a → c | 0 | 3.00 | 6.00 | 0.00 | 3.00 | same total and stores, listed later |
| 4 | b → c | 0 | 3.00 | 6.00 | 0.00 | 3.00 | same total and stores, listed later |
| 5 | a | 1 | 1.00 | 2.00 | 0.00 | 1.00 | more items missing |
| 6 | b | 1 | 2.00 | 4.00 | 0.00 | 2.00 | higher grand total |

optimizePurchase: bestPlan ["c"] 3.00 (missing []) OK; cheapestSingleStore ["c"] OK; byStoreCount [["c"],["a","b"]]

### 4. Equal totals and store counts: the stores listed earliest win

a and b have identical prices, c is cheap for eggs: {a, c} and {b, c} cost the same with two stores each, and positions (1, 3) beat (2, 3). The three one-store plans all cost 8.00: a, listed first, is cheapestSingleStore.

Stores (km from home): a 1.0, b 1.0, c 1.0; 0.00 per km; maxStores 2.

| Rank | Stores visited | Missing items | Items | km | Travel | Grand total | Below the one above because |
|---:|---|---:|---:|---:|---:|---:|---|
| 1 | a → c | 0 | 4.00 | 2.00 | 0.00 | 4.00 | **best** |
| 2 | b → c | 0 | 4.00 | 2.00 | 0.00 | 4.00 | same total and stores, listed later |
| 3 | a | 0 | 8.00 | 2.00 | 0.00 | 8.00 | higher grand total |
| 4 | b | 0 | 8.00 | 2.00 | 0.00 | 8.00 | same total and stores, listed later |
| 5 | c | 0 | 8.00 | 2.00 | 0.00 | 8.00 | same total and stores, listed later |

optimizePurchase: bestPlan ["a","c"] 4.00 (missing []) OK; cheapestSingleStore ["a"] OK; byStoreCount [["a"],["a","c"]]

### 5. Travel: a saving smaller than the detour is not worth it

far sells the TV 6.00 cheaper, but is 10 km beyond near: 20 km more there and back, 7.00 at 0.35 per km.

Stores (km from home): near 1.0, far 11.0; 0.35 per km; maxStores 2.

| Rank | Stores visited | Missing items | Items | km | Travel | Grand total | Below the one above because |
|---:|---|---:|---:|---:|---:|---:|---|
| 1 | near | 0 | 102.00 | 2.00 | 0.70 | 102.70 | **best** |
| 2 | far | 0 | 96.00 | 22.00 | 7.70 | 103.70 | higher grand total |
| 3 | near → far | 0 | 96.00 | 22.00 | 7.70 | 103.70 | same total, more stores |

optimizePurchase: bestPlan ["near"] 102.70 (missing []) OK; cheapestSingleStore ["near"] OK; byStoreCount [["near"],["near","far"]]

RANKING SCENARIOS: 5 OK, 0 mismatched
