# Decision log

Choices made where TECH_SPEC left room (or where the product owner chose to depart from it), how
they were settled, and where they live in the code. Status:

- **Confirmed**: decided or approved by the product owner.
- **Deviation**: confirmed, and departs from the wording of TECH_SPEC or `src/models`. Re-check
  these if the spec is ever used as an acceptance test.

Code comments refer to these entries by id (for example `decision D-15`).

## Money (`src/utils/money.ts`)

| Id | Decision | Why | Status |
|---|---|---|---|
| D-01 | `roundTo`, `roundCents` and `fromCents` map NaN and ±Infinity to 0, like `toCents` (the spec only says it for `toCents`). No rounding helper ever returns NaN or `-0`. | A bad value must not poison sums or show as `$NaN`. A broken percentage therefore displays as `0.00%`. | Confirmed |
| D-02 | `fromCents` rounds a fractional cent count (`1234.5` gives `12.35`). | The result is always exact cents. | Confirmed |
| D-03 | Rounding is reliable to 15 significant digits (about $10 trillion at cent precision). | The drift-free method snaps to 15 significant digits. | Confirmed |

## List parsing (`src/utils/parseList.ts`)

| Id | Decision | Example | Status |
|---|---|---|---|
| D-04 | Fractions are rounded to 3 decimals on each line, before merging. | `1/3 kg` three times gives 0.999 kg, not 1 | Confirmed |
| D-05 | Merging in pasted text ignores the case of names and of notes (first spelling kept). The same name with a different unit is a different item. | `Milk` + `milk` + `2 milk (organic)` gives `Milk 4 each organic`; `1 kg rice` and `500 g rice` stay apart | Confirmed |
| D-06 | When a line has a quantity at the start and another at the end, the one at the start wins; the rest stays in the name or note. | `2 milk (2)` gives 2 x milk, note `2`; `2 milk x3` gives 2 x `milk x3` | Confirmed |
| D-07 | A unit needs a name after it. A unit written against the number with nothing after it stays the name. | `2 lb` gives 2 x `lb` (spec 5.2); `500g` gives 1 x `500g` | Confirmed |
| D-08 | `of` right after a unit is dropped. | `2 cans of tomatoes` gives 2 can `tomatoes` | Confirmed |
| D-09 | Unknown units stay in the name in free text (but become `each` in a CSV unit column, per spec). Unicode fractions (`½`) are not supported. | `2 cups flour` gives 2 x `cups flour` | Confirmed |
| D-10 | Editor bullets are stripped (`–`, `—`, `●`, `■`, `➤`, `✓`, `☐`...) and invisible characters (zero-width space, word joiner, soft hyphen) are removed. | `– Butter` gives `Butter` | Confirmed |
| D-15 | **Thousands separators**: a comma followed by exactly 3 digits separates thousands, in the standard grouping form (first group of 1-3 digits not starting with 0, then `,ddd` groups, optional `.decimals`). Every other comma is a decimal comma. Two cases of the literal rule are read as decimals: a leading `0` (`0,500` is half) and a first group of 4+ digits (`1234,567`). Applies to free text and CSV quantity cells. | `1,000 g` = 1000 g; `1,000,000`; `1,500.5`; `1,5` = 1.5; `1,50` = 1.5; `1,5000` = 1.5; `0,500` = 0.5 | Confirmed (replaces "a comma is always decimal") |

## CSV uploads (`parseListCsv`)

| Id | Decision | Status |
|---|---|---|
| D-11 | CSV rows are not merged (the spec only merges pasted text). | Confirmed |
| D-12 | Name cells are taken literally: no quantity, unit or bullet is read out of them. Splitting would damage names such as `12 Grain Bread`, `7 Up` or `Vitamin C - 500`, and drop `# 1 Dad Mug`. **Not to be implemented.** | Confirmed |
| D-13 | A header row is recognised when at least one cell is a known column name (ignoring case, spaces and a trailing `:` or `.`). A header without a name column uses its first unrecognised column as the name. When a field appears twice, the left-most column wins. | Confirmed |
| D-16 | The separator (`,`, `;` or tab) is detected on the first line with content, ignoring separators inside quotes and commas between two digits. Excel's `sep=` first line is honoured. Entirely empty rows are skipped. (`src/utils/csv.ts` is fixed and guesses wrongly on such files, so `parseListCsv` passes it an explicit delimiter.) | Confirmed |

## Product matching (`src/utils/matching.ts`, `server/src/services/catalogMatch.ts`)

| Id | Decision | Status |
|---|---|---|
| D-17 | `matchProduct` keeps the spec default threshold of 0.5, inclusive (a score equal to the threshold matches). | Confirmed |
| D-18 | **The API matches list items with a threshold of 0.51** (`CATALOG_MATCH_THRESHOLD`), to stop 0.5 false positives such as `almond milk` to Whole Milk, `chicken thighs` to Chicken Breast and `rice cakes` to Long Grain Rice. Cost: one-word partial names no longer match (`olive` no longer finds the olive oil). Exact names and aliases always match. | Confirmed |
| D-19 | Plurals are made singular with a small set of conservative rules plus a list of irregular words; a word that is already singular is never changed (`olive`, `cookie`, `swiss`, `hummus`). No stemming library. | Confirmed |
| D-20 | Apostrophes join words (`Jack's` gives `jacks`, then `jack`); every other punctuation mark separates words; a decimal point between digits is kept. | Confirmed |
| D-21 | Ties on score and name length compare SKUs in plain character order (`SKU-10` before `SKU-2`). The seeded SKUs are zero-padded (`GS-001`), so this order is also numeric for them. | Confirmed |
| D-22 | `rankProducts` is exported in addition to `matchProduct` (all candidates in ranked order, for "did you mean"). | Confirmed |
| D-23 | `data/products.csv` is never modified by this project; catalog fixes (such as adding Almond Milk) belong to the data owner. | Confirmed |

## Price comparison (`src/utils/comparison.ts`)

| Id | Decision | Status |
|---|---|---|
| D-24 | With an empty list every store is complete, so the **first store** is the cheapest (`cheapestStoreId` is not null). | Confirmed |
| D-14 | **Incomplete stores are not compared with the cheapest store**: their `vsCheapestStore` and `vsCheapestStorePct` are 0, as when no store is complete. Departs from the field comment in `src/models` ("total - cheapest complete store total"), which would give a negative value (a partial total looks cheaper because items are missing). `vsOptimal` is unchanged (see D-27). | Deviation |
| D-25 | A price that is not a finite number counts as "not sold" (not as $0). Only the price table's own properties are read, so ids such as `constructor` or `length` cannot pick up built-in values. | Confirmed |
| D-26 | A percentage whose base is 0 is 0 (empty basket, everything free, optimal total of 0). | Confirmed (spec: "nothing throws") |
| D-27 | `vsOptimal` and `vsOptimalPct` are computed for every store, including incomplete ones, where they can be negative (`total - optimalTotal`, as in the spec). When no store is complete, the summary savings can be negative too: the average is then taken over partial totals. Both follow the spec literally. | Open: D-14 was settled for "vs cheapest" only |
