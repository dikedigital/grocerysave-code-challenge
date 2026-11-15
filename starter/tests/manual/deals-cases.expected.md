### exactlyAtThreshold: A drop of exactly the threshold

Threshold 10%. 1.00 -> 0.90 is exactly 10%; at threshold 10 it counts. (The float formula gives 9.999999999999998 and would miss it.) 5.00 -> 4.50 is exactly 10% too.

Input points, in the order given:

| # | store | product | date | price | onSale |
|---:|---|---|---|---:|---|
| 1 | a | milk | 2026-10-19 | 1.00 | false |
| 2 | a | milk | 2026-10-26 | 0.90 | false |
| 3 | a | eggs | 2026-10-19 | 5.00 | false |
| 4 | a | eggs | 2026-10-26 | 4.50 | false |

Deals returned (2):

| product | store | old | new | dropPct | date | onSale |
|---|---|---:|---:|---:|---|---|
| eggs | a | 5.00 | 4.50 | 10 | 2026-10-26 | false |
| milk | a | 1.00 | 0.90 | 10 | 2026-10-26 | false |

OK: equals the expected result

### justUnderThreshold: A drop just under the threshold

Threshold 10%. 1.00 -> 0.91 is 9%, and 5.00 -> 4.51 is 9.8% (one cent short of 10%): no deal at threshold 10.

Input points, in the order given:

| # | store | product | date | price | onSale |
|---:|---|---|---|---:|---|
| 1 | a | milk | 2026-10-19 | 1.00 | false |
| 2 | a | milk | 2026-10-26 | 0.91 | false |
| 3 | a | eggs | 2026-10-19 | 5.00 | false |
| 4 | a | eggs | 2026-10-26 | 4.51 | false |

Deals returned (0):

(none)

OK: equals the expected result

### singleSnapshot: A product with a single snapshot

Threshold 10%. Only one snapshot of milk at store a (even a very low price) gives nothing to compare: no deal. Eggs at b have two snapshots and drop 50%.

Input points, in the order given:

| # | store | product | date | price | onSale |
|---:|---|---|---|---:|---|
| 1 | a | milk | 2026-11-09 | 0.01 | false |
| 2 | b | eggs | 2026-11-02 | 4.00 | false |
| 3 | b | eggs | 2026-11-09 | 2.00 | false |

Deals returned (1):

| product | store | old | new | dropPct | date | onSale |
|---|---|---:|---:|---:|---|---|
| eggs | b | 4.00 | 2.00 | 50 | 2026-11-09 | false |

OK: equals the expected result

### threeSnapshotsNoDeal: Three snapshots: only the last two matter (no deal)

Threshold 10%. 10.00 -> 5.00 -> 4.80. The latest drop is 5.00 -> 4.80 = 4%: no deal, although 10.00 -> 4.80 would be 52%.

Input points, in the order given:

| # | store | product | date | price | onSale |
|---:|---|---|---|---:|---|
| 1 | a | milk | 2026-10-19 | 10.00 | false |
| 2 | a | milk | 2026-10-26 | 5.00 | false |
| 3 | a | milk | 2026-11-02 | 4.80 | false |

Deals returned (0):

(none)

OK: equals the expected result

### threeSnapshotsDeal: Three snapshots: only the last two matter (deal)

Threshold 10%. 4.00 -> 5.00 -> 4.50. The latest drop is 5.00 -> 4.50 = 10%: a deal, although 4.50 is dearer than 4.00 three weeks ago. Points are given out of date order on purpose: dates decide, not input order.

Input points, in the order given:

| # | store | product | date | price | onSale |
|---:|---|---|---|---:|---|
| 1 | a | milk | 2026-11-02 | 4.50 | true |
| 2 | a | milk | 2026-10-19 | 4.00 | false |
| 3 | a | milk | 2026-10-26 | 5.00 | false |

Deals returned (1):

| product | store | old | new | dropPct | date | onSale |
|---|---|---:|---:|---:|---|---|
| milk | a | 5.00 | 4.50 | 10 | 2026-11-02 | true |

OK: equals the expected result

