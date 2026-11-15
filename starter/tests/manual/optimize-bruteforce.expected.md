Stores: North (n), East (e), South (s), Far (f), West (w). Items: Milk x2, Bread x1, Coffee x1, Eggs x1.5, Rice x1, Cheese x1, Mystery x1, Caviar x1.

### Free travel (no home)

| maxStores | optimizePurchase: bestPlan | brute force: best | byStoreCount (optimizer) | byCount (brute force) | All fields agree |
|---:|---|---|---|---|---|
| -2 | Far 21.45 | Far 21.45 | 1: 21.45 | 1: 21.45 | yes |
| 0 | Far 21.45 | Far 21.45 | 1: 21.45 | 1: 21.45 | yes |
| 1 | Far 21.45 | Far 21.45 | 1: 21.45 | 1: 21.45 | yes |
| 2 | South + Far 21.09 | South + Far 21.09 | 1: 21.45, 2: 21.09 | 1: 21.45, 2: 21.09 | yes |
| 3 | East + South + Far 20.89 | East + South + Far 20.89 | 1: 21.45, 2: 21.09, 3: 20.89 | 1: 21.45, 2: 21.09, 3: 20.89 | yes |
| 4 | East + South + Far 20.89 | East + South + Far 20.89 | 1: 21.45, 2: 21.09, 3: 20.89, 4: 20.89 | 1: 21.45, 2: 21.09, 3: 20.89, 4: 20.89 | yes |
| 5 | East + South + Far 20.89 | East + South + Far 20.89 | 1: 21.45, 2: 21.09, 3: 20.89, 4: 20.89 | 1: 21.45, 2: 21.09, 3: 20.89, 4: 20.89 | yes |
| 9 | East + South + Far 20.89 | East + South + Far 20.89 | 1: 21.45, 2: 21.09, 3: 20.89, 4: 20.89 | 1: 21.45, 2: 21.09, 3: 20.89, 4: 20.89 | yes |

### With a home (0, 0), 0.35 per km

| maxStores | optimizePurchase: bestPlan | brute force: best | byStoreCount (optimizer) | byCount (brute force) | All fields agree |
|---:|---|---|---|---|---|
| -2 | Far 26.96 | Far 26.96 | 1: 26.96 | 1: 26.96 | yes |
| 0 | Far 26.96 | Far 26.96 | 1: 26.96 | 1: 26.96 | yes |
| 1 | Far 26.96 | Far 26.96 | 1: 26.96 | 1: 26.96 | yes |
| 2 | North + East 26.74 | North + East 26.74 | 1: 26.96, 2: 26.74 | 1: 26.96, 2: 26.74 | yes |
| 3 | North + East 26.74 | North + East 26.74 | 1: 26.96, 2: 26.74, 3: 26.98 | 1: 26.96, 2: 26.74, 3: 26.98 | yes |
| 4 | North + East 26.74 | North + East 26.74 | 1: 26.96, 2: 26.74, 3: 26.98, 4: 27.60 | 1: 26.96, 2: 26.74, 3: 26.98, 4: 27.60 | yes |
| 5 | North + East 26.74 | North + East 26.74 | 1: 26.96, 2: 26.74, 3: 26.98, 4: 27.60 | 1: 26.96, 2: 26.74, 3: 26.98, 4: 27.60 | yes |
| 9 | North + East 26.74 | North + East 26.74 | 1: 26.96, 2: 26.74, 3: 26.98, 4: 27.60 | 1: 26.96, 2: 26.74, 3: 26.98, 4: 27.60 | yes |

unpricedKeys (every case): ["mystery","caviar"]

BRUTE FORCE: 16 of 16 cases agree on every field
