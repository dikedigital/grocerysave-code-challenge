### planRoute: 12 stops (heuristic), one way

Input order: citypantry, budgetbasket, cornercoop, sunrise, extra-seaside, extra-westfield, extra-northridge, extra-pinecrest, freshmart, valugrocer, greenleaf, harvest

| # | Stop | Leg km | Driving min | Walking min |
|---:|---|---:|---:|---:|
| 1 | Corner Co-op Mill Lane | 1.91 | 3 | 23 |
| 2 | GreenLeaf Market Old Town | 3.60 | 5 | 43 |
| 3 | FreshMart Beacon Street | 1.82 | 3 | 22 |
| 4 | City Pantry Downtown | 1.58 | 2 | 19 |
| 5 | Sunrise Market Harbor View | 2.42 | 4 | 29 |
| 6 | Seaside Grocer (fictional) | 1.51 | 2 | 18 |
| 7 | Budget Basket Southside | 3.90 | 6 | 47 |
| 8 | Westfield Foods (fictional) | 3.81 | 6 | 46 |
| 9 | ValuGrocer Westgate | 1.31 | 2 | 16 |
| 10 | Pinecrest Pantry (fictional) | 0.96 | 1 | 11 |
| 11 | Harvest Foods Lakeside | 5.63 | 8 | 68 |
| 12 | Northridge Market (fictional) | 1.96 | 3 | 24 |
| | **Total** | **30.41** | **46** | **365** |

Walking and driving: same order and distances: yes; walking/driving total minutes = 7.93 (speeds 40 / 5 = 8)

| Check | Result | Detail |
|---|---|---|
| valid permutation of the 12 input stops | OK | 12 stops, 12 distinct, missing [], duplicated [] |
| no longer than plain nearest neighbour | OK | 30.41445 km vs nearest neighbour 35.16235 km (saves 4.74789 km) |
| no 2-opt reversal left that helps | OK | best remaining reversal saves 0.0e+0 km (up to 1e-9 km is float noise, D-29) |
| tie rule: no equally short reversal keeps the input sequence better | OK | found: none |
| tie rule: input order kept if it is equally short | OK | input order is longer, so not applicable |
| not shorter than the true optimum | OK | optimum 30.39242 km; gap 0.02204 km (0.07%) |
| walking and driving share the route | OK |  |

For scale: the input order is 69.75971 km.

### Empty input

planRoute(home, [], { mode: 'driving', roundTrip: false }) = {"mode":"driving","origin":{"lat":29.2,"lng":-81.05},"stops":[],"roundTrip":false,"returnDistanceKm":0,"totalDistanceKm":0,"totalDurationMin":0}
planRoute(home, [], { mode: 'walking', roundTrip: false }) = {"mode":"walking","origin":{"lat":29.2,"lng":-81.05},"stops":[],"roundTrip":false,"returnDistanceKm":0,"totalDistanceKm":0,"totalDurationMin":0}

HEURISTIC CHECKS: 7 OK, 0 failed
