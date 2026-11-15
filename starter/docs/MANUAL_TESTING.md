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

Check: `npx tsc --version` prints `Version 5.6.3`, `npx jest --version` prints `29.7.0`, and
`npx eslint --version` prints `v9.12.0`.

### 0.2 Saving test logs

`tests/run-logged.sh <label> <command...>` runs a command, shows its output and saves it to
`logs/tests/<UTC timestamp>-<label>.log`, with a header (command, commit, number of uncommitted
paths, Node version) and a footer (exit code). The command's exit code is preserved. `logs/` is
git-ignored.

```bash
tests/run-logged.sh unit npm run test:unit
```

### 0.3 Tools for manual checks

| Tool | Use |
|---|---|
| `npx tsx tests/manual/try.ts "<expr>" ...` | Evaluates each expression with every export of `src/utils` in scope and prints the result as JSON (`-0`, `NaN` and `Infinity` are shown as such). Run it with no arguments to list the functions in scope. Functions not implemented yet print `!! not implemented`. |
| `npx tsx tests/manual/parse-line.ts "<line>" ...` | Prints a markdown table of what each line parses to. Reads stdin when no line is given; `--json` prints raw objects instead. |
| `npx tsx tests/manual/match.ts "<typed name>" ...` | For each typed name: its `normalizeName` form, the product `matchProduct` picks, and every other product sharing a word with it, with scores. Defaults to the test catalog `tests/fixtures/catalog.ts`; `--catalog data/products.csv` uses the seeded one, and `--threshold n` changes the threshold. |
| `npx tsx tests/manual/compare-golden.ts` | Runs `compareBasket` on the golden basket (16 products at 8 chains, from `tests/fixtures/spreadsheet.ts`), prints the matrix laid out like the reference spreadsheet, and checks every number of `GOLDEN_EXPECTED`. Exits 1 on a mismatch. |
| `npx tsx tests/manual/compare-edge.ts [scenario]` | Runs `compareBasket` on the edge-case scenarios of `tests/fixtures/comparisonScenarios.ts` and prints rows, store totals and summary as returned (unrounded). |
| `npx tsx tests/manual/parse-list.ts <file>...` | Parses whole files: `.txt` with `parseListText`, `.csv`/`.tsv` with `parseListCsv`; one table per file. `--text` or `--csv` reads stdin instead (for example `pbpaste \| npx tsx tests/manual/parse-list.ts --text`). |

## 1. Automated checks (run these first)

```bash
tests/run-logged.sh typecheck npm run typecheck
tests/run-logged.sh lint      npm run lint
tests/run-logged.sh unit      npm run test:unit
```

Expected as of M7 (with decisions D-14 and D-15): typecheck and lint exit 0 with no output;
`test:unit` passes **5 suites, 545 tests** (`money.test.ts` 59, `parseList.test.ts` 259,
`matching.test.ts` 102, `comparison.test.ts` 110, `server/src/services/__tests__/catalogMatch.test.ts` 15).

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
