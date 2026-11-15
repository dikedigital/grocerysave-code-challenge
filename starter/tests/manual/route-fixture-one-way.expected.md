### planRoute: 5 stops, one way, driving

Home 29.2, -81.05. Input order: citypantry, harvest, budgetbasket, greenleaf, valugrocer

| # | Stop | From | Leg km | Leg min |
|---:|---|---|---:|---:|
| 1 | City Pantry Downtown | home | 3.02 | 5 |
| 2 | GreenLeaf Market Old Town | City Pantry Downtown | 2.68 | 4 |
| 3 | Harvest Foods Lakeside | GreenLeaf Market Old Town | 5.52 | 8 |
| 4 | ValuGrocer Westgate | Harvest Foods Lakeside | 6.25 | 9 |
| 5 | Budget Basket Southside | ValuGrocer Westgate | 5.10 | 8 |

Total: **22.58 km**, **34 min** (returnDistanceKm 0)

### Brute force: all 120 orders, shortest first (top 6 and the input order)

| Rank | Order | km (unrounded) | |
|---:|---|---:|---|
| 1 | citypantry > greenleaf > harvest > valugrocer > budgetbasket | 22.578920 | <- planRoute |
| 2 | valugrocer > budgetbasket > citypantry > greenleaf > harvest | 23.084428 |  |
| 3 | greenleaf > citypantry > budgetbasket > valugrocer > harvest | 23.328522 |  |
| 4 | budgetbasket > valugrocer > harvest > greenleaf > citypantry | 23.982938 |  |
| 5 | harvest > greenleaf > citypantry > budgetbasket > valugrocer | 24.067920 |  |
| 6 | valugrocer > harvest > greenleaf > citypantry > budgetbasket | 24.231524 |  |
| 111 | citypantry > harvest > budgetbasket > greenleaf > valugrocer | 35.241470 | (input order) |

BRUTE FORCE: shortest 22.578920 km; planRoute agrees (citypantry > greenleaf > harvest > valugrocer > budgetbasket)