### sameDateLastWins: Two points on the same date: the last one given wins

Threshold 10%. W2 has 4.00 and then 4.80; the later point (4.80) is the W2 snapshot: 5.00 -> 4.80 = 4%, no deal. For eggs the same two prices come in the other order, so 4.00 wins: 5.00 -> 4.00 = 20%, a deal.

Input points, in the order given:

| # | store | product | date | price | onSale |
|---:|---|---|---|---:|---|
| 1 | a | milk | 2026-10-19 | 5.00 | false |
| 2 | a | milk | 2026-10-26 | 4.00 | false |
| 3 | a | milk | 2026-10-26 | 4.80 | false |
| 4 | a | eggs | 2026-10-19 | 5.00 | false |
| 5 | a | eggs | 2026-10-26 | 4.80 | false |
| 6 | a | eggs | 2026-10-26 | 4.00 | false |

Deals returned (1):

| product | store | old | new | dropPct | date | onSale |
|---|---|---:|---:|---:|---|---|
| eggs | a | 5.00 | 4.00 | 20 | 2026-10-26 | false |

OK: equals the expected result

### sameDateNotTwoSnapshots: Two points on the same date are one snapshot, not two

Threshold 10%. Both points are on W2, so the pair has a single snapshot: no deal (it is not compared with itself).

Input points, in the order given:

| # | store | product | date | price | onSale |
|---:|---|---|---|---:|---|
| 1 | a | milk | 2026-10-26 | 5.00 | false |
| 2 | a | milk | 2026-10-26 | 2.00 | false |

Deals returned (0):

(none)

OK: equals the expected result

### mixedSortOrder: Sort order of a mixed result

Threshold 10%. dropPct descending: 50% first, then 25%, then the 20% ties ordered by productId (bread < milk) and, within milk, by storeId (a < b < c), then 10%. Input is deliberately shuffled. A 5% drop and a rise are left out.

Input points, in the order given:

| # | store | product | date | price | onSale |
|---:|---|---|---|---:|---|
| 1 | c | milk | 2026-10-19 | 5.00 | false |
| 2 | c | milk | 2026-10-26 | 4.00 | false |
| 3 | b | tea | 2026-10-19 | 3.00 | false |
| 4 | b | tea | 2026-10-26 | 2.70 | false |
| 5 | b | milk | 2026-10-19 | 2.50 | false |
| 6 | b | milk | 2026-10-26 | 2.00 | false |
| 7 | a | rice | 2026-10-19 | 4.00 | false |
| 8 | a | rice | 2026-10-26 | 3.00 | false |
| 9 | z | bread | 2026-10-19 | 1.00 | false |
| 10 | z | bread | 2026-10-26 | 0.80 | false |
| 11 | a | milk | 2026-10-19 | 10.00 | false |
| 12 | a | milk | 2026-10-26 | 8.00 | false |
| 13 | a | coffee | 2026-10-19 | 8.00 | false |
| 14 | a | coffee | 2026-10-26 | 4.00 | true |
| 15 | a | soap | 2026-10-19 | 2.00 | false |
| 16 | a | soap | 2026-10-26 | 1.90 | false |
| 17 | b | soap | 2026-10-19 | 2.00 | false |
| 18 | b | soap | 2026-10-26 | 2.20 | false |

Deals returned (7):

| product | store | old | new | dropPct | date | onSale |
|---|---|---:|---:|---:|---|---|
| coffee | a | 8.00 | 4.00 | 50 | 2026-10-26 | true |
| rice | a | 4.00 | 3.00 | 25 | 2026-10-26 | false |
| bread | z | 1.00 | 0.80 | 20 | 2026-10-26 | false |
| milk | a | 10.00 | 8.00 | 20 | 2026-10-26 | false |
| milk | b | 2.50 | 2.00 | 20 | 2026-10-26 | false |
| milk | c | 5.00 | 4.00 | 20 | 2026-10-26 | false |
| tea | b | 3.00 | 2.70 | 10 | 2026-10-26 | false |

OK: equals the expected result

DEAL SCENARIOS: 8 OK, 0 mismatched
