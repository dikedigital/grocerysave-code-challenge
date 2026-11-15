### planRoute: 8 stops, round trip, driving

Home 29.2, -81.05. Input order: freshmart, valugrocer, greenleaf, harvest, citypantry, budgetbasket, cornercoop, sunrise

| # | Stop | From | Leg km | Leg min |
|---:|---|---|---:|---:|
| 1 | FreshMart Beacon Street | home | 2.17 | 3 |
| 2 | GreenLeaf Market Old Town | FreshMart Beacon Street | 1.82 | 3 |
| 3 | City Pantry Downtown | GreenLeaf Market Old Town | 2.68 | 4 |
| 4 | Sunrise Market Harbor View | City Pantry Downtown | 2.42 | 4 |
| 5 | Budget Basket Southside | Sunrise Market Harbor View | 4.07 | 6 |
| 6 | ValuGrocer Westgate | Budget Basket Southside | 5.10 | 8 |
| 7 | Harvest Foods Lakeside | ValuGrocer Westgate | 6.25 | 9 |
| 8 | Corner Co-op Mill Lane | Harvest Foods Lakeside | 3.40 | 5 |
| | back home | Corner Co-op Mill Lane | 1.91 | |

Total: **29.82 km**, **45 min** (returnDistanceKm 1.91)

### Brute force: all 40320 orders, shortest first (top 6 and the input order)

| Rank | Order | km (unrounded) | |
|---:|---|---:|---|
| 1 | freshmart > greenleaf > citypantry > sunrise > budgetbasket > valugrocer > harvest > cornercoop | 29.822961 | <- planRoute |
| 2 | cornercoop > harvest > valugrocer > budgetbasket > sunrise > citypantry > greenleaf > freshmart | 29.822961 |  |
| 3 | valugrocer > budgetbasket > sunrise > citypantry > freshmart > greenleaf > harvest > cornercoop | 30.149304 |  |
| 4 | cornercoop > harvest > greenleaf > freshmart > citypantry > sunrise > budgetbasket > valugrocer | 30.149304 |  |
| 5 | greenleaf > freshmart > citypantry > sunrise > budgetbasket > valugrocer > harvest > cornercoop | 30.393397 |  |
| 6 | cornercoop > harvest > valugrocer > budgetbasket > sunrise > citypantry > freshmart > greenleaf | 30.393397 |  |
| 38525 | freshmart > valugrocer > greenleaf > harvest > citypantry > budgetbasket > cornercoop > sunrise | 50.884356 | (input order) |

BRUTE FORCE: shortest 29.822961 km; planRoute agrees (freshmart > greenleaf > citypantry > sunrise > budgetbasket > valugrocer > harvest > cornercoop)
