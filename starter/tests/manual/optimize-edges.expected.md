
### Without a home (free travel)

| Case | Result |
|---|---|
| no stores | best null; single null; byStoreCount []; savings 0.00; unpriced ["milk","eggs"] |
| no lines | best [] 0.00; single [] 0.00; byStoreCount []; savings 0.00; unpriced [] |
| no stores and no lines | best null; single null; byStoreCount []; savings 0.00; unpriced [] |
| an item sold nowhere (product nobody sells) | best ["b","c"] 2.90; single ["b"] 3.20; byStoreCount [1, 2]; savings 0.30; unpriced ["nothing"] |
| an item sold only by a store not in the list | best ["b","c"] 2.90; single ["b"] 3.20; byStoreCount [1, 2]; savings 0.30; unpriced ["caviar"] |
| an item whose only price is NaN | best ["b","c"] 2.90; single ["b"] 3.20; byStoreCount [1, 2]; savings 0.30; unpriced ["gold"] |
| an item with no product (productId null) | best ["b","c"] 2.90; single ["b"] 3.20; byStoreCount [1, 2]; savings 0.30; unpriced ["mystery"] |
| every item unpriced | best [] 0.00; single [] 0.00; byStoreCount []; savings 0.00; unpriced ["mystery","nothing"] |
| maxStores 0 | best ["b"] 3.20; single ["b"] 3.20; byStoreCount [1]; savings 0.00; unpriced [] |
| maxStores -3 | best ["b"] 3.20; single ["b"] 3.20; byStoreCount [1]; savings 0.00; unpriced [] |
| maxStores 0.5 | best ["b"] 3.20; single ["b"] 3.20; byStoreCount [1]; savings 0.00; unpriced [] |
| maxStores -Infinity | best ["b"] 3.20; single ["b"] 3.20; byStoreCount [1]; savings 0.00; unpriced [] |
| maxStores 3 (= number of stores) | best ["b","c"] 2.90; single ["b"] 3.20; byStoreCount [1, 2]; savings 0.30; unpriced [] |
| maxStores 10 (> number of stores) | best ["b","c"] 2.90; single ["b"] 3.20; byStoreCount [1, 2]; savings 0.30; unpriced [] |
| maxStores Infinity | best ["b","c"] 2.90; single ["b"] 3.20; byStoreCount [1, 2]; savings 0.30; unpriced [] |

### With a home (0,0), 0.35 per km

| Case | Result |
|---|---|
| no stores | best null; single null; byStoreCount []; savings 0.00; unpriced ["milk","eggs"] |
| no lines | best [] 0.00 0 km; single [] 0.00 0 km; byStoreCount []; savings 0.00; unpriced [] |
| no stores and no lines | best null; single null; byStoreCount []; savings 0.00; unpriced [] |
| an item sold nowhere (product nobody sells) | best ["a","b"] 4.56 4.45 km; single ["b"] 4.76 4.45 km; byStoreCount [1, 2]; savings 0.20; unpriced ["nothing"] |
| an item sold only by a store not in the list | best ["a","b"] 4.56 4.45 km; single ["b"] 4.76 4.45 km; byStoreCount [1, 2]; savings 0.20; unpriced ["caviar"] |
| an item whose only price is NaN | best ["a","b"] 4.56 4.45 km; single ["b"] 4.76 4.45 km; byStoreCount [1, 2]; savings 0.20; unpriced ["gold"] |
| an item with no product (productId null) | best ["a","b"] 4.56 4.45 km; single ["b"] 4.76 4.45 km; byStoreCount [1, 2]; savings 0.20; unpriced ["mystery"] |
| every item unpriced | best [] 0.00 0 km; single [] 0.00 0 km; byStoreCount []; savings 0.00; unpriced ["mystery","nothing"] |
| maxStores 0 | best ["b"] 4.76 4.45 km; single ["b"] 4.76 4.45 km; byStoreCount [1]; savings 0.00; unpriced [] |
| maxStores -3 | best ["b"] 4.76 4.45 km; single ["b"] 4.76 4.45 km; byStoreCount [1]; savings 0.00; unpriced [] |
| maxStores 0.5 | best ["b"] 4.76 4.45 km; single ["b"] 4.76 4.45 km; byStoreCount [1]; savings 0.00; unpriced [] |
| maxStores -Infinity | best ["b"] 4.76 4.45 km; single ["b"] 4.76 4.45 km; byStoreCount [1]; savings 0.00; unpriced [] |
| maxStores 3 (= number of stores) | best ["a","b"] 4.56 4.45 km; single ["b"] 4.76 4.45 km; byStoreCount [1, 2]; savings 0.20; unpriced [] |
| maxStores 10 (> number of stores) | best ["a","b"] 4.56 4.45 km; single ["b"] 4.76 4.45 km; byStoreCount [1, 2]; savings 0.20; unpriced [] |
| maxStores Infinity | best ["a","b"] 4.56 4.45 km; single ["b"] 4.76 4.45 km; byStoreCount [1, 2]; savings 0.20; unpriced [] |

EDGE CASES: 30 ran, 0 threw
