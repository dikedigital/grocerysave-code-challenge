### planRoute: 12 stops (heuristic), round trip

Input order: citypantry, budgetbasket, cornercoop, sunrise, extra-seaside, extra-westfield, extra-northridge, extra-pinecrest, freshmart, valugrocer, greenleaf, harvest

| # | Stop | Leg km | Driving min | Walking min |
|---:|---|---:|---:|---:|
| 1 | Corner Co-op Mill Lane | 1.91 | 3 | 23 |
| 2 | Harvest Foods Lakeside | 3.40 | 5 | 41 |
| 3 | Northridge Market (fictional) | 1.96 | 3 | 24 |
| 4 | Pinecrest Pantry (fictional) | 6.09 | 9 | 73 |
| 5 | ValuGrocer Westgate | 0.96 | 1 | 11 |
| 6 | Westfield Foods (fictional) | 1.31 | 2 | 16 |
| 7 | Budget Basket Southside | 3.81 | 6 | 46 |
| 8 | Seaside Grocer (fictional) | 3.90 | 6 | 47 |
| 9 | Sunrise Market Harbor View | 1.51 | 2 | 18 |
| 10 | City Pantry Downtown | 2.42 | 4 | 29 |
| 11 | GreenLeaf Market Old Town | 2.68 | 4 | 32 |
| 12 | FreshMart Beacon Street | 1.82 | 3 | 22 |
| | back home | 2.17 | | |
| | **Total** | **33.94** | **51** | **407** |

Walking and driving: same order and distances: yes; walking/driving total minutes = 7.98 (speeds 40 / 5 = 8)

| Check | Result | Detail |
|---|---|---|
| valid permutation of the 12 input stops | OK | 12 stops, 12 distinct, missing [], duplicated [] |
| no longer than plain nearest neighbour | OK | 33.94496 km vs nearest neighbour 39.00401 km (saves 5.05905 km) |
| no 2-opt reversal left that helps | OK | best remaining reversal saves 7.1e-15 km (up to 1e-9 km is float noise, D-29) |
| tie rule: no equally short reversal keeps the input sequence better | OK | found: none |
| tie rule: input order kept if it is equally short | OK | input order is longer, so not applicable |
| not shorter than the true optimum | OK | optimum 33.94496 km; gap 0.00000 km (0.00%) |
| walking and driving share the route | OK |  |

For scale: the input order is 75.06698 km.

### Empty input

planRoute(home, [], { mode: 'driving', roundTrip: true }) = {"mode":"driving","origin":{"lat":29.2,"lng":-81.05},"stops":[],"roundTrip":true,"returnDistanceKm":0,"totalDistanceKm":0,"totalDurationMin":0}
planRoute(home, [], { mode: 'walking', roundTrip: true }) = {"mode":"walking","origin":{"lat":29.2,"lng":-81.05},"stops":[],"roundTrip":true,"returnDistanceKm":0,"totalDistanceKm":0,"totalDurationMin":0}

HEURISTIC CHECKS: 7 OK, 0 failed
