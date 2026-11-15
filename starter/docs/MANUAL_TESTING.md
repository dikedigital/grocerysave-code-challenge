# Manual testing guide

How to check by hand what has been implemented so far. The guide grows with each stage; each
section says what it covers and what is not testable yet.

| Stage | Module | Status | Section |
|---|---|---|---|
| 1 | `src/utils/money.ts` | done | [M1](#m1-money-srcutilsmoneyts) |
| 1 | `src/utils/parseList.ts`: `normalizeUnit`, `parseQuantity`, `parseListLine` | done | [M2](#m2-line-parsing-srcutilsparselistts) |
| 1 | `src/utils/parseList.ts`: `parseListText` (pasted text, merging) | done | [M3](#m3-pasted-text-parselisttext) |
| 1 | `src/utils/parseList.ts`: `parseListCsv` (uploaded CSV) | done | [M4](#m4-csv-upload-parselistcsv) |
| 1 | `src/utils/matching.ts`: `normalizeName`, `matchProduct` | done | [M5](#m5-product-matching-srcutilsmatchingts) |
| 1 | `src/utils/comparison.ts`: `compareBasket`, happy path (every store sells every item) | done | [M6](#m6-price-comparison-comparebasket-happy-path) |
| 1 | `src/utils/comparison.ts`: `compareBasket` edge cases, `filterStores` | done | [M7](#m7-price-comparison-edge-cases-and-filterstores) |
| 1 | `server/src/services/catalogMatch.ts`: API match threshold 0.51 | done | [M5.3](#m53-the-api-threshold-051) |
| 2 | `src/utils/route.ts`: `haversineKm`, exact `planRoute` (up to 8 stops) | done | [M8](#m8-routing-srcutilsroutets-haversinekm-and-exact-planroute) |
| 2 | `src/utils/route.ts`: `planRoute` beyond 8 stops (nearest neighbour + 2-opt), modes, ties | done | [M9](#m9-routing-beyond-8-stops-nearest-neighbour--2-opt) |
| 3 | `src/utils/deals.ts`: `detectDeals` | done | [M10](#m10-deals-srcutilsdealsts-detectdeals) |
| 4 | `src/utils/optimizer.ts`: `optimizePurchase`, free travel (no home) | done | [M11](#m11-purchase-optimisation-srcutilsoptimizerts-free-travel) |
| 4 | `src/utils/optimizer.ts`: with a home location (travel cost, routes), ranking | done | [M12](#m12-purchase-optimisation-with-travel-and-the-ranking) |
| 4 | `src/utils/optimizer.ts`: timing, caller edge cases, brute-force cross-check | done | [M13](#m13-optimizer-timing-edge-cases-and-brute-force-cross-check) |

**UI: nothing is testable in the browser yet** (checked at stage 3). Every page that uses the logic
built so far (`/lists/:id` with the bulk add form, `/compare`, `/plan`, `/deals`) is behind login,
login needs the API (`POST /api/auth/login`), and the Express app (`server/src/app.ts`, `index.ts`)
does not exist yet. Several components those pages render are still stubs (`DealsList`, `RouteMap`,
...). Without the API only the home page and empty login/register forms render. The first UI checks
will be possible once the API has auth and lists.

Run every command from the repository root. Design choices referred to as `D-nn` are explained in
[`docs/DECISIONS.md`](DECISIONS.md).

## 0. Setup

### 0.1 Dependencies

There is no internet access, so `node_modules` comes from the provided archive
(`node_modules-linux-x64.tar.zip`, or the arm64 one on an ARM machine). When it was unpacked here,
the archive had turned the symlinks in `node_modules/.bin` into small text files holding the link
target, and had dropped the executable bits. The symptom is `sh: 1: jest: Permission denied`, or
`npm run typecheck` silently using a global `tsc` instead of the project's 5.6.3. If you unpack it
again, repair it with:

```bash
find node_modules -type d -name .bin | while read -r dir; do
  for f in "$dir"/*; do
    [ -L "$f" ] && continue
    target=$(head -c 300 "$f")
    ( cd "$dir" && [ -e "$target" ] && rm "$(basename "$f")" && ln -s "$target" "$(basename "$f")" \
      && chmod +x "$(readlink -f "$(basename "$f")")" )
  done
done
find node_modules -type f -path '*/bin/esbuild' -exec chmod +x {} \;
```

This was needed again at the start of stage 2 (the unpacked tree had the same problem).

Check: `npx tsc --version` prints `Version 5.6.3`, `npx jest --version` prints `29.7.0`, and
`npx eslint --version` prints `v9.12.0`.

### 0.2 Saving test logs

`tests/run-logged.sh <label> <command...>` runs a command, shows its output and saves it to
`logs/tests/<UTC timestamp>-<label>.log`, with a header (command, commit, number of uncommitted
paths, Node version) and a footer (exit code). The command's exit code is preserved. `logs/` is
git-ignored.

The archive also dropped the script's executable bit (`tests/run-logged.sh: Permission denied`),
so call it through `bash`, as every command in this guide does:

```bash
bash tests/run-logged.sh unit npm run test:unit
```

### 0.3 Tools for manual checks

| Tool | Use |
|---|---|
| `npx tsx tests/manual/try.ts "<expr>" ...` | Evaluates each expression with every export of `src/utils` in scope and prints the result as JSON (`-0`, `NaN` and `Infinity` are shown as such). Run it with no arguments to list the functions in scope. Functions not implemented yet print `!! not implemented`. |
| `npx tsx tests/manual/parse-line.ts "<line>" ...` | Prints a markdown table of what each line parses to. Reads stdin when no line is given; `--json` prints raw objects instead. |
| `npx tsx tests/manual/match.ts "<typed name>" ...` | For each typed name: its `normalizeName` form, the product `matchProduct` picks, and every other product sharing a word with it, with scores. Defaults to the test catalog `tests/fixtures/catalog.ts`; `--catalog data/products.csv` uses the seeded one, and `--threshold n` changes the threshold. |
| `npx tsx tests/manual/compare-golden.ts` | Runs `compareBasket` on the golden basket (16 products at 8 chains, from `tests/fixtures/spreadsheet.ts`), prints the matrix laid out like the reference spreadsheet, and checks every number of `GOLDEN_EXPECTED`. Exits 1 on a mismatch. |
| `npx tsx tests/manual/compare-edge.ts [scenario]` | Runs `compareBasket` on the edge-case scenarios of `tests/fixtures/comparisonScenarios.ts` and prints rows, store totals and summary as returned (unrounded). |
| `npx tsx tests/manual/route-fixture.ts [--one-way] [--walking] [--all8]` | Runs `planRoute` on the 5-stop fixture of `tests/fixtures/route.ts` (or all 8 stores with `--all8`), prints the route leg by leg, then ranks every possible visiting order by brute force and marks the planner's choice and the input order. Exits 1 if the planner's route is not the shortest. |
| `npx tsx tests/manual/route-heuristic.ts [--one-way]` | Runs `planRoute` on the 12-stop fixture (8 real + 4 fictional stores), prints the route with driving and walking minutes side by side, checks that it is a valid permutation, no longer than plain nearest neighbour, has no helpful 2-opt reversal left, and compares it with the true optimum (Held-Karp); then prints the empty-input case. Exits 1 if a check fails. |
| `npx tsx tests/manual/route-checklist.ts` | Prints OK/FAIL with evidence for each `planRoute` acceptance point (return leg, one way 0, durations, tie rule, permutation, empty input, rounding), for the exact search and the heuristic. Exits 1 if a check fails. |
| `npx tsx tests/manual/deals-cases.ts [scenario]` | Runs `detectDeals` on the scenarios of `tests/fixtures/dealScenarios.ts` (threshold exactly met, just missed, single snapshot, three snapshots, same date, mixed sort) and prints the input points, the deals found and whether they equal the hand-worked result. Exits 1 on a mismatch. |
| `npx tsx tests/manual/optimize-golden.ts [maxStores...]` | Runs `optimizePurchase` on the golden basket with free travel; prints the best plan for each `maxStores` (default 1, 2, 3, 8): stores, what each buys, items and grand total; the best plan for each exact store count; and checks the acceptance numbers 134.61 / 115.56. Exits 1 on a mismatch. |
| `npx tsx tests/manual/optimize-travel.ts [--home lat,lng] [--rate r] [--max n] [--walking]` | Golden basket at the real store locations with travel (default home 29.2,-81.05, 0.35 per km, maxStores 3): the best plan per number of stores with items, distance, travel cost and grand total, the winner and why, and the free-travel winners costed with travel. |
| `npx tsx tests/manual/optimize-ranking.ts` | Small scenarios listing every candidate plan in ranking order, with the reason each one ranks below the one above; checks `bestPlan` and `cheapestSingleStore`. Exits 1 on a mismatch. |
| `npx tsx tests/manual/optimize-timing.ts` | Times `optimizePurchase` for 8 stores, 16 lines, maxStores 8 and a home (golden basket, and a worst case where all 255 subsets need their own route): first call, then min / median / max of 50 calls. Exits 1 over 2 s. |
| `npx tsx tests/manual/optimize-edges.ts` | Runs the caller edge cases (no stores, no lines, unpriced items, maxStores below 1 or above the store count) without and with a home, prints each result. Exits 1 if any throws. |
| `npx tsx tests/manual/optimize-bruteforce.ts` | `optimizePurchase` next to an independent brute force on a small instance (5 stores, 8 items) for maxStores -2..9, without and with a home; says whether every field agrees. Exits 1 on a disagreement. |
| `npx tsx tests/manual/parse-list.ts <file>...` | Parses whole files: `.txt` with `parseListText`, `.csv`/`.tsv` with `parseListCsv`; one table per file. `--text` or `--csv` reads stdin instead (for example `pbpaste \| npx tsx tests/manual/parse-list.ts --text`). |

## 1. Automated checks (run these first)

```bash
bash tests/run-logged.sh typecheck npm run typecheck
bash tests/run-logged.sh lint      npm run lint
bash tests/run-logged.sh unit      npm run test:unit
```

Expected as of M13 (stage 4): typecheck and lint exit 0 with no output;
`test:unit` passes **8 suites, 776 tests** (`money.test.ts` 59, `parseList.test.ts` 259,
`matching.test.ts` 102, `comparison.test.ts` 110, `route.test.ts` 68, `deals.test.ts` 47,
`optimizer.test.ts` 116,
`server/src/services/__tests__/catalogMatch.test.ts` 15). The whole run takes about 20 s.

## M1. Money (`src/utils/money.ts`)

Spec: TECH_SPEC section 5.1. Money is computed in integer cents; rounding is half away from zero,
with no binary drift.

Run this, then compare each line with the *Expected* column:

```bash
npx tsx tests/manual/try.ts \
  "roundCents(1.005)" "roundCents(2.675)" "roundCents(-1.005)" "roundTo(2.675)" "toCents(-2.675)" \
  "0.1 + 0.2" "sumMoney([0.1, 0.2])" "sumMoney(Array(10).fill(0.1))" \
  "toCents(NaN)" "roundCents(Infinity)" "sumMoney([1.5, NaN, 2.25])" \
  "roundCents(-0.004)" "toCents(-0)" "formatMoney(-0.004)" "formatPct(-0.001)" \
  "formatMoney(1234.5)" "formatMoney(-1)" "formatMoney(-1.005)" "formatMoney(NaN)" "formatMoney(5, 'EUR')" \
  "formatPct(19.801516)" "formatPct(1234.5)" "formatPct(-2.675)" "formatPct(33.333, 1)" "formatPct(2.5, 0)"
```

| # | Expression | Expected | What it proves |
|---|---|---|---|
| 1 | `roundCents(1.005)` | `1.01` | half cent rounds up, although 1.005 is stored as 1.00499999... |
| 2 | `roundCents(2.675)` | `2.68` | same (`(2.675).toFixed(2)` gives 2.67) |
| 3 | `roundCents(-1.005)` | `-1.01` | half away from zero for negatives (not towards +infinity) |
| 4 | `roundTo(2.675)` | `2.68` | the generic rounder defaults to 2 digits |
| 5 | `toCents(-2.675)` | `-268` | integer cents |
| 6 | `0.1 + 0.2` | `0.30000000000000004` | the float problem being avoided |
| 7 | `sumMoney([0.1, 0.2])` | `0.3` | exact sum in cents |
| 8 | `sumMoney(Array(10).fill(0.1))` | `1` | no drift over many additions |
| 9 | `toCents(NaN)` | `0` | non-finite input is 0 |
| 10 | `roundCents(Infinity)` | `0` | same |
| 11 | `sumMoney([1.5, NaN, 2.25])` | `3.75` | a bad value cannot poison a sum |
| 12 | `roundCents(-0.004)` | `0` | never `-0` |
| 13 | `toCents(-0)` | `0` | never `-0` |
| 14 | `formatMoney(-0.004)` | `"$0.00"` | never `"-$0.00"` |
| 15 | `formatPct(-0.001)` | `"0.00%"` | never `"-0.00%"` |
| 16 | `formatMoney(1234.5)` | `"$1,234.50"` | thousands separator, two decimals |
| 17 | `formatMoney(-1)` | `"-$1.00"` | minus before the symbol |
| 18 | `formatMoney(-1.005)` | `"-$1.01"` | formatting uses the same rounding |
| 19 | `formatMoney(NaN)` | `"$0.00"` | |
| 20 | `formatMoney(5, 'EUR')` | `"€5.00"` | currency argument |
| 21 | `formatPct(19.801516)` | `"19.80%"` | two decimals, padded |
| 22 | `formatPct(1234.5)` | `"1234.50%"` | **no** thousands separator in percentages |
| 23 | `formatPct(-2.675)` | `"-2.68%"` | drift-free, half away from zero |
| 24 | `formatPct(33.333, 1)` | `"33.3%"` | digits argument |
| 25 | `formatPct(2.5, 0)` | `"3%"` | |

Try your own values too. Any amount written with three decimals ending in 5 should round away from
zero.

**Decisions to be aware of** (not fixed by the spec):
- `roundTo`, `roundCents` and `fromCents` also map `NaN`/`Infinity` to 0 (the spec says so only for
  `toCents`).
- `fromCents` rounds a fractional cent count: `fromCents(1234.5)` is `12.35`.
- Values are reliable up to 15 significant digits (about $10 trillion at cent precision).

Not testable in the UI yet: the comparison pages that show money need the API.

## M2. Line parsing (`src/utils/parseList.ts`)

Spec: the doc comments in `src/utils/parseList.ts` and TECH_SPEC section 5.2. Covers
`normalizeUnit`, `parseQuantity` and `parseListLine`.

### M2.1 Regression check against the reviewed table

`tests/manual/parse-line-samples.txt` holds 49 sample lines, one per case, including a blank line.
`tests/manual/parse-line-samples.expected.md` is their reviewed output (also below). Regenerate the
table and diff it:

```bash
npx tsx tests/manual/parse-line.ts < tests/manual/parse-line-samples.txt \
  | diff tests/manual/parse-line-samples.expected.md - && echo "M2.1 OK: no differences"
```

Expected: `M2.1 OK: no differences`. A difference means the parser's behaviour changed. If the
change was intended, review the new table and update the `.expected.md` file.

| # | Input | name | quantity | unit | note | Shape |
|---|---|---|---|---|---|---|
| 1 | `milk` | milk | 1 | each | | plain name, defaults |
| 2 | `␠␠Greek␠␠␠Yogurt␠␠` | Greek Yogurt | 1 | each | | trimmed, inner spaces collapsed, casing kept |
| 3 | `2 milk` | milk | 2 | each | | leading quantity |
| 4 | `2x milk` | milk | 2 | each | | leading multiplier |
| 5 | `2 x milk` | milk | 2 | each | | |
| 6 | `2 × milk` | milk | 2 | each | | multiplication sign |
| 7 | `milk x2` | milk | 2 | each | | trailing multiplier |
| 8 | `milk x 2` | milk | 2 | each | | |
| 9 | `milk (2)` | milk | 2 | each | | bracketed quantity |
| 10 | `milk, 2` | milk | 2 | each | | trailing after a comma |
| 11 | `milk - 2` | milk | 2 | each | | trailing after a dash |
| 12 | `2 lbs chicken breast` | chicken breast | 2 | lb | | quantity + unit + name |
| 13 | `2 Lbs. Chicken Breast` | Chicken Breast | 2 | lb | | unit case and trailing dot |
| 14 | `1.5 kg rice` | rice | 1.5 | kg | | decimal point |
| 15 | `1,5 kg rice` | rice | 1.5 | kg | | decimal comma |
| 16 | `500g flour` | flour | 500 | g | | unit written against the number |
| 17 | `1/2 lb butter` | butter | 0.5 | lb | | fraction |
| 18 | `1 1/2 lb butter` | butter | 1.5 | lb | | mixed number |
| 19 | `1/3 kg cheese` | cheese | 0.333 | kg | | 3-decimal rounding |
| 20 | `- eggs` | eggs | 1 | each | | bullet |
| 21 | `* eggs` | eggs | 1 | each | | bullet |
| 22 | `1. eggs` | eggs | 1 | each | | numbered bullet (not a quantity) |
| 23 | `[ ] eggs` | eggs | 1 | each | | checkbox |
| 24 | `[x] eggs` | eggs | 1 | each | | ticked checkbox |
| 25 | `- [ ] 12 eggs` | eggs | 12 | each | | bullet + checkbox + quantity |
| 26 | `bread (whole wheat, sliced)` | bread | 1 | each | whole wheat, sliced | note in brackets |
| 27 | `2 lbs chicken breast (boneless)` | chicken breast | 2 | lb | boneless | quantity + unit + note |
| 28 | `milk (organic) x2` | milk | 2 | each | organic | note before a trailing quantity |
| 29 | `rice, 1,5 kg` | rice | 1.5 | kg | | trailing amount with unit and decimal comma |
| 30 | `salt, pepper, 2` | salt, pepper | 2 | each | | only the last comma separates |
| 31 | `2 cans of tomatoes` | tomatoes | 2 | can | | "of" after a unit dropped |
| 32 | `2 dozen eggs` | eggs | 2 | dozen | | |
| 33 | `3 bunch bananas` | bananas | 3 | bunch | | |
| 34 | `2 lb` | lb | 2 | each | | spec 5.2: a unit needs a name after it |
| 35 | `500g` | 500g | 1 | each | | glued form, no name after: kept as the name |
| 36 | *(empty line)* | *null* | | | | blank line |
| 37 | `# weekly shop` | *null* | | | | comment |
| 38 | `7up` | 7up | 1 | each | | digits glued to a non-unit stay in the name |
| 39 | `0 milk` | 0 milk | 1 | each | | a non-positive number stays in the name |
| 40 | `T-2 batteries` | T-2 batteries | 1 | each | | dash without spaces is not a separator |
| 41 | `milk (1.5 l)` | milk | 1.5 | l | | bracketed quantity with a unit |
| 42 | `– Butter` | Butter | 1 | each | | en dash bullet (Word/Notes autocorrect of `- `); fixed in M3 |
| 43 | `— Apples x3` | Apples | 3 | each | | em dash bullet + trailing quantity |
| 44 | `● Bananas` | Bananas | 1 | each | | symbol bullet |
| 45 | `✓ Rice` | Rice | 1 | each | | tick as a checkbox |
| 46 | `Milk` + zero-width space | Milk | 1 | each | | invisible characters removed; fixed in M3 |
| 47 | `1,000 g sugar` | sugar | 1000 | g | | thousands separator (D-15) |
| 48 | `0,500 kg flour` | flour | 0.5 | kg | | a leading 0 is a decimal comma (D-15) |
| 49 | `1,5000 g sugar` | sugar | 1.5 | g | | not 3 digits after the comma: decimal (D-15) |

### M2.2 Exploratory checks

Try your own lines:

```bash
npx tsx tests/manual/parse-line.ts "3 Kilos of potatoes" "eggs x 12 (free range)" "1. [x] 2 pk soda"
npx tsx tests/manual/try.ts "normalizeUnit('Litres')" "normalizeUnit('cup')" "parseQuantity('1 1/2')" "parseQuantity('0')"
```

Expected: `potatoes 3 kg`; `eggs 12 each`, note `free range`; `soda 2 pack`; then `"l"`, `null`,
`1.5`, `null`.

Things worth probing, with the current behaviour:

| Input | Result | Why |
|---|---|---|
| `2 milk (2)` | milk, 2, note `2` | a leading quantity wins; the bracket becomes the note |
| `2 milk x3` | `milk x3`, 2 | same: only one quantity per line |
| `milk (2 cups)` | milk, 1, note `2 cups` | `cup` is not a unit, so the bracket is a note |
| `2 cups flour` | `cups flour`, 2, each | unknown units stay in the name |
| `milk, 2 cups` | `milk, 2 cups`, 1 | a trailing amount must be fully understood, or it stays in the name |
| `1,000 g sugar` | sugar, 1000, g | a comma followed by exactly 3 digits separates thousands (D-15) |
| `1,5 kg rice` / `1,50 kg rice` | rice, 1.5, kg | any other comma is a decimal comma |
| `0,500 kg flour` | flour, 0.5, kg | a leading 0 never starts a thousands number: decimal comma (D-15) |
| `½ lb butter` | `½ lb butter`, 1 | Unicode fraction characters are not supported |
| `size #2 nails` | `size #2 nails` | only a `#` at the start makes a comment |
| `1.eggs` | `1.eggs` | a numbered bullet needs a space after the dot |

Units accepted by `normalizeUnit` (case-insensitive, trailing dot ignored):

| Unit | Spellings |
|---|---|
| each | each, ea, pc, pcs, piece, pieces, unit, units |
| lb | lb, lbs, pound, pounds |
| oz | oz, ozs, ounce, ounces |
| kg | kg, kgs, kilo, kilos, kilogram(s), kilogramme(s) |
| g | g, gr, grs, gram(s), gramme(s) |
| l | l, lt, ltr, ltrs, liter(s), litre(s) |
| ml | ml, mls, milliliter(s), millilitre(s) |
| gal | gal, gals, gallon(s) |
| pack | pack(s), pk, pkt(s), pkg(s), packet(s), package(s) |
| dozen | dozen(s), doz, dz |
| can | can(s), tin(s) |
| bottle | bottle(s), btl(s) |
| box | box, boxes |
| bag | bag(s) |
| bunch | bunch, bunches |

Not testable in the UI yet: see M3.

## M3. Pasted text (`parseListText`)

Spec: TECH_SPEC section 5.2 (merging) and the doc comment of `parseListText`. Each line goes through
`parseListLine`. Lines with the same name (ignoring case) **and** the same unit are merged: the
first spelling and position are kept, quantities are added (3 decimals), and differing notes are
joined with `; `.

### M3.1 The merge example

```bash
printf 'Milk\nmilk\n2 milk (organic)\n' | npx tsx tests/manual/parse-list.ts --text
```

Expected: **1 item**, `Milk | 4 | each | organic`. The first spelling is kept, the quantity is
1 + 1 + 2, and the only note is carried over.

### M3.2 / M4.1 Regression check against the reviewed sample files

`tests/manual/samples/` holds one pasted list per `.txt` file and one spreadsheet export per
`.csv`/`.tsv` file. `tests/manual/parse-list-samples.expected.md` is their reviewed output.

```bash
npx tsx tests/manual/parse-list.ts tests/manual/samples/* \
  | diff tests/manual/parse-list-samples.expected.md - && echo "M3.2/M4.1 OK: no differences"
```

Expected: `M3.2/M4.1 OK: no differences`.

| File | What it exercises | Expected highlights |
|---|---|---|
| `01-merge-requested.txt` | the M3.1 example | 1 item: Milk, 4, each, organic |
| `02-notes-app.txt` | bullets from notes apps, case-insensitive merges, notes, units | 10 items. **Milk 4** (☐ Milk + MILK x2 + Milk with an invisible character), note `cold`. **eggs 14** (☑ 12 eggs + 1 + 1); note `free range` appears once, although the two lines differ in case. **rice 3 kg** (`1 kg rice` + `Rice, 2 kg`) and, separately, **rice 500 g**: the unit differs. **sugar 0.999 kg** (see below). |
| `03-client-template.csv` | the file behind *Download template* | 4 items, as in the template |
| `04-header-variants.csv` | header `Aisle,Qty.,Product,Price,Notes`: reordered, extra columns, `Qty.` | Milk 2 (note `cold, please`); Bread 1 (empty qty); Chicken 2 **lb** (unit taken from `2 lb`); Sugar 2 **each** (`cups` is unknown) |
| `05-semicolon-no-header.csv` | `;` separator, no header, decimal comma, an unquoted comma in a name | `Rice, basmati 1.5 kg`, `Milk 1 l semi-skimmed`, `Eggs 12` |
| `06-quoted-and-invalid.csv` | quoted commas, `""` escapes, a newline inside a note, invalid values, rows without a name | 3 items: `Cheese, cheddar 1 lb "aged "extra" sharp"`; Bread 1 each `line one line two` (`abc` becomes 1, `loaf` becomes each); Yogurt 1 each (`0` becomes 1, `Tubs` becomes each) |
| `07-excel-export.csv` | BOM, CRLF, Excel's `sep=;` line, an empty `;;` row, a trailing blank line | Flour 1.5 kg (`1 1/2`, `Kilos`), Butter 0.5 lb |
| `08-copied-from-sheet.tsv` | tab-separated | Milk 2 l, Rice 1.5 kg |

### M3.3 Exploratory checks (text)

```bash
printf 'eggs\nMILK\nEggs\nmilk\nBread\n' | npx tsx tests/manual/parse-list.ts --text
printf 'milk (organic)\nmilk\nmilk (2%%)\nmilk (Organic)\n' | npx tsx tests/manual/parse-list.ts --text
printf '0.1 kg salt\n0.2 kg salt\n' | npx tsx tests/manual/parse-list.ts --text
printf 'milk\r\neggs\rbread\n' | npx tsx tests/manual/parse-list.ts --text
```

Expected:
1. `eggs 2`, `MILK 2`, `Bread 1`, in that order (first spelling, first position).
2. One item: `milk 4`, note `organic; 2%`.
3. `salt 0.3 kg`, not `0.30000000000000004`.
4. Three items; all three line endings work.

**Decisions to be aware of:**
- Each line is rounded to 3 decimals before merging, so `1/3 kg` three times gives **0.999 kg**,
  not 1. This follows from spec 5.2 (fractions are rounded per line).
- Notes are compared ignoring case when deciding whether a note is new (`organic` and `Organic`
  are kept once, with the first spelling).
- The same name with a different unit is a different item (`1 kg rice` and `500 g rice`).

**Bugs found and fixed in the line parser while testing M3** (now rows 42-46 of the M2 table):
- Editor bullets were kept in the name: `– `, `— ` (Word and Apple Notes autocorrect `- ` into
  these), `●`, `○`, `■`, `➤`, `✓`, `✔`.
- Invisible characters from copied web text (zero-width space, word joiner, soft hyphen) stopped
  `Milk` and `milk` from merging, although they look identical.

Not testable in the UI yet: the *Bulk add* form calls these parsers for its preview, but the preview
component (`ImportPreview`) and `formatQuantity` are still stubs, and the list page needs the API.

## M4. CSV upload (`parseListCsv`)

Spec: the doc comment of `parseListCsv` and TECH_SPEC section 5.2.

Rules:
- **Header**: the first non-empty row is a header when at least one cell is a known column name:
  `name|item|product`, `quantity|qty|amount`, `unit`, `note|notes`. Names ignore case and surrounding
  spaces, plus a trailing `:` or `.` (`Qty.`). Columns can be in any order, and unknown columns are
  ignored. When a field appears twice, the left-most column wins. A header without a name column
  (`Description,Qty`) uses its first unknown column as the name.
- **No header**: columns by position: name, quantity, unit, note.
- **Separator**: `,`, `;` or a tab, detected on the first line with content. Separators inside
  quotes and commas between two digits (decimal commas) are not counted. Excel's `sep=;` first
  line is honoured.
- **Cells**: whitespace and newlines collapse to one space. A missing, invalid or non-positive
  quantity becomes 1. When the unit column is empty, the quantity cell may carry the unit (`2 lb`,
  `500g`). Unknown units become `each`. Rows without a name, and entirely empty rows, are skipped.
- CSV rows are **not** merged, and name cells are taken literally (no bullet or quantity parsing).

### M4.1 Regression check

Covered by the sample-file diff in M3.2 (files `03`-`08`).

### M4.2 Exploratory checks

Write your own CSV in a spreadsheet, export it, and run
`npx tsx tests/manual/parse-list.ts your-file.csv`. Or try these:

```bash
printf 'Product;Amount\nRice;1,5\n' | npx tsx tests/manual/parse-list.ts --csv
printf 'Milk;1,5\n' | npx tsx tests/manual/parse-list.ts --csv
printf '\n\nname;qty\nMilk;2\n' | npx tsx tests/manual/parse-list.ts --csv
printf 'name,qty,unit\nMilk,2 lb,l\n' | npx tsx tests/manual/parse-list.ts --csv
printf 'Milk,1\nmilk,2\n' | npx tsx tests/manual/parse-list.ts --csv
```

Expected:
1. `Rice 1.5 each`.
2. `Milk 1.5 each`. The generic CSV reader would split `1,5` here: it counts one `;` and one `,`,
   and the tie goes to the comma.
3. `Milk 2 each`: leading blank lines don't hide the `;` separator.
4. `Milk 2 l`: the unit column wins over a unit in the quantity cell.
5. Two items: CSV rows are not merged.

**Why `parseListCsv` detects the separator itself:** `csv.ts` (fixed, not to be changed) guesses
from the raw first line, so headerless semicolon files with decimal commas, quoted commas in the
first line, Excel's `sep=` line and tab-separated files were misread. `parseListCsv` passes an
explicit delimiter to `parseCsv` instead.

Not testable in the UI yet: see M3.

## M5. Product matching (`src/utils/matching.ts`)

Spec: TECH_SPEC section 5.2 (last paragraph) and the doc comments in `matching.ts`.

How it works:
1. **`normalizeName`** folds accents (`café` to `cafe`, `Crème Fraîche` to `creme fraiche`, `ß` to
   `ss`) and lower-cases. Apostrophes join (`Jack's` to `jacks`); every other punctuation mark
   separates words (`whole-wheat` to `whole wheat`), except a decimal point between digits
   (`1.5 qt`). Whitespace is collapsed and **plural** words are made singular: `eggs` to `egg`,
   `tomatoes` to `tomato`, `berries` to `berry`, `peaches` to `peach`, `loaves` to `loaf`, `cookies`
   to `cookie`. Singular words are never changed (`olive`, `cookie`, `swiss`, `hummus`, `gas`).
2. **Score** of a product: **1** if the normalised typed name equals its normalised name or any
   alias. Otherwise it is the best **Jaccard** overlap against the name and each alias separately:
   words in common / distinct words in both. `olive` vs `olive oil` is 1/2 = 0.5; `cherry tomato
   salad` vs `cherry tomatoes` is 2/3.
3. **Threshold** (default **0.5**, inclusive): a product matches when its score is >= the
   threshold. A name sharing no word with a product never matches it, even with threshold 0.
4. **Ties**: higher score, then the **shorter product name** (the product's `name`, not the alias
   that matched), then the **lower sku** (plain character order: `SKU-10` comes before `SKU-2`).

### M5.1 Regression check

```bash
tests/manual/match-samples.sh | diff tests/manual/match-samples.expected.md - && echo "M5.1 OK: no differences"
```

Expected: `M5.1 OK: no differences`. The reviewed tables (`tests/manual/match-samples.expected.md`)
cover the requested examples against the test catalog, and typical names against the seeded
catalog:

| Typed | Match (test catalog) | Score | Why |
|---|---|---|---|
| `Eggs` | Large Eggs dozen | 1 | plural + case: `egg` is an alias |
| `dozen large eggs` | Large Eggs dozen | 1 | same words as the name in another order (Jaccard 3/3) |
| `EXTRA virgin olive oil` | Extra Virgin Olive Oil 1 L | 1 | exact alias, case ignored |
| `olive` / `olives` | **Green Olives** | 0.5 | **tie** with Extra Virgin Olive Oil (0.5); the shorter name wins |
| `café` / `CAFE` | Ground Coffee 12 oz | 1 | the alias `café` and the typed name both normalise to `cafe` |
| `tomatoes` | Roma Tomatoes 1 lb | 1 | exact alias beats Cherry Tomatoes and Tomato Sauce (0.5 each) |
| `dish soap`, `bread` | *none* | | no word in common with any product |
| `oat milk` | Whole Milk 1 gal | 0.5 | **false positive**: see below |
| `chicken thighs` | Chicken Breast 2 lb | 0.5 | **false positive**: see below |

### M5.2 Exploratory checks

```bash
npx tsx tests/manual/match.ts "Strawberries" "peaches" "Jalapeño" "whole-wheat"
npx tsx tests/manual/match.ts --catalog data/products.csv "your own words here"
npx tsx tests/manual/try.ts "normalizeName('Crème Brûlée')" "normalizeName('Loaves of bread')" "normalizeName('Ben & Jerry’s')"
```

Expected for the `try.ts` line: `"creme brulee"`, `"loaf of bread"`, `"ben jerry"`. On the test
catalog, the four names in the first line match nothing; the point is to see their normalised
forms: `strawberry`, `peach`, `jalapeno`, `whole wheat`. `whole-wheat` is listed with Whole Milk
as a candidate at 0.333, which is below the threshold.

**Known consequence of the spec's threshold (0.5, inclusive).** A two-word name whose only shared
word is a one-word alias scores exactly 0.5 and matches. On the seeded catalog, `oat milk` and
`almond milk` match Whole Milk (alias `milk`), `chicken thighs` matches Chicken Breast (alias
`chicken`), and `rice cakes` matches Long Grain Rice (alias `rice`). Such an item is then priced as
that product. The same rule is what lets `olive` find the olive oil and `pasta` find spaghetti.
Not changed, because the spec fixes the default at 0.5. Possible remedies, pending a decision:
(a) more specific aliases or products in the catalog (an `Almond Milk` product would win with 1);
(b) a stricter threshold passed by the server (`0.51` stops these, but also stops `olive` finding
the olive oil); (c) a partial match could require every typed word to be found in the candidate.
Option (c) departs from plain Jaccard. **Decision: (b).** The API uses a threshold of 0.51 (see
M5.3). `matchProduct` keeps the spec default of 0.5, so everything above, which calls it directly,
is unchanged. Option (a) was ruled out because the seeded catalog, `data/products.csv`, must not be
modified.

### M5.3 The API threshold (0.51)

`server/src/services/catalogMatch.ts` exports `CATALOG_MATCH_THRESHOLD = 0.51` and
`matchCatalogItem(name, products)`, which the API will use to link list items to products. The effect
on the seeded catalog:

```bash
for t in 0.5 0.51; do npx tsx tests/manual/match.ts --catalog data/products.csv --threshold $t \
  "oat milk" "almond milk" "chicken thighs" "rice cakes" "olive" "pasta" "chicken" "Milk" "boneless chicken"; done
```

| Typed | at 0.5 (`matchProduct` default) | at 0.51 (API) |
|---|---|---|
| `oat milk`, `almond milk` | Whole Milk (0.5) | *none* |
| `chicken thighs` | Chicken Breast (0.5) | *none* |
| `rice cakes` | Long Grain Rice (0.5) | *none* |
| `olive` | Extra Virgin Olive Oil (0.5) | *none*: the accepted cost |
| `pasta`, `chicken`, `Milk` | Spaghetti, Chicken Breast, Whole Milk (1) | same (exact aliases always match) |
| `boneless chicken` | Chicken Breast (0.667) | same |

Items that no longer match are still added to lists; they show *No price data for this item* and
are listed as unpriced in the comparison.

Not testable in the UI yet: items are matched by the API when they are added (`POST
/lists/:id/items`, imports).

## M6. Price comparison: `compareBasket`, happy path

Spec: TECH_SPEC sections 5.3 and 9, and the field docs of `ComparisonRow`, `StoreTotal` and
`ComparisonSummary` in `src/models/index.ts`. Covers the case where every store sells every item; the edge cases are in M7.

How the numbers are computed (all sums in integer cents):

| Figure | Definition | Rounding |
|---|---|---|
| line total | unit price x quantity | exact cents |
| row Average / High / Low | mean / max / min of the row's line totals | Average unrounded; High and Low exact cents |
| row Savings, % | Average - Low; Savings / Average x 100 | unrounded |
| Total cost (per store) | sum of the store's line totals | exact cents |
| vs optimal, % | store total - optimal total; / optimal total x 100 | dollars exact cents; % unrounded |
| vs cheapest, % | store total - cheapest store total; / cheapest store total x 100 | dollars exact cents; % unrounded |
| Optimal total | sum of the row Lows (best split across stores) | exact cents |
| High total | sum of the row Highs | exact cents |
| Average total | mean of the store totals | unrounded (144.0925, shown as 144.09) |
| Savings, % | Average total - Optimal total; / Average total x 100 | unrounded |
| Cheapest store | lowest store total; a tie goes to the earlier store | |

### M6.1 The golden basket

```bash
npx tsx tests/manual/compare-golden.ts | diff tests/manual/compare-golden.expected.md - && echo "M6.1 OK: no differences"
```

Expected: `M6.1 OK: no differences`. The last line of the output must read
`GOLDEN_EXPECTED: 126 numbers checked, 0 mismatches`. The acceptance numbers of TECH_SPEC section 9
are in the output:

| Figure | Expected |
|---|---|
| Store totals (FreshMart ... Sunrise) | 135.51, 147.27, 141.67, 154.51, 142.02, 150.23, 146.92, 134.61 |
| Optimal total | 115.56 |
| High total | 182.79 |
| Average total | 144.0925 (table: 144.09) |
| Savings | 28.5325 (28.53), 19.80% |
| Cheapest store | `store-sunrise`, chain `sunrise` (134.61) |

Check by eye in the matrix: the bold cell of each row is its lowest price; Low equals that value;
the Low column adds up to 115.56.

### M6.2 Exploratory checks

Build a small basket of your own and check the figures by hand. For example, two stores, 3 milk
and 1 eggs, where each store is cheaper for one item:

```bash
npx tsx tests/manual/try.ts "(() => { const s = [{id:'a',chainId:'a',chainName:'A',name:'A',address:'',city:'',location:{lat:0,lng:0}},{id:'b',chainId:'b',chainName:'B',name:'B',address:'',city:'',location:{lat:0,lng:0}}]; const r = compareBasket([{key:'milk',label:'Milk',quantity:3,productId:'m'},{key:'eggs',label:'Eggs',quantity:1,productId:'e'}], s, {m:{a:4.01,b:3.99},e:{a:2.5,b:2.75}}); return { totals: r.storeTotals.map(t => [t.storeId, t.total, t.vsOptimal, t.vsCheapestStore]), summary: r.summary }; })()"
```

Expected: store `a` total `14.53` (3 x 4.01 = 12.03, plus 2.50) and store `b` total `14.72`
(11.97 + 2.75). Optimal total `14.47` (11.97 + 2.50). `vsOptimal` is `0.06` and `0.25`;
`vsCheapestStore` is `0` and `0.19`. `cheapestStoreId` is `"a"`. `averageTotal` is `14.625`
(unrounded) and `savings` `0.155`.

Not testable in the UI yet: the comparison page needs the API (`GET /lists/:id/comparison`).

## M7. Price comparison: edge cases and `filterStores`

Spec: TECH_SPEC section 5.3 (decisions list) and the doc comments in `comparison.ts`.

### M7.1 Regression check

```bash
npx tsx tests/manual/compare-edge.ts | diff tests/manual/compare-edge.expected.md - && echo "M7.1 OK: no differences"
```

Expected: `M7.1 OK: no differences`. One scenario at a time:
`npx tsx tests/manual/compare-edge.ts storeMissingItem`. What each scenario must show (A, B, C are
stores; every figure can be checked by hand from `tests/fixtures/comparisonScenarios.ts`):

| Scenario | Input | Expected | A naive version would give |
|---|---|---|---|
| `storeMissingItem` | C sells no eggs | C total **3.50**, `complete: false`, `missingKeys: ["eggs"]`. Average total **9.10** (A and B only). Cheapest **A** (9.00). C vs cheapest **0 (0%)**: incomplete stores are not compared (D-14); B vs cheapest 0.20. C vs optimal −4.00. Optimal 7.50 | average 7.23; cheapest C; C vs cheapest −5.50 |
| `unmatchedItem` | one item has no product, another a product nobody sells | both rows all `null`, `savings` 0; `unpricedKeys: ["mystery", "discontinued"]`; A and B still complete; totals 6.00 / 5.00 | stores marked incomplete; NaN row figures |
| `quantities` | milk x 3 at 4.35 / 3.99, rice x 1.5, cheese x 0.333 | milk line totals **13.05** / 11.97 (not 13.049999999999999); rice **2.99** (2.985 rounded half away); cheese 1.07 / 1.00; totals **17.11** / **16.12**; cheapest B | 13.049999999999999; 2.98 |
| `noStores` | lines, no stores | `storeIds: []`, `storeTotals: []`, every figure 0, `cheapestStoreId: null`, every line unpriced | a crash, or NaN |
| `noLines` | stores, empty list | every total 0, every store complete, every percentage **0** (not NaN), `cheapestStoreId: "a"` | NaN percentages |
| `tiedStores` | A and B: same prices | milk `lowStoreIds: ["a","b"]`; A and B total 7.00, cheapest **A** (the earlier store). With the stores in the order C, B, A, the cheapest is **B** | only one store at the low; the later store |
| `unlistedStorePrices` | Z (not in the list) sells milk at 0.01 and is the only seller of caviar | no `z` column; milk low **2.50** (B); caviar **unpriced** | low 0.01; caviar priced |
| `noCompleteStore` | A has only milk, B only eggs | `cheapestStoreId: null`, vs-cheapest fields 0, average **3.50** over all stores, savings **−3.50** (−100%) | |
| `invalidPrice` | A's milk price is `NaN` | A counts as not selling milk (`missingKeys: ["milk"]`), vs cheapest 0 (D-14); cheapest B | A free, and the cheapest |

**Spec behaviours worth knowing:**
- **With no complete store, savings can be negative.** The average is then taken over partial
  totals, which can be below the optimal total (`noCompleteStore`: 3.50 vs 7.00).
- **An incomplete store's "vs cheapest" is 0 (0%)** (D-14). Its "vs optimal" is still computed
  and can be negative (`storeMissingItem`: −4.00); see D-27.
- **With no lines, the first store is the cheapest** (D-24). Every store is then complete with a
  total of 0; the tie goes to the first.
- **Unrounded fields show float noise in the last digits** (`tiedStores`: average
  `2.666666666666667`, savings `0.16666666666666685`). The spec wants them unrounded; displays
  round them.

### M7.2 Exploratory checks (`filterStores`)

```bash
npx tsx tests/manual/try.ts \
  "filterStores([{id:'s1',chainId:'freshmart'},{id:'s2',chainId:'sunrise'},{id:'s3',chainId:'harvest'}], {includedChains: [], excludedChains: []}).map(s => s.id)" \
  "filterStores([{id:'s1',chainId:'freshmart'},{id:'s2',chainId:'sunrise'},{id:'s3',chainId:'harvest'}], {includedChains: ['sunrise','harvest'], excludedChains: []}).map(s => s.id)" \
  "filterStores([{id:'s1',chainId:'freshmart'},{id:'s2',chainId:'sunrise'},{id:'s3',chainId:'harvest'}], {includedChains: [], excludedChains: ['sunrise']}).map(s => s.id)" \
  "filterStores([{id:'s1',chainId:'freshmart'},{id:'s2',chainId:'sunrise'},{id:'s3',chainId:'harvest'}], {includedChains: ['sunrise','harvest'], excludedChains: ['sunrise']}).map(s => s.id)"
```

Expected: `["s1","s2","s3"]` (nothing set: every store), `["s2","s3"]` (included only),
`["s1","s3"]` (excluded dropped), `["s3"]` (**exclude wins** over include). Chain ids are compared
exactly (`Sunrise` is not `sunrise`). The input order is kept.

Not testable in the UI yet: the comparison page and the Settings chain preferences need the API.

## M8. Routing (`src/utils/route.ts`): `haversineKm` and exact `planRoute`

Spec: TECH_SPEC section 5.5 and the `RoutePlan` / `RouteStop` docs in `src/models/index.ts`.
Decisions D-28 to D-33. This section covers routes of **up to 8 stops**, solved exactly by trying
every visiting order; more stops use the heuristic of [M9](#m9-routing-beyond-8-stops-nearest-neighbour--2-opt).

### M8.1 Known distances (`haversineKm`)

```bash
npx tsx tests/manual/try.ts \
  "haversineKm({lat:0,lng:0},{lat:1,lng:0})" "6371*Math.PI/180" \
  "haversineKm({lat:29.2,lng:-81.05},{lat:30.2,lng:-81.05})" "haversineKm({lat:1,lng:2},{lat:1,lng:2})" \
  "haversineKm({lat:60,lng:10},{lat:60,lng:11})" "haversineKm({lat:0,lng:0},{lat:0,lng:180})" \
  "haversineKm({lat:0,lng:179.5},{lat:0,lng:-179.5})" \
  "haversineKm({lat:29.2105,lng:-81.0312},{lat:29.1798,lng:-81.0143})"
```

| # | Expression | Expected | What it proves |
|---|---|---|---|
| 1 | one degree of latitude at the equator | `111.19492664455873` | **about 111.19 km**; equals line 2 exactly |
| 2 | `6371*Math.PI/180` | `111.19492664455873` | the arc of 1 degree on a 6371 km sphere |
| 3 | one degree of latitude in Port Marlowe | `111.19492664455873` | same anywhere along a meridian |
| 4 | the same point | `0` | |
| 5 | one degree of longitude at 60°N | `55.596934071140865` | about half of line 1 (cos 60° = 0.5) |
| 6 | half-way round the equator | `20015.086796020572` | π x 6371, no NaN for antipodal points |
| 7 | 179.5°E to 179.5°W | `111.1949266445647` | 1 degree across the antimeridian, not 359 |
| 8 | FreshMart Beacon Street to Sunrise Market Harbor View | `3.78739679372212` | hand check on a flat map: 0.0307° lat = 3.414 km, 0.0169° lng x cos 29.2° = 1.640 km, √(3.414² + 1.640²) = 3.787 km |

### M8.2 The 5-stop fixture against brute force

```bash
npx tsx tests/manual/route-fixture.ts | diff tests/manual/route-fixture.expected.md - && echo "M8.2 OK: no differences (round trip)"
npx tsx tests/manual/route-fixture.ts --one-way | diff tests/manual/route-fixture-one-way.expected.md - && echo "M8.2 OK: no differences (one way)"
npx tsx tests/manual/route-fixture.ts --all8 | diff tests/manual/route-fixture-all8.expected.md - && echo "M8.2 OK: no differences (8 stores)"
```

Expected: three `M8.2 OK` lines. Then run `npx tsx tests/manual/route-fixture.ts` on its own and
check by eye:

- Home is `29.2, -81.05`; the five stops are passed in a poor order (citypantry, harvest,
  budgetbasket, greenleaf, valugrocer).
- The route is **City Pantry, GreenLeaf, Harvest, ValuGrocer, Budget Basket**, legs
  3.02 + 2.68 + 5.52 + 6.25 + 5.10 km and 4.43 km back home: **27.00 km, 41 min** (27.0046 km at
  40 km/h = 40.5 min).
- The brute-force table lists all 120 orders shortest first: the planner's order is **rank 1**;
  rank 2 is the same route reversed, with the identical length (a tie, resolved to the input
  order: City Pantry is first in the input, D-28). The input order is rank 111, at 39.57 km.
- The last line reads `BRUTE FORCE: shortest 27.004574 km; planRoute agrees (...)`.

Variants: `--one-way` gives the same order at **22.58 km, 34 min** and `returnDistanceKm 0`
(the reverse is now rank 4, not a tie). `--walking` gives the same route and distances at
**324 min**. `--all8` routes the 8 stores of `data/stores.csv`: rank 1 of **40320** orders,
**29.82 km, 45 min**, starting with FreshMart.

The automated version (`src/utils/__tests__/route.test.ts`) also checks all 120 input orders of
the fixture, every store as home, 200 random 1 to 6 stop instances and the 8 stores against an
independent brute force, and that no field of the plan disagrees with a recomputation.

### M8.3 Exploratory checks

**Ties keep the input order** (D-28). Stops on a line north of home, at 1° (A) and 2° (B):

```bash
npx tsx tests/manual/try.ts \
  "planRoute({lat:0,lng:0},[{id:'a',name:'A',location:{lat:1,lng:0}},{id:'b',name:'B',location:{lat:2,lng:0}}]).stops.map(s => s.storeId)" \
  "planRoute({lat:0,lng:0},[{id:'b',name:'B',location:{lat:2,lng:0}},{id:'a',name:'A',location:{lat:1,lng:0}}]).stops.map(s => s.storeId)" \
  "planRoute({lat:0,lng:0},[{id:'b',name:'B',location:{lat:2,lng:0}},{id:'a',name:'A',location:{lat:1,lng:0}}], {roundTrip:false}).stops.map(s => s.storeId)" \
  "planRoute({lat:0,lng:0},[{id:'n',name:'N',location:{lat:1,lng:0}},{id:'s',name:'S',location:{lat:-1,lng:0}}], {roundTrip:false}).stops.map(s => s.storeId)" \
  "planRoute({lat:0,lng:0},[{id:'s',name:'S',location:{lat:-1,lng:0}},{id:'n',name:'N',location:{lat:1,lng:0}}], {roundTrip:false}).stops.map(s => s.storeId)"
```

| # | Case | Expected | Why |
|---|---|---|---|
| 1 | round trip, input A, B | `["a","b"]` | both directions are 4° long: input order kept |
| 2 | round trip, input B, A | `["b","a"]` | same tie, other input order |
| 3 | one way, input B, A | `["a","b"]` | not a tie one way: nearest first (2° vs 3°) |
| 4 | one way from the middle, N then S | `["n","s"]` | 1° + 2° either way: tie, input order |
| 5 | one way from the middle, S then N | `["s","n"]` | |

**Rounding** (D-32). Three stops due east along the equator, 1.004 km apart:

```bash
npx tsx tests/manual/try.ts \
  "planRoute({lat:0,lng:0},[1,2,3].map(k => ({id:'e'+k,name:'E'+k,location:{lat:0,lng:1.004*k*180/(6371*Math.PI)}})), {roundTrip:false})" \
  "planRoute({lat:0,lng:0},[1,2,3].map(k => ({id:'e'+k,name:'E'+k,location:{lat:0,lng:1.004*k*180/(6371*Math.PI)}})))"
```

Expected: every stop has `legDistanceKm` **1** and `legDurationMin` **2** (1.506 min), yet one way
`totalDistanceKm` is **3.01** and `totalDurationMin` **5** (3.012 km = 4.518 min), not 3.00 and 6:
totals come from unrounded legs. As a round trip: `returnDistanceKm` **3.01**, `totalDistanceKm`
**6.02**, `totalDurationMin` **9**.

**Defaults, walking, empty input and errors**:

```bash
npx tsx tests/manual/try.ts \
  "planRoute({lat:0,lng:0},[{id:'n',name:'N',location:{lat:1,lng:0}}],{roundTrip:false,mode:'walking'})" \
  "planRoute({lat:29.2,lng:-81.05},[])" \
  "planRoute({lat:NaN,lng:0},[])" \
  "planRoute({lat:0,lng:0},[],{mode:'flying'})"
```

| # | Case | Expected |
|---|---|---|
| 1 | walking 1° one way | `legDistanceKm` 111.19, `legDurationMin` **1334** (111.19 km at 5 km/h = 1334.3 min), `returnDistanceKm` 0 |
| 2 | no stores, no options | `mode "driving"`, `roundTrip true` (the defaults), `stops []`, every distance and duration `0` |
| 3 | NaN origin | `!! planRoute: the origin needs finite lat and lng` (a RangeError, D-30; not a 0 km route) |
| 4 | unknown mode | `!! planRoute: unknown travel mode "flying"` |

`try.ts` exits 1 when an expression throws; lines 3 and 4 are expected to. (Until the second round
of stage 2, 9 stops threw `not implemented`; they now use the heuristic, see M9.)

Not testable in the UI yet: see the end of M9.

## M9. Routing beyond 8 stops: nearest neighbour + 2-opt

Spec: TECH_SPEC section 5.5. Decisions D-28 (tie rule, confirmed), D-35, D-37, D-38 (D-34 and D-36 are
withdrawn). With **9 stops or more** `planRoute` no
longer tries every order: it builds a nearest-neighbour route, then improves it with 2-opt
(reversing runs of stops while that shortens the route). The result is always a valid order of the
input stops and never longer than plain nearest neighbour, but it is **not guaranteed optimal**.
Everything else (round trip / one way, driving / walking speeds, rounding, empty input) works as in
M8.

### M9.1 The 12-stop fixture

The fixture is the 8 real stores plus 4 **fictional** ones (`... (fictional)` in the output, D-37),
listed in a poor order.

```bash
npx tsx tests/manual/route-heuristic.ts | diff tests/manual/route-heuristic.expected.md - && echo "M9.1 OK: no differences (round trip)"
npx tsx tests/manual/route-heuristic.ts --one-way | diff tests/manual/route-heuristic-one-way.expected.md - && echo "M9.1 OK: no differences (one way)"
```

Expected: two `M9.1 OK` lines. Then run `npx tsx tests/manual/route-heuristic.ts` on its own and
check by eye:

- **Valid permutation**: the table has 12 numbered stops, each store once (the check line reads
  `12 stops, 12 distinct, missing [], duplicated []`).
- **At least as good as nearest neighbour**: `33.94496 km vs nearest neighbour 39.00401 km (saves
  5.05905 km)`. The input order would be 75.07 km.
- **2-opt finished**: no reversal of a run of stops still helps (the `7.1e-15 km` shown is float
  noise from reversing the whole round trip, which is equally long; D-29).
- **Against the true optimum** (Held-Karp over all 12! orders): the round trip **is** optimal
  (gap 0.00000 km).
- Total **33.94 km** (33.94496 rounded; leg values may not add up to it exactly, D-32).
- **Tie rule** (D-28, D-38): `no equally short reversal keeps the input sequence better ... found:
  none`, and `input order kept if it is equally short` (here not applicable: the input order is
  75 km).
- Last line: `HEURISTIC CHECKS: 7 OK, 0 failed`.

With `--one-way`: 30.41 km against nearest neighbour's 35.16 km (saves 4.75 km); the true optimum is
30.39 km, so the heuristic is **22 m (0.07%) longer than optimal** here. That is expected of a
heuristic, and the reason the spec only promises exactness up to 8 stops.

### M9.2 Walking versus driving for the same stops

Same command; compare the last two columns of the route table. The order and the distances do not
depend on the mode; only durations do (driving 40 km/h = 1.5 min per km, walking 5 km/h = 12 min
per km):

| | Round trip | One way |
|---|---:|---:|
| Distance | 33.94 km | 30.41 km |
| Driving | **51 min** (33.94496 x 1.5 = 50.92) | **46 min** (45.62) |
| Walking | **407 min** (33.94496 x 12 = 407.34) | **365 min** (364.97) |

The output says `same order and distances: yes`. The ratio of total minutes is 7.98 (7.93 one way)
rather than exactly 8 because each total is rounded to whole minutes. Per leg, the walking minutes
are about 8 times the driving ones, each rounded separately (a 0.96 km leg: 1 min driving, 11 min
walking).

### M9.3 Empty input

The end of the same output prints `planRoute(home, [], ...)` for both modes: `stops: []` and
`returnDistanceKm`, `totalDistanceKm`, `totalDurationMin` all `0`, with `mode` and `roundTrip` as
requested (`roundTrip: false` with `--one-way`). Nothing throws. Defaults with no options at all:
M8.3 (`mode "driving"`, `roundTrip true`).

### M9.4 Ties beyond 8 stops

Ten stops 0.01° apart on a line north of home (`n1` nearest), and a line through home with five
stops on each side:

```bash
npx tsx tests/manual/try.ts \
  "planRoute({lat:0,lng:0}, Array.from({length:10},(_, i) => ({id:'n'+(i+1),name:'N'+(i+1),location:{lat:(i+1)/100,lng:0}}))).stops.map(s => s.storeId).join(' ')" \
  "planRoute({lat:0,lng:0}, Array.from({length:10},(_, i) => ({id:'n'+(i+1),name:'N'+(i+1),location:{lat:(i+1)/100,lng:0}})).reverse()).stops.map(s => s.storeId).join(' ')" \
  "planRoute({lat:0,lng:0}, Array.from({length:10},(_, i) => ({id:'n'+(i+1),name:'N'+(i+1),location:{lat:(i+1)/100,lng:0}})).reverse(), {roundTrip:false}).stops.map(s => s.storeId).join(' ')" \
  "planRoute({lat:0,lng:0}, [1,2,3,4,5].flatMap(k => [{id:'n'+k,name:'N',location:{lat:k/100,lng:0}},{id:'s'+k,name:'S',location:{lat:-k/100,lng:0}}]), {roundTrip:false}).stops.map(s => s.storeId).join(' ')" \
  "planRoute({lat:0,lng:0}, [1,2,3,4,5].flatMap(k => [{id:'s'+k,name:'S',location:{lat:-k/100,lng:0}},{id:'n'+k,name:'N',location:{lat:k/100,lng:0}}]), {roundTrip:false}).stops.map(s => s.storeId).join(' ')" \
  "planRoute({lat:0,lng:0},Array.from({length:9},(_, i) => ({id:'s'+i,name:'S'+i,location:{lat:i/100,lng:0}}))).totalDistanceKm"
```

| # | Case | Expected | Why |
|---|---|---|---|
| 1 | round trip, input n1..n10 | `"n1 n2 ... n10"` | both directions equally long: input order (D-28) |
| 2 | round trip, input n10..n1 | `"n10 n9 ... n1"` | same tie, other input order |
| 3 | one way, input n10..n1 | `"n1 n2 ... n10"` | not a tie one way: nearest first |
| 4 | one way from the middle, input n1, s1, n2, s2, ... | `"n1 n2 n3 n4 n5 s1 s2 s3 s4 s5"` | north side first or south side first: equally short orders; the one that keeps the input sequence (n1 is listed first) wins (D-28) |
| 5 | same, input s1, n1, s2, n2, ... | `"s1 s2 s3 s4 s5 n1 n2 n3 n4 n5"` | |
| 6 | 9 stops (threw `not implemented` in the first round of stage 2) | `17.79` | 2 x 0.08° x 111.19 km: out along the line and back |

More tie cases (stores at the same spot, an input that is already a shortest order, the mirror image
of a shortest route) are in the checklist of M9.5.

**Known limit (D-38).** With more than 8 stops the planner cannot see every equally short order. It
keeps the input sequence among the orders it compares, and returns the input order whenever that is
equally short. But on a *shuffled* line with 10 stops (512 equally short out-and-back round trips)
it returns the input-earliest of all 512 in 92 of 200 tries, not always
(`npx tsx tests/manual/route-line-ties.ts` prints `200/200` and `92/200`). Every result is one of the
shortest, and keeps the input sequence at least as well as either straight direction. Up to 8 stops
the rule holds over all orders.

### M9.5 Acceptance checklist

One command prints evidence for each acceptance point, for the exact search (5-stop fixture) and
the heuristic (12-stop fixture). Every figure is recomputed from `haversineKm` and the stated speeds
and compared with what `planRoute` returns:

```bash
npx tsx tests/manual/route-checklist.ts | diff tests/manual/route-checklist.expected.md - && echo "M9.5 OK: no differences"
```

Expected: `M9.5 OK: no differences`; run it without the `diff` to read the tables. The last line is
`CHECKLIST: all checks OK`. What each table shows:

| Table | Acceptance point | Example evidence |
|---|---|---|
| 1-2 | round trip adds the return leg and reports `returnDistanceKm`; one way reports 0 | 12 stops: `legs 31.77868 + return 2.16628 = 33.94496, reported 33.94`; one way `reported 0` |
| 3 | durations from the stated speeds | `33.94496 km = 50.92 min, reported 51` (driving), `407.34 min, reported 407` (walking) |
| 4 | tie rule | lines in both directions, sides of a line, two stores at one spot, an input already shortest, a mirror-image input: each keeps the input sequence |
| 5 | the heuristic output is a permutation of the input | `12 stops, 0 missing, 0 repeated` |
| 6 | no stops yields zero totals | all four mode / trip combinations |
| 7 | rounding of legs versus totals | 10 stops 1.004 km apart: legs `1.00` each (sum 10.00), total **10.04**; legs 2 min each (sum 20), total **15** |

Not testable in the UI yet: the Plan page's route map and `POST /api/routes/optimize` need the API,
and `optimizePurchase` (which orders each plan's stores with `planRoute`) is not implemented yet.

## M10. Deals (`src/utils/deals.ts`): `detectDeals`

Spec: TECH_SPEC section 5.6. Decisions D-39 to D-46. For each store and product, the two most
recent snapshots (feed dates) are compared; a deal is reported when the latest **price paid** is
lower by at least `thresholdPct` percent, **a drop exactly at the threshold counts**. Results sort
by `dropPct` descending, then `productId`, then `storeId`.

### M10.1 The scenarios

```bash
npx tsx tests/manual/deals-cases.ts | diff tests/manual/deals-cases.expected.md - && echo "M10.1 OK: no differences"
```

Expected: `M10.1 OK: no differences`. Then run `npx tsx tests/manual/deals-cases.ts` (or one
scenario, e.g. `npx tsx tests/manual/deals-cases.ts mixedSortOrder`) and check each by eye; every
scenario ends with `OK: equals the expected result` and the last line is
`DEAL SCENARIOS: 8 OK, 0 mismatched`. Threshold 10% throughout.

| Scenario | Input | Expected | A naive version would give |
|---|---|---|---|
| `exactlyAtThreshold` | milk 1.00 -> 0.90; eggs 5.00 -> 4.50 | **two deals, `dropPct` 10** each (eggs first: same drop, `eggs` < `milk`) | no milk deal: `(1.00 - 0.90) / 1.00 x 100` is 9.999999999999998 in floating point (D-40) |
| `justUnderThreshold` | milk 1.00 -> 0.91 (9%); eggs 5.00 -> 4.51 (9.8%, one cent short) | **no deals** | |
| `singleSnapshot` | milk at 0.01, one snapshot only; eggs 4.00 -> 2.00 | only **eggs, 50%** | a deal for milk against nothing / a crash |
| `threeSnapshotsNoDeal` | 10.00 -> 5.00 -> 4.80 | **none**: only 5.00 -> 4.80 (4%) counts | 52% (oldest vs latest) |
| `threeSnapshotsDeal` | 4.00 -> 5.00 -> 4.50, given out of date order | **10%**, old 5.00, new 4.50, dated 2026-11-02, `onSale true` (from the latest point) | none (oldest vs latest is a rise), or the input order used instead of dates |
| `sameDateLastWins` | milk: W2 has 4.00 then 4.80; eggs: W2 has 4.80 then 4.00 | milk **none** (4.80 wins: 4%); eggs **20%** (4.00 wins) | the first point winning: the opposite |
| `sameDateNotTwoSnapshots` | two points, both on W2 (5.00 and 2.00) | **none**: one date is one snapshot | a 60% "drop" within one day |
| `mixedSortOrder` | 9 pairs, shuffled | coffee 50%, rice 25%, then the 20% ties: **bread@z, milk@a, milk@b, milk@c** (product first, then store), then tea 10%; soap (5%, and a rise) left out | ties in input order, or by store first |

### M10.2 Exploratory checks

```bash
npx tsx tests/manual/try.ts \
  "detectDeals([{storeId:'s',productId:'p',date:'2026-10-19',price:2.5,regularPrice:2.5,onSale:false},{storeId:'s',productId:'p',date:'2026-10-26',price:2.5,regularPrice:2.5,onSale:false}], 0)" \
  "detectDeals([{storeId:'s',productId:'p',date:'2026-10-19',price:2.5,regularPrice:2.5,onSale:false},{storeId:'s',productId:'p',date:'2026-10-26',price:2.49,regularPrice:2.49,onSale:false}], 0).length" \
  "detectDeals([{storeId:'s',productId:'p',date:'2026-10-19',price:3,regularPrice:3,onSale:false},{storeId:'s',productId:'p',date:'2026-10-26',price:2,regularPrice:2,onSale:false}], 10)[0].dropPct" \
  "detectDeals([{storeId:'s',productId:'p',date:'2026-10-19',price:5,regularPrice:5,onSale:false},{storeId:'s',productId:'p',date:'2026-10-26',price:4,regularPrice:4,onSale:false},{storeId:'s',productId:'p',date:'2026-11-02',price:NaN,regularPrice:NaN,onSale:false}], 10)" \
  "detectDeals([], -1)"
```

| # | Case | Expected |
|---|---|---|
| 1 | threshold 0, unchanged price | `[]`: a deal needs a real drop (D-41) |
| 2 | threshold 0, one cent less | `1` |
| 3 | 3.00 -> 2.00 | `33.333333333333336`: `dropPct` is unrounded (D-45); screens round it |
| 4 | latest point has price NaN | the deal of the two earlier snapshots (5.00 -> 4.00, 20%, dated 2026-10-26): an unusable point counts as "not listed" (D-42) |
| 5 | threshold -1 | `!! detectDeals: thresholdPct must be a finite number >= 0 (got -1)` (RangeError, D-43; `try.ts` exits 1) |

**Open question (D-46).** A store that stops listing a product keeps its last drop as a deal, dated
on that older snapshot. That is the literal spec; whether `GET /deals` should only show drops from
the latest feed is for the product owner to decide before the API stage.

Not testable in the UI yet: the deals page (`/deals`) needs the API (`GET /api/deals`) and the
`DealsList` component, which is still a stub.

## M11. Purchase optimisation (`src/utils/optimizer.ts`), free travel

Spec: TECH_SPEC sections 5.4 and 9. Decisions D-47 to D-53. This section covers plans **without a
home location** (travel is free); with a home, see M12.

**How it searches** (D-47). It tries every set of 1 to `maxStores` stores (at most 255 sets for 8
stores). Within a set, each item is bought where it is cheapest (a tie goes to the store listed
first), and stores that end up buying nothing are dropped. The best plan is the one with the fewest
items it cannot buy, then the lowest total, then the fewest stores, then the stores listed earliest.
All money is compared in whole cents.

**Why that is exact.** Without travel costs, a plan's cost is just the sum of its items, so for a
given set of stores nothing beats buying each item where it is cheapest within the set. Every
possible plan uses some set of at most `maxStores` stores, and that set is one of those tried, with
a plan at least as good. So the best plan found is the best there is. The unit tests check this
against a brute-force search over every way of assigning items to stores (400 random cases).

### M11.1 The golden basket

```bash
npx tsx tests/manual/optimize-golden.ts | diff tests/manual/optimize-golden.expected.md - && echo "M11.1 OK: no differences"
```

Expected: `M11.1 OK: no differences`, and in the output (run it without `diff`):

| `maxStores` | Best plan: stores | Items total | Grand total |
|---:|---|---:|---:|
| 1 | Sunrise Market | 134.61 | **134.61** (TECH_SPEC 9) |
| 2 | GreenLeaf Market, Sunrise Market | 124.70 | **124.70** |
| 3 | GreenLeaf Market, City Pantry, Sunrise Market | 119.36 | **119.36** |
| 8 | all 8 chains | 115.56 | **115.56** (TECH_SPEC 9; = the comparison's optimal split) |

Grand total equals items total (no travel). The last line is `ACCEPTANCE: 2 OK, 0 mismatched`. Other
values: `npx tsx tests/manual/optimize-golden.ts 4 5 6 7` (117.78, 116.40, 115.88, 115.69).

Check by eye:
- **maxStores 3**: Pasta Sauce costs 4.00 at both City Pantry and Sunrise; it is bought at City Pantry,
  the store listed first (tie rule).
- **maxStores 8**: every item is at its lowest price: compare each line with the bold cell of its row
  in M6.1 (`npx tsx tests/manual/compare-golden.ts`); the eight subtotals add up to 115.56.
- The `byStoreCount` table lists the best plan for exactly 1 to 8 stores; each extra store saves less.
- `savingsVsSingleStore` for maxStores 8 is 19.05 (134.61 - 115.56), the same as Sunrise's "vs
  optimal" in the comparison.

### M11.2 Exploratory checks

```bash
npx tsx tests/manual/try.ts \
  "(() => { const s = ['a','b'].map(id => ({id,chainId:id,chainName:id,name:id,address:'',city:'',location:{lat:0,lng:0}})); const r = optimizePurchase([{key:'milk',label:'milk',quantity:1,productId:'m'},{key:'caviar',label:'caviar',quantity:1,productId:'c'}], s, {m:{a:1,b:5},c:{b:50}}, {maxStores:1,travelCostPerKm:0,travelMode:'driving',home:null}); return [r.bestPlan.storeIds, r.bestPlan.grandTotal, r.bestPlan.unavailableKeys]; })()" \
  "(() => { const s = ['a','b'].map(id => ({id,chainId:id,chainName:id,name:id,address:'',city:'',location:{lat:0,lng:0}})); const r = optimizePurchase([{key:'milk',label:'milk',quantity:1,productId:'m'},{key:'eggs',label:'eggs',quantity:1,productId:'e'}], s, {m:{a:2,b:2},e:{a:3,b:3}}, {maxStores:2,travelCostPerKm:0,travelMode:'driving',home:null}); return [r.bestPlan.storeIds, r.byStoreCount.length]; })()" \
  "(() => { const s = ['a','b'].map(id => ({id,chainId:id,chainName:id,name:id,address:'',city:'',location:{lat:0,lng:0}})); const r = optimizePurchase([{key:'milk',label:'milk',quantity:1,productId:'m'},{key:'caviar',label:'caviar',quantity:1,productId:'c'}], s, {m:{a:1},c:{b:100}}, {maxStores:2,travelCostPerKm:0,travelMode:'driving',home:null}); return [r.cheapestSingleStore.storeIds, r.bestPlan.storeIds, r.savingsVsSingleStore]; })()" \
  "optimizePurchase([], [], {}, {maxStores:3,travelCostPerKm:0,travelMode:'driving',home:null})"
```

| # | Case | Expected |
|---|---|---|
| 1 | maxStores 1: A is cheaper but has no caviar | `[["b"],55,[]]`: a dearer plan that buys everything beats a cheaper one that cannot |
| 2 | A and B cost the same | `[["a"],1]`: one store, the first listed (fewest stores, then earliest) |
| 3 | milk only at A (1.00), caviar only at B (100.00) | `[["a"],["a","b"],-100]`: savings can be negative (D-51) |
| 4 | no stores | every plan `null`, `byStoreCount` `[]`, savings `0` |

Not testable in the UI yet: see the end of M12.

## M12. Purchase optimisation with travel, and the ranking

Spec: TECH_SPEC 5.4. Decisions D-54 to D-57 (and D-47, D-52). With a home location each plan gets a
round trip from home through the stores it visits (ordered by `planRoute`):
`travelDistanceKm` = the route's total rounded to 2 decimals, `travelCost` = that distance x the cost
per km, rounded to cents, and `grandTotal` = items + travel. `storeIds` follow the route.

### M12.1 The golden basket with travel

The golden prices at the **real store locations** of `data/stores.csv` (the seeded app's
stores), home 29.2, -81.05 (near the town centre; an assumption for testing), 0.35 per km:

```bash
npx tsx tests/manual/optimize-travel.ts | diff tests/manual/optimize-travel.expected.md - && echo "M12.1 OK: no differences"
```

Expected: `M12.1 OK: no differences`, and in the output:

| Stores | Route (from home and back) | Items total | Distance | Travel cost | Grand total |
|---:|---|---:|---:|---:|---:|
| 1 | FreshMart | 135.51 | 4.33 km | 1.52 | 137.03 |
| 2 | FreshMart → GreenLeaf Market | 126.20 | 7.82 km | 2.74 | 128.94 |
| 3 | City Pantry → GreenLeaf Market → Corner Co-op | 119.97 | 11.22 km | 3.93 | **123.90** ← best |

Check by eye:
- **Travel cost = distance x 0.35, rounded**: 4.33 x 0.35 = 1.5155 -> 1.52; 11.22 x 0.35 = 3.927 -> 3.93.
- **Grand total = items + travel** in every row.
- **Travel changes the picks.** The table "free-travel winners, with the cost of reaching them" shows
  why: Sunrise alone is 0.90 cheaper on items than FreshMart but 1.37 dearer to reach (137.50 vs
  137.03); the free-travel 3-store plan (GreenLeaf, City Pantry, Sunrise: 119.36) costs 4.58 to reach
  and ends at 123.94, 4 cents more than the winner.
- The route of the winner, leg by leg: 3.02 + 2.68 + 3.60 km and 1.91 km back home. The legs shown add
  up to 11.21, the total is **11.22 km** (17 min): totals come from the unrounded legs (D-32).

Other settings: `--max 8` (the 6-store plan wins at 122.82, one cent below the 4-store plan: see
D-57); `--rate 0` (the free-travel picks come back: Sunrise; GreenLeaf + Sunrise; GreenLeaf, City
Pantry, Sunrise at 119.36); `--rate 2` (still 3 stores, but a closer trio: FreshMart → GreenLeaf →
City Pantry, 9.69 km, 141.36); `--home 29.18,-81.015` (next to Sunrise: Sunrise alone costs 0.05 to
reach, and the best plan is City Pantry → GreenLeaf → Sunrise at 122.95); `--walking` (same plans and
costs, durations about 8 times longer: 135 min for the winner).

### M12.2 The ranking and its tie-breaks

```bash
npx tsx tests/manual/optimize-ranking.ts | diff tests/manual/optimize-ranking.expected.md - && echo "M12.2 OK: no differences"
```

Expected: `M12.2 OK: no differences`; the last line is `RANKING SCENARIOS: 5 OK, 0 mismatched`. Each
scenario lists **every** candidate plan in ranking order, with the reason each ranks below the one
above. The ranking (spec 5.4), in order:

1. **Fewest items missing** (items no store of the plan sells). Decided first, before any price.
2. **Lowest grand total** (items + travel), in whole cents.
3. **Fewest stores.**
4. **Stores listed earliest** in the store list: the plans' store positions compared one by one,
   the first difference decides ({1st, 3rd} beats {2nd, 3rd}).

Within a plan, each item is bought at the plan's cheapest store for it; a tie goes to the store listed
first. Stores that end up buying nothing are dropped from the plan.

| Scenario | What to see |
|---|---|
| 1 | **A plan that cannot buy every item never beats one that can.** `near` costs 2.35 in total but has no coffee; `far` costs 26.00 (12.00 + 14.00 travel) and has everything: `far` is best, although it is 23.65 dearer. |
| 2 | With 2 stores allowed, near → far buys everything for 24.00 and beats far alone. |
| 3 | Four plans at 3.00: `c` alone wins (fewest stores); among the two-store plans, {a, b} beats {a, c} beats {b, c} (stores listed earliest). |
| 4 | {a, c} and {b, c} tie on total and count: {a, c} wins (a is listed before b). The three one-store plans tie at 8.00: `a` is `cheapestSingleStore`. |
| 5 | `far` saves 6.00 on items but the detour costs 7.00: `near` alone wins (102.70 vs 103.70). far and near → far tie at 103.70; far ranks higher (one store). |

### M12.3 What the result contains

| Field | Contains |
|---|---|
| `bestPlan` | The best plan with **at most** `maxStores` stores, by the ranking above. `null` only when there are no stores. |
| `cheapestSingleStore` | The best plan using **one** store, by the same ranking (so travel counts, and a store missing fewer items beats a cheaper one missing more: D-52). `null` only when there are no stores. |
| `byStoreCount` | For each number of stores k from 1 to `maxStores`, the best plan that **really buys from exactly k** stores, in increasing k. A k is missing when no set of k stores has every store buying something (e.g. two stores where one is never cheaper). Plans with no stores are never listed. |
| `savingsVsSingleStore` | `cheapestSingleStore.grandTotal - bestPlan.grandTotal` (can be negative: D-51). |
| `unpricedKeys` | Items with no catalog product, or sold by none of the stores: in no plan at all. |

Each plan (`ShoppingPlan`) has `storeIds` (in route order with a home), `stores` (what each store
buys, with unit price, line total and subtotal), `itemsTotal`, `travelDistanceKm`, `travelCost`,
`grandTotal`, `unavailableKeys` (items the plan cannot buy) and `route` (null without a home).

In the M12.1 example: `bestPlan` is the 3-store plan (123.90), `cheapestSingleStore` is FreshMart
(137.03), `byStoreCount` has the three rows of the table, and `savingsVsSingleStore` is 13.13.

**Travel time (D-57, decided).** Only money is ranked, so a much longer trip can win for a cent (6
stores, 30 min, vs 4 stores, 18 min, at `--max 8`). The product owner decided to keep the ranking
and **show the travel time of every option** so the user chooses. The data is already there (the
`Minutes` column of `optimize-travel.ts` is each option's `route.totalDurationMin`). This departs
from TECH_SPEC 7.2 (a Deviation); the product owner is updating the UI spec, and the plan page will
show it when it is built.

Not testable in the UI yet: the plan page (`/plan`) needs the API
(`GET /api/lists/:id/optimization`), and its components (`PlanSummary`, `StoreCountTable`,
`RouteMap`, ...) are still stubs.

## M13. Optimizer: timing, edge cases and brute-force cross-check

Spec: TECH_SPEC 5.4. Decisions D-48, D-57, D-58.

### M13.1 Timing (budget: 2 seconds)

```bash
npx tsx tests/manual/optimize-timing.ts
```

Expected: a table for the golden basket and for a worst case (every one of the 255 subsets visits
all its stores and needs its own route), 8 stores, 16 lines, maxStores 8, with a home; every row
`Under 2 s: yes`, exit 0. Numbers measured here (D-58): median about **35 ms**; first call of a
process 80-360 ms (JIT warm-up); the slowest single call seen was 1060 ms, once, while the machine
had heavy CPU steal. Your numbers will differ; anything in the tens of milliseconds is normal.

### M13.2 Edge cases a caller hits (nothing throws)

```bash
npx tsx tests/manual/optimize-edges.ts | diff tests/manual/optimize-edges.expected.md - && echo "M13.2 OK: no differences"
```

Expected: `M13.2 OK: no differences`; the last line is `EDGE CASES: 30 ran, 0 threw`. What each case
returns (the same without and with a home; with a home plans also carry a route):

| Case | Returns |
|---|---|
| no stores | `bestPlan` and `cheapestSingleStore` `null`, `byStoreCount` `[]`, savings 0, every item in `unpricedKeys` |
| no lines | plans with no stores and total 0 (not null); with a home a zero-length route; `byStoreCount` `[]` |
| an item nobody sells, sold only by a store not in the list, or whose only price is NaN | listed in `unpricedKeys`, in no plan; the other items are planned as usual |
| an item with no product | the same |
| every item unpriced | plans with no stores and total 0, every item in `unpricedKeys` |
| `maxStores` 0, -3, 0.5, -Infinity | treated as 1: one-store plans only |
| `maxStores` 10, Infinity (more than the 3 stores) | treated as 3 |

The one input that does throw is `maxStores` **NaN** (D-48): it cannot be clamped; the API answers 400
for a non-numeric `maxStores` before calling.

### M13.3 Cross-check against a brute force, for every maxStores

```bash
npx tsx tests/manual/optimize-bruteforce.ts | diff tests/manual/optimize-bruteforce.expected.md - && echo "M13.3 OK: no differences"
```

Expected: `M13.3 OK: no differences`; the last line is `BRUTE FORCE: 16 of 16 cases agree on every
field`. The instance (`tests/fixtures/optimizerSmall.ts`): 5 stores around home (North 1.11 km, East
2.22 km, South 1.67 km, Far 7.86 km, and West, the mirror image of East: same prices and distance,
listed last) and 8 items, including a price tie, a half-cent line (eggs x 1.5 at 1.99), an item only
two stores sell, an item with no product and one sold nowhere. The brute
force tries every assignment of items to stores and every visiting order and shares no code with
the optimizer. Check by eye that the two "best" columns are the same in every row, and:

- **Free travel**: Far alone (21.45) for 1 store; South + Far (21.09) for 2; East + South + Far
  (20.89) for 3 or more. With 4 stores allowed, the 4-store plan also costs 20.89, and the 3-store
  plan wins on fewer stores.
- **With a home**: Far alone (26.96 with travel) for 1 store; from 2 stores on, North + East (26.74)
  wins: close to home beats cheap but far. North + West costs exactly the same; East wins because it
  is listed first (the last tie-break).
- **maxStores -2 and 0** give the same as 1; **5 and 9** the same as 4.
