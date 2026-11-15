
### 1-2. Round trip adds the return leg and reports returnDistanceKm; one way reports 0

| | Check | Evidence |
|---|---|---|
| OK | exact search, 5 stops, round trip: returnDistanceKm = last stop to home | last stop budgetbasket to home 4.42565 km, reported 4.43 |
| OK | exact search, 5 stops, round trip: total includes the return leg | legs 22.57892 + return 4.42565 = 27.00457, reported 27 |
| OK | exact search, 5 stops, one way: returnDistanceKm is 0 | reported 0 |
| OK | exact search, 5 stops, one way: total is the legs only | legs 22.57892, reported 22.58 |
| OK | heuristic, 12 stops, round trip: returnDistanceKm = last stop to home | last stop freshmart to home 2.16628 km, reported 2.17 |
| OK | heuristic, 12 stops, round trip: total includes the return leg | legs 31.77868 + return 2.16628 = 33.94496, reported 33.94 |
| OK | heuristic, 12 stops, one way: returnDistanceKm is 0 | reported 0 |
| OK | heuristic, 12 stops, one way: total is the legs only | legs 30.41445, reported 30.41 |

### 3. Durations from the stated speeds (driving 40 km/h, walking 5 km/h)

| | Check | Evidence |
|---|---|---|
| OK | exact search, 5 stops, driving: every leg = km / 40 x 60, rounded | first leg 3.02164 km = 4.53 min, reported 5 |
| OK | exact search, 5 stops, driving: total from the unrounded total distance | 27.00457 km = 40.51 min, reported 41 |
| OK | exact search, 5 stops, walking: every leg = km / 5 x 60, rounded | first leg 3.02164 km = 36.26 min, reported 36 |
| OK | exact search, 5 stops, walking: total from the unrounded total distance | 27.00457 km = 324.05 min, reported 324 |
| OK | exact search, 5 stops: walking and driving give the same order and distances | 27 km: driving 41 min, walking 324 min |
| OK | heuristic, 12 stops, driving: every leg = km / 40 x 60, rounded | first leg 1.91257 km = 2.87 min, reported 3 |
| OK | heuristic, 12 stops, driving: total from the unrounded total distance | 33.94496 km = 50.92 min, reported 51 |
| OK | heuristic, 12 stops, walking: every leg = km / 5 x 60, rounded | first leg 1.91257 km = 22.95 min, reported 23 |
| OK | heuristic, 12 stops, walking: total from the unrounded total distance | 33.94496 km = 407.34 min, reported 407 |
| OK | heuristic, 12 stops: walking and driving give the same order and distances | 33.94 km: driving 51 min, walking 407 min |

### 4. Tie rule: equally short orders keep the input sequence (D-28, D-38)

| | Check | Evidence |
|---|---|---|
| OK | exact, line, round trip: input order kept | input n1,n2,n3 -> n1,n2,n3 |
| OK | exact, line, round trip: other direction, input order kept | input n3,n2,n1 -> n3,n2,n1 |
| OK | exact, one way from the middle: side listed first goes first | input s1,n1,s2,n2 -> s1,s2,n1,n2 |
| OK | heuristic, 10 stops on a line, round trip: input order kept | input n1,n2,n3,n4,n5,n6,n7,n8,n9,n10 -> n1,n2,n3,n4,n5,n6,n7,n8,n9,n10 |
| OK | heuristic, 10 stops on a line, reversed input: reversed order kept | input n10,n9,n8,n7,n6,n5,n4,n3,n2,n1 -> n10,n9,n8,n7,n6,n5,n4,n3,n2,n1 |
| OK | heuristic, input already a shortest order (out and back): kept | input n1,n3,n5,n7,n9,n10,n8,n6,n4,n2 -> n1,n3,n5,n7,n9,n10,n8,n6,n4,n2 |
| OK | heuristic, one way from the middle, 5 + 5 stops: side listed first goes first | input s1,n1,s2,n2,s3,n3,s4,n4,s5,n5 -> s1,s2,s3,s4,s5,n1,n2,n3,n4,n5 |
| OK | heuristic, 9 stops, two at the same spot (s1, s5): visited in input order | order s1,s5,s3,s8,s2,s7,s4,s0,s6 |
| OK | heuristic, 10 stops, input = mirror image of a shortest one-way route: kept | input e1,e0,e3,e2,e4,w4,w2,w1,w0,w3 -> e1,e0,e3,e2,e4,w4,w2,w1,w0,w3 |

### 5. The heuristic output is a permutation of the input

| | Check | Evidence |
|---|---|---|
| OK | 12 stops, round trip: every input store exactly once | 12 stops, 0 missing, 0 repeated |
| OK | 12 stops, one way: every input store exactly once | 12 stops, 0 missing, 0 repeated |

### 6. No stops: zero totals

| | Check | Evidence |
|---|---|---|
| OK | driving, round trip | stops 0, return 0, total 0 km, 0 min |
| OK | driving, one way | stops 0, return 0, total 0 km, 0 min |
| OK | walking, round trip | stops 0, return 0, total 0 km, 0 min |
| OK | walking, one way | stops 0, return 0, total 0 km, 0 min |

### 7. Rounding: legs to 2 decimals / whole minutes; totals from unrounded legs, then rounded

| | Check | Evidence |
|---|---|---|
| OK | 3 stops 1.004 km apart, one way (exact): distance | legs shown 1.00 each (sum 3.00), total 3.01 (3.012 rounded) |
| OK | 3 stops 1.004 km apart, one way: duration | legs shown 2 min each (sum 6), total 5 (4.518 min rounded) |
| OK | 10 stops 1.004 km apart, one way (heuristic): distance | legs shown 1.00 each (sum 10.00), total 10.04 (10.040 rounded) |
| OK | 10 stops 1.004 km apart, one way: duration | legs shown 2 min each (sum 20), total 15 (15.060 min rounded) |

CHECKLIST: all checks OK
