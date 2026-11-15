### planRoute: 5 stops, round trip, driving

Home 29.2, -81.05. Input order: citypantry, harvest, budgetbasket, greenleaf, valugrocer

| # | Stop | From | Leg km | Leg min |
|---:|---|---|---:|---:|
| 1 | City Pantry Downtown | home | 3.02 | 5 |
| 2 | GreenLeaf Market Old Town | City Pantry Downtown | 2.68 | 4 |
| 3 | Harvest Foods Lakeside | GreenLeaf Market Old Town | 5.52 | 8 |
| 4 | ValuGrocer Westgate | Harvest Foods Lakeside | 6.25 | 9 |
| 5 | Budget Basket Southside | ValuGrocer Westgate | 5.10 | 8 |
| | back home | Budget Basket Southside | 4.43 | |

Total: **27.00 km**, **41 min** (returnDistanceKm 4.43)

### Brute force: all 120 orders, shortest first (top 6 and the input order)

| Rank | Order | km (unrounded) | |
|---:|---|---:|---|
| 1 | citypantry > greenleaf > harvest > valugrocer > budgetbasket | 27.004574 | <- planRoute |
| 2 | budgetbasket > valugrocer > harvest > greenleaf > citypantry | 27.004574 |  |
| 3 | harvest > greenleaf > citypantry > budgetbasket > valugrocer | 28.391703 |  |
| 4 | valugrocer > budgetbasket > citypantry > greenleaf > harvest | 28.391703 |  |
| 5 | harvest > valugrocer > budgetbasket > citypantry > greenleaf | 28.635796 |  |
| 6 | greenleaf > citypantry > budgetbasket > valugrocer > harvest | 28.635796 |  |
| 111 | citypantry > harvest > budgetbasket > greenleaf > valugrocer | 39.565253 | (input order) |

BRUTE FORCE: shortest 27.004574 km; planRoute agrees (citypantry > greenleaf > harvest > valugrocer > budgetbasket)
