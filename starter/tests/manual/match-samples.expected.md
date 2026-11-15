catalog: tests/fixtures/catalog.ts (12 products), threshold 0.5

| Typed | normalizeName | Match | Score | Other candidates (score) |
|---|---|---|---|---|
| `Eggs` | `egg` | **Large Eggs dozen** (T-003) | 1 | — |
| `dozen large eggs` | `dozen large egg` | **Large Eggs dozen** (T-003) | 1 | — |
| `EXTRA virgin olive oil` | `extra virgin olive oil` | **Extra Virgin Olive Oil 1 L** (T-004) | 1 | Green Olives (0.200) |
| `olive` | `olive` | **Green Olives** (T-005) | 0.500 | Extra Virgin Olive Oil 1 L (0.500) |
| `olives` | `olive` | **Green Olives** (T-005) | 0.500 | Extra Virgin Olive Oil 1 L (0.500) |
| `café` | `cafe` | **Ground Coffee 12 oz** (T-007) | 1 | — |
| `CAFE` | `cafe` | **Ground Coffee 12 oz** (T-007) | 1 | — |
| `tomatoes` | `tomato` | **Roma Tomatoes 1 lb** (T-008) | 1 | Cherry Tomatoes (0.500); Tomato Sauce 24 oz (0.500) |
| `tomato` | `tomato` | **Roma Tomatoes 1 lb** (T-008) | 1 | Cherry Tomatoes (0.500); Tomato Sauce 24 oz (0.500) |
| `dish soap` | `dish soap` | *none* |  | — |
| `bread` | `bread` | *none* |  | — |
| `oat milk` | `oat milk` | **Whole Milk 1 gal** (T-001) | 0.500 | Almond Milk 64 oz (0.333) |
| `chicken thighs` | `chicken thigh` | **Chicken Breast 2 lb** (T-006) | 0.500 | — |
| `Creme fraiche` | `creme fraiche` | **Crème Fraîche 8 oz** (T-011) | 1 | — |
| `cherry tomato salad` | `cherry tomato salad` | **Cherry Tomatoes** (T-009) | 0.667 | Roma Tomatoes 1 lb (0.333); Tomato Sauce 24 oz (0.250) |
| `!!!` | `` | *none* |  | — |

catalog: data/products.csv (40 products), threshold 0.5

| Typed | normalizeName | Match | Score | Other candidates (score) |
|---|---|---|---|---|
| `Milk` | `milk` | **Whole Milk 1 gal** (GS-001) | 1 | — |
| `EVOO` | `evoo` | **Extra Virgin Olive Oil 1 L** (GS-002) | 1 | — |
| `chicken breasts` | `chicken breast` | **Chicken Breast 2 lb** (GS-003) | 1 | — |
| `Nappy` | `nappy` | **Diapers 60 count** (GS-015) | 1 | — |
| `loo rolls` | `loo roll` | **Toilet Paper 12 rolls** (GS-010) | 1 | Paper Towels 6 rolls (0.333) |
| `OJ` | `oj` | **Orange Juice 52 oz** (GS-014) | 1 | — |
| `Yoghurt` | `yoghurt` | **Greek Yogurt 32 oz** (GS-022) | 1 | — |
| `Corn-flakes` | `corn flake` | **Corn Flakes Cereal 18 oz** (GS-030) | 1 | Tortilla Chips 13 oz (0.333) |
| `Tomato` | `tomato` | **Roma Tomatoes 1 lb** (GS-018) | 1 | Pasta Sauce 24 oz (0.500) |
| `juice` | `juice` | **Orange Juice 52 oz** (GS-014) | 1 | — |
| `pasta` | `pasta` | **Spaghetti 16 oz** (GS-028) | 1 | Pasta Sauce 24 oz (0.500) |
| `oat milk` | `oat milk` | **Whole Milk 1 gal** (GS-001) | 0.500 | — |
| `chicken thighs` | `chicken thigh` | **Chicken Breast 2 lb** (GS-003) | 0.500 | — |
| `almond milk` | `almond milk` | **Whole Milk 1 gal** (GS-001) | 0.500 | — |
| `dish soap` | `dish soap` | **Dish Soap 24 oz** (GS-037) | 1 | Laundry Detergent 64 oz (0.333) |
| `rice cakes` | `rice cake` | **Long Grain Rice 2 lb** (GS-027) | 0.500 | — |
| `hot sauce` | `hot sauce` | *none* |  | Pasta Sauce 24 oz (0.333) |
