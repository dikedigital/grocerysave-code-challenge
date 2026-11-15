### Golden basket with travel: home 29.2, -81.05; 0.35 per km; maxStores 3; driving

Best plan for each number of stores (`byStoreCount`); stores in route order:

| Stores | Route from home and back | Items total | Distance km | Travel cost | Grand total | Minutes |
|---:|---|---:|---:|---:|---:|---:|
| 1 | FreshMart | 135.51 | 4.33 | 1.52 | **137.03** | 6 |
| 2 | FreshMart → GreenLeaf Market | 126.20 | 7.82 | 2.74 | **128.94** | 12 |
| 3 | City Pantry → GreenLeaf Market → Corner Co-op | 119.97 | 11.22 | 3.93 | **123.90** ← bestPlan | 17 |

**Winner (bestPlan)**: City Pantry → GreenLeaf Market → Corner Co-op, grand total 123.90 (items 119.97 + travel 3.93 for 11.22 km).

Why, against each other plan (every plan buys all 16 items, so the grand total decides):

- 1 store(s): items +15.54, travel -2.41, grand total 137.03 (13.13 more than the winner)
- 2 store(s): items +6.23, travel -1.19, grand total 128.94 (5.04 more than the winner)

The free-travel winners, with the cost of reaching them from this home:

| Stores | Stores (free-travel winner) | Items total | Distance km | Travel cost | Grand total |
|---:|---|---:|---:|---:|---:|
| 1 | Sunrise Market | 134.61 | 8.26 | 2.89 | 137.50 |
| 2 | GreenLeaf Market → Sunrise Market | 124.70 | 13.08 | 4.58 | 129.28 |
| 3 | GreenLeaf Market → City Pantry → Sunrise Market | 119.36 | 13.08 | 4.58 | 123.94 |

cheapestSingleStore: FreshMart 137.03 (items 135.51 + travel 1.52); savingsVsSingleStore 13.13; unpricedKeys []
  leg to City Pantry Downtown: 3.02 km, 5 min
  leg to GreenLeaf Market Old Town: 2.68 km, 4 min
  leg to Corner Co-op Mill Lane: 3.60 km, 5 min
  back home: 1.91 km; total 11.22 km, 17 min
