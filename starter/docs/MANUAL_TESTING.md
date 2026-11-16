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
| Data layer, round 1 | `data/` feed files and catalog: inspection, no code yet | done | [M14](#m14-price-feed-files-data-layer-round-1-inspection) |
| Data layer, round 2 | `server/src/providers/types.ts`; `standard.ts` (`standardProvider`) | done | [M15](#m15-the-standard-feed-adapter-standardprovider) |
| Data layer, round 3 | `server/src/providers/cents.ts` (`centsProvider`) | done | [M16](#m16-the-cents-feed-adapter-centsprovider) |
| Data layer, round 4 | `server/src/providers/flyer.ts` (`flyerProvider`), `index.ts` (`getProvider`) | done | [M17](#m17-the-flyer-feed-adapter-and-getprovider) |
| Data layer, round 5 | execution logs: `server/src/logger.ts`; logging in the adapters and `getProvider` | done | [M18](#m18-execution-logs-for-feed-ingestion) |
| Data layer, round 6 | `fetchChainFeed`, `FeedSnapshot`, `MOCK_API_DIR` in `server/src/providers/index.ts` (TECH_SPEC 4.1 complete) | done | [M19](#m19-the-mocked-supermarket-api-fetchchainfeed) |
| Data layer, round 7 | `syncPrices` (4.2), `seedCatalog` (4.3), local Postgres; success logging confirmed | done | [M20](#m20-price-sync-syncprices-and-catalog-seed-seedcatalog) |
| Data layer, round 8 | failure isolation in one sync; `startPriceSyncScheduler` (4.2 complete); `errorMessage` | done | [M21](#m21-failure-isolation-and-the-scheduler) |
| Data layer, round 9 | `seedDemo`, `seed`, CLI: `npm run db:migrate`, `db:seed`, `db:reset`, `sync-prices` (TECH_SPEC 4 complete) | done | [M22](#m22-demo-data-seed-and-the-database-cli) |
| Next | HTTP API (TECH_SPEC 6), then the server process and the remaining UI | not started | |

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

This was needed again at the start of stage 2 and of data-layer round 2 (the unpacked tree had the
same problem both times; before the repair, `npx tsc --version` printed a global `Version 5.9.3`).

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
| `npx tsx tests/manual/feed.ts [--summary \| --raw [--sku <code>]...] [--provider <id>] <file.csv\|->...` | Runs a price feed adapter on feed files and prints the rows it returns (sku, price, regularPrice, onSale), the number skipped and **which lines** were skipped. The provider comes from the chain folder (`data/mock-api/<chain>/`) or `--provider`; `-` reads stdin. `--summary` prints one line per file. `--raw` prints **each raw line next to what the adapter returns** for it (or `skipped`); `--sku` (repeatable) keeps only those SKUs. The adapter comes from `getProvider`, so an unknown `--provider` prints its `Unknown price provider ...` error and exits 1. Each file is parsed with the process logger, so the run writes real execution logs (stderr and `logs/app/`; `LOG_CONSOLE=false` quiets stderr). The skipped lines (with their reasons) and the `--raw` view come from the records the adapter logged. |
| `npx tsx tests/manual/fetch-feed.ts [--data-dir <dir>] [--provider <id>] (--all \| <chain>...)` | Calls `fetchChainFeed` (the mocked supermarket API) for chains and prints, per snapshot, the date, rows, rows on sale, rows skipped and how many of the 16 golden SKUs it contains. The provider comes from `data/stores.csv` unless `--provider` is given. A rejected chain id prints the error and exits 1. Writes execution logs like the server. |
| `npx tsx tests/manual/sync-run.ts [--reset] [--syncs <n>] [--data-dir <dir>]` | Against `TEST_DATABASE_URL`: migrates, runs `seedCatalog`, runs `syncPrices` (n times), then prints what `syncPrices` returned, the `sync_runs` table, the row counts and `price_history` per chain. `--reset` empties the database first and is refused unless its name contains `test` (D-90). Writes execution logs. Exits 1 if a chain's run is `error`. |
| `npx tsx tests/manual/scheduler-run.ts [--minutes <n>] [--seconds <n>] [--fail-callback]` | Against `TEST_DATABASE_URL` (catalog already seeded): starts `startPriceSyncScheduler` with the interval, prints one line per completed sync from the after-sync callback, stops after the given seconds (waiting for a sync in progress), then prints how many `sync_runs` were added and whether any overlap. The scheduler's records (ticks, skips, failures) go to stderr and `logs/app/`. |
| `npx tsx tests/manual/golden-db.ts [--test]` | Reads `current_prices` (from `DATABASE_URL`, or `TEST_DATABASE_URL` with `--test`) for GS-001..GS-016 at the 8 chains and compares every cell of the 16 x 8 matrix, and the store totals, with `tests/fixtures/spreadsheet.ts`. Prints the matrix with a mark per cell (`*` = on sale); exits 1 on any difference. |
| `npx tsx tests/manual/parse-list.ts <file>...` | Parses whole files: `.txt` with `parseListText`, `.csv`/`.tsv` with `parseListCsv`; one table per file. `--text` or `--csv` reads stdin instead (for example `pbpaste \| npx tsx tests/manual/parse-list.ts --text`). |

### 0.4 Execution logs

Since data-layer round 5 the server code writes execution logs (D-76). Two kinds of log are kept
and they are different things:

| | Test logs | Execution logs |
|---|---|---|
| Written by | `tests/run-logged.sh` | the application (`server/src/logger.ts`) |
| Where | `logs/tests/<timestamp>-<label>.log` | `logs/app/grocerysave-<UTC date>.log` and stderr |
| Content | a command's full output | one JSON record per event: `time`, `level`, `component`, `event`, `message`, context |
| Settings | | `LOG_LEVEL`, `LOG_DIR`, `LOG_CONSOLE` (`.env.example`) |

Reading the execution log without extra tools:

```bash
grep '"level":"warn"\|"level":"error"' logs/app/grocerysave-*.log          # problems only
grep '"event":"row_skipped"' logs/app/grocerysave-*.log                       # skipped feed lines
```

Tests never write execution logs (D-79): under Jest the logger is silent unless `LOG_LEVEL` is set.

What `info` shows (D-85): one record for every unit of work that **succeeds** (`feed_parsed` per
file, `feed_fetched` per chain, `sync_chain_ok` per chain, `sync_finished` per run,
`catalog_seeded`), each with counts and `durationMs`, besides every warning and error. `debug` adds
per-row detail (`row_parsed`) and `provider_resolved`.

```bash
grep '"level":"info"' logs/app/grocerysave-*.log | grep -o '"event":"[a-z_]*"' | sort | uniq -c   # successes by kind
```

### 0.5 Local Postgres (data layer, round 7)

The API tests (`npm run test:api`), `tests/manual/sync-run.ts` and, later, the server need Postgres
13+. This machine had the PostgreSQL 16 binaries but no server, so a private cluster was created
(D-92). It lives outside the repository, in `~/.local/gs-postgres`, listens on localhost only and
uses the URLs of `.env.example`:

```bash
export PGDATA=$HOME/.local/gs-postgres
# once: create the cluster and the two databases
initdb -D "$PGDATA" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8
pg_ctl -D "$PGDATA" -l $HOME/.local/gs-postgres.log -o "-c listen_addresses=localhost -c port=5432 -c unix_socket_directories=/tmp" start
psql -h localhost -U postgres -c 'CREATE DATABASE grocerysave' -c 'CREATE DATABASE grocerysave_test'
# every session
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/grocerysave
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/grocerysave_test
# after a reboot: the start line above; to stop: pg_ctl -D "$PGDATA" stop
```

Check: `DATABASE_URL=... TEST_DATABASE_URL=... bash vm-selftest.sh` ends with `ALL OK`. `npm run
test:api` **wipes** `TEST_DATABASE_URL`; the test helpers refuse a database whose name does not
contain `test` (D-90).

## 1. Automated checks (run these first)

```bash
bash tests/run-logged.sh typecheck npm run typecheck
bash tests/run-logged.sh lint      npm run lint
bash tests/run-logged.sh unit      npm run test:unit
```

Expected as of M21 (data layer, round 8): typecheck and lint exit 0 with no output;
`test:unit` passes **19 suites, 1207 tests** (`money.test.ts` 59, `parseList.test.ts` 259,
`matching.test.ts` 102, `comparison.test.ts` 110, `route.test.ts` 68, `deals.test.ts` 47,
`optimizer.test.ts` 116,
`server/src/services/__tests__/catalogMatch.test.ts` 15,
`server/src/providers/__tests__/standard.test.ts` 119, `cents.test.ts` 72, `flyer.test.ts` 67,
`index.test.ts` 39, `parse.test.ts` 7, `logging.test.ts` 25, `fetchChainFeed.test.ts` 44,
`server/src/__tests__/logger.test.ts` 14, `server/src/__tests__/errors.test.ts` 15,
`server/src/jobs/__tests__/planPriceRows.test.ts` 7, `server/src/jobs/__tests__/scheduler.test.ts` 22).

With Postgres running (0.5):

```bash
bash tests/run-logged.sh api npm run test:api
```

Expected: **5 suites, 60 tests** (`server/tests/syncPrices.test.ts` 17, `seedCatalog.test.ts` 10,
`scheduler.test.ts` 4, `seed.test.ts` 18, `cli.test.ts` 11), in about 30 s. It empties
`TEST_DATABASE_URL` first.
The whole run takes about 10-20 s and writes no execution logs (D-79).

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

## M14. Price feed files (data layer, round 1: inspection)

Spec: TECH_SPEC 4. Decisions D-59 to D-69. **Nothing in the data layer is implemented yet.** These
checks confirm what the feed files contain, because the next rounds (adapters, sync, seed) depend on
it. They need only `bash`, `grep`, `awk` and `diff`, with no `node_modules`. Every expected output
below was produced on this repository.

To save a log of any step, wrap it: `bash tests/run-logged.sh m14-3 bash -c '<command>'`.

### M14.1 Inventory

```bash
for d in data/mock-api/*/; do printf '%-14s %s\n' "$(basename "$d")" "$(ls "$d" | tr '\n' ' ')"; done
```

Expected: 8 folders (`budgetbasket citypantry cornercoop freshmart greenleaf harvest sunrise
valugrocer`). Each holds exactly `2026-10-19.csv 2026-10-26.csv 2026-11-02.csv 2026-11-09.csv`,
four weekly snapshots, all Mondays, and nothing else. Every folder matches one chain in
`data/stores.csv` (8 chains, **one store each**). All 32 files are UTF-8 with no BOM, LF line endings
and a final newline, and they contain no quotes or blank lines (so the CRLF, BOM and quoting rules of
TECH_SPEC 4.1 will need synthetic test inputs).

### M14.2 The three formats

```bash
awk -F, 'NR>1{print $1, $3}' data/stores.csv | while read -r c p; do
  printf '%-13s %-9s %s\n' "$c" "$p" "$(head -1 "data/mock-api/$c/2026-11-09.csv")"; done
```

Expected:

```
freshmart     standard  sku,product_name,price,regular_price,on_sale
valugrocer    standard  sku,product_name,price,regular_price,on_sale
greenleaf     standard  sku,product_name,price,regular_price,on_sale
harvest       cents     item_code;description;price_cents;promo_price_cents
citypantry    cents     item_code;description;price_cents;promo_price_cents
budgetbasket  cents     item_code;description;price_cents;promo_price_cents
cornercoop    flyer     SKU,Name,Unit Price,Sale?,Was
sunrise       flyer     SKU,Name,Unit Price,Sale?,Was
```

What the delivered files actually look like, format by format (one sale row and one regular row
each):

| Format | Sale row | Regular row | Observed conventions |
|---|---|---|---|
| `standard` | `GS-006,Large Eggs dozen,4.99,5.89,true` | `GS-001,Whole Milk 1 gal,3.20,3.20,false` | dollars, always 2 decimals, no `$`; `regular_price` always filled (equal to `price` when not on sale); flags only `true`/`false`; names exactly as in `products.csv` |
| `cents` | `GS-012;SALMON FILLET 1 LB;949;790` (pays 7.90, regular 9.49) | `GS-001;WHOLE MILK 1 GAL;360;` | integer cents; a trailing `;` keeps the empty promo cell (always 4 fields); descriptions are the catalog names in UPPER CASE |
| `flyer` | `GS-003,Chicken Breast 2 lb,$9.13,Y,$11.49` | `GS-001,Whole Milk 1 gal,$3.46,N,` | `$` and 2 decimals; only `Y`/`N`; `Was` is filled on every `Y` row and empty (trailing comma) on every `N` row |

### M14.3 Rows outside the catalog or outside the usual shape

```bash
echo "== rows that do not start with a catalog SKU (GS-001..GS-040)"
grep -nvE '^GS-0(0[1-9]|[1-3][0-9]|40)[,;]' data/mock-api/*/*.csv | grep -vE '\.csv:1:'
echo "== standard rows not shaped sku,name,d.dd,d.dd,true|false"
grep -nvE '^[^,]*,[^,]*,[0-9]+\.[0-9]{2},[0-9]+\.[0-9]{2},(true|false)$' data/mock-api/{freshmart,valugrocer,greenleaf}/*.csv | grep -vE '\.csv:1:'
echo "== cents rows not shaped code;desc;cents;[cents]"
grep -nvE '^[^;]*;[^;]*;[1-9][0-9]*;([1-9][0-9]*)?$' data/mock-api/{harvest,citypantry,budgetbasket}/*.csv | grep -vE '\.csv:1:'
echo "== flyer rows not shaped SKU,Name,\$d.dd,Y,\$d.dd or ...,N,"
grep -nvE '^[^,]*,[^,]*,\$[0-9]+\.[0-9]{2},(Y,\$[0-9]+\.[0-9]{2}|N,)$' data/mock-api/{cornercoop,sunrise}/*.csv | grep -vE '\.csv:1:'
echo "M14.3 done"
```

Expected (exactly these lines under the headings; the `cents` and `flyer` sections are empty), exit 0:

```
== rows that do not start with a catalog SKU (GS-001..GS-040)
data/mock-api/budgetbasket/2026-11-09.csv:38:GS-999;DISCONTINUED ITEM;499;
data/mock-api/valugrocer/2026-11-09.csv:38:,Mystery Item,3.50,3.50,false
data/mock-api/valugrocer/2026-11-09.csv:39:GS-099,Broken Price Item,abc,abc,false
== standard rows not shaped sku,name,d.dd,d.dd,true|false
data/mock-api/valugrocer/2026-11-09.csv:39:GS-099,Broken Price Item,abc,abc,false
== cents rows not shaped code;desc;cents;[cents]
== flyer rows not shaped SKU,Name,$d.dd,Y,$d.dd or ...,N,
M14.3 done
```

All three odd rows are in the **latest** snapshots, the ones `current_prices` will show. The three
older snapshots of every chain are clean. What will happen to each row (D-59, D-66):

| Row | What is wrong | Adapter | Sync |
|---|---|---|---|
| `valugrocer` 2026-11-09 line 38 `,Mystery Item,3.50,...` | empty SKU | skipped (counted) | nothing written |
| `valugrocer` 2026-11-09 line 39 `GS-099,...,abc,abc,false` | price `abc`; the SKU is not in the catalog either | skipped (counted) | nothing written |
| `budgetbasket` 2026-11-09 line 38 `GS-999;DISCONTINUED ITEM;499;` | well-formed, but the SKU is not in the catalog | **returned** (not skipped) | ignored (unknown SKU) |

### M14.4 Sale prices are consistent

```bash
awk -F, 'FNR>1 && $3 ~ /^[0-9.]+$/ { if (($5=="true" && $4+0<=$3+0) || ($5=="false" && $4+0!=$3+0)) print FILENAME":"FNR": "$0 }' data/mock-api/{freshmart,valugrocer,greenleaf}/*.csv
awk -F';' 'FNR>1 && $4!="" && $4+0>=$3+0 { print FILENAME":"FNR": "$0 }' data/mock-api/{harvest,citypantry,budgetbasket}/*.csv
awk -F, 'FNR>1 { p=substr($3,2)+0; w=substr($5,2)+0; if (($4=="Y" && w<=p) || ($4=="N" && $5!="")) print FILENAME":"FNR": "$0 }' data/mock-api/{cornercoop,sunrise}/*.csv
echo "M14.4 done"
```

Expected: only `M14.4 done`. On every sale row the regular price is strictly higher than the price
paid, and on every other row the two are equal (or there is no `Was` / promo). The normalisation
of D-65 is therefore never triggered by the delivered data, and the adapter tests will cover it with
synthetic rows.

### M14.5 The latest snapshot reproduces the golden spreadsheet

Prints the price paid for `GS-001` to `GS-016` at the 8 chains (in `GOLDEN_CHAINS` order) from the
2026-11-09 files, and compares it with `tests/fixtures/spreadsheet.ts`:

```bash
feed_table() {
  for c in freshmart valugrocer greenleaf harvest citypantry budgetbasket cornercoop sunrise; do
    awk -v chain="$c" 'FNR>1 {
        if (index($0, ";")) { split($0, f, ";"); p = (f[4] != "" ? f[4] : f[3]) / 100 }
        else { split($0, f, ","); p = f[3]; sub(/^\$/, "", p) }
        if (f[1] ~ /^GS-0(0[1-9]|1[0-6])$/) printf "%s %s %.2f\n", f[1], chain, p
      }' "data/mock-api/$c/2026-11-09.csv"
  done | sort -s -k1,1 | awk '{ row[$1] = row[$1] " " $3 } END { for (k in row) print k row[k] }' | sort
}
golden_table() {
  sed -n "s/.*sku: '\(GS-0[0-9]*\)'.*prices: \[\(.*\)\] },/\1 \2/p" tests/fixtures/spreadsheet.ts |
    awk '{ out = $1; for (i = 2; i <= NF; i++) { v = $i; sub(/,$/, "", v); out = out sprintf(" %.2f", v) } print out }'
}
feed_table
diff <(feed_table) <(golden_table) && echo "M14.5 OK: 128 prices identical"
```

Expected: a 16-row table starting `GS-001 3.20 2.99 3.21 3.60 3.19 3.12 3.46 4.01`, then
`M14.5 OK: 128 prices identical`. The `cents` prices are the promo when there is one (Harvest
salmon 7.90, not 9.49), so the golden numbers of TECH_SPEC 9 use **the price paid**. All 8 chains
sell all 16 golden SKUs.

### M14.6 Reference numbers for the next rounds (not testable yet)

Worked out by hand from the files. They become checks once the adapters (round 2) and the sync
(round 3) exist.

Catalog coverage: each chain sells 34 to 37 of the 40 products, with the same SKU set in all four
weeks. The only change is `GS-999`, which appears at Budget Basket on 2026-11-09. Every product is
sold by at least 5 chains.

| Chain | Provider | Rows per snapshot (parsed / skipped) | `rows_ingested` after one sync (4 snapshots x 1 store) |
|---|---|---|---|
| freshmart | standard | 37 / 0 | 148 |
| valugrocer | standard | 36 / 0, and **36 / 2** on 2026-11-09 | 144 |
| greenleaf | standard | 35 / 0 | 140 |
| harvest | cents | 34 / 0 | 136 |
| citypantry | cents | 37 / 0 | 148 |
| budgetbasket | cents | 36 / 0, and **37 / 0** on 2026-11-09 (`GS-999` parsed, not ingested) | 144 |
| cornercoop | flyer | 35 / 0 | 140 |
| sunrise | flyer | 34 / 0 | 136 |
| **Total** | | | **1136** `price_history` rows; **284** `current_prices` rows |

Price drops of 10% or more between 2026-11-02 and 2026-11-09 are what `detectDeals` will report at
the default threshold once prices are synced. There are 9:

| Chain | Product | 11-02 | 11-09 | Drop | On sale |
|---|---|---|---|---|---|
| cornercoop | GS-003 Chicken Breast 2 lb | 11.49 | 9.13 | 20.54% | yes |
| greenleaf | GS-008 Butter 1 lb | 4.79 | 3.90 | 18.58% | yes |
| harvest | GS-012 Salmon Fillet 1 lb | 9.49 | 7.90 | 16.75% | yes |
| freshmart | GS-006 Large Eggs dozen | 5.89 | 4.99 | 15.28% | yes |
| sunrise | GS-010 Toilet Paper 12 rolls | 10.49 | 8.90 | 15.16% | yes |
| sunrise | GS-001 Whole Milk 1 gal | 4.69 | 4.01 | 14.50% | yes |
| budgetbasket | GS-005 Cheddar Cheese 1 lb | 9.29 | 7.99 | 13.99% | no |
| valugrocer | GS-016 Pasta Sauce 24 oz | 4.99 | 4.30 | 13.83% | no |
| citypantry | GS-011 Bananas 1 lb | 5.79 | 4.99 | 13.82% | no |

Note: TECH_SPEC 6.3 gives as an example the notification "Butter 1 lb is 22% cheaper at GreenLeaf
Market", with $5.00 and $3.90. The feeds give 4.79 to 3.90, so the real notification will say
**19%** and **$4.79**. The spec's figures are only an example and should not be used as expected
values.

## M15. The `standard` feed adapter (`standardProvider`)

Spec: TECH_SPEC 4 and 4.1. Decisions D-60 to D-66 and D-70 to D-72. Files:
`server/src/providers/types.ts` (`ProviderPriceRow`, `ProviderParseResult`, `PriceProvider`),
`server/src/providers/standard.ts` (`standardProvider`), `server/src/providers/parse.ts` (shared
rules, internal). Tests: `server/src/providers/__tests__/standard.test.ts`.

Not testable yet: `cents` and `flyer` feeds, `getProvider`, `fetchChainFeed`, and anything in the
database or the UI (no sync yet, so no prices reach `price_history`).

### M15.1 The unit tests, listed by name

```bash
bash tests/run-logged.sh standard-verbose npx jest --selectProjects unit --testPathPattern server/src/providers/__tests__/standard --verbose
```

Expected: `Tests: 119 passed, 119 total` (118 in round 2; D-74 split one test into two in round 4).
The first group, **"standardProvider: the requested
cases"**, has one test for each case the product owner asked for. Each checks the whole result
(`rows` and `skipped`), not just one field:

| Test | Input (after the header) | Result |
|---|---|---|
| a normal row | `GS-001,Whole Milk 1 gal,3.20,3.20,false` | 1 row: 3.20 / 3.20, not on sale; 0 skipped |
| a sale row | `GS-006,Large Eggs dozen,4.99,5.89,true` | price 4.99 (paid), regularPrice 5.89, on sale |
| an empty regular price | `GS-008,Butter 1 lb,5.99,,false` (and `,true`) | regularPrice = price = 5.99 |
| a blank SKU | `,Mystery Item,3.50,3.50,false` (and a SKU of spaces) | 0 rows, 1 skipped |
| a non-numeric price | `abc`, `n/a`, empty | 0 rows, 1 skipped |
| a zero price | `0`, `0.00` | 0 rows, 1 skipped |
| an unrecognised sale flag | `maybe`, `on sale` | 0 rows, 1 skipped |
| a short row | `GS-001,Whole Milk 1 gal,3.20,3.20` (no `on_sale` cell), `GS-001` | 0 rows, 1 skipped |
| the wrong header | `cost` instead of `price` (2 rows); a `cents` feed | 0 rows, every data row skipped (2; 1) |
| an empty feed | `''` | `{ rows: [], skipped: 0 }` |
| mixed feed | 3 good and 5 bad rows | the 3 good rows in file order, 5 skipped |

The other groups cover amounts, flags, sale normalisation, SKUs, the header, the file shape (CRLF,
BOM, quotes, blank lines), "never throws" (including 300 random feeds) and the delivered files. The
test titles say what each one checks.

The tests were also checked against deliberate bugs: `bash logs/tests/standard-mutations.sh`
(a local script in the git-ignored `logs/`) breaks the adapter in 17 ways, one at a time, and
restores it afterwards. Every one makes at least one test fail (`survivors: 0`); see
`logs/tests/*-standard-mutations.log`.

### M15.2 The delivered `standard` feeds

```bash
npx tsx tests/manual/feed.ts --summary data/mock-api/{freshmart,valugrocer,greenleaf}/*.csv \
  | diff tests/manual/feed-standard-summary.expected.md - && echo "M15.2a OK: no differences"
npx tsx tests/manual/feed.ts data/mock-api/valugrocer/2026-11-09.csv \
  | diff tests/manual/feed-valugrocer-2026-11-09.expected.md - && echo "M15.2b OK: no differences"
```

Expected: both `OK` lines. The summary matches M14.6. FreshMart has 37 rows in every week,
ValuGrocer 36 and GreenLeaf 35, and only `valugrocer/2026-11-09.csv` has skipped rows (2). To see
them:

```bash
npx tsx tests/manual/feed.ts data/mock-api/valugrocer/2026-11-09.csv | tail -4
```

Expected (since round 5 each line also shows the reason the adapter logged, M18):

```
Skipped lines (2):
- line 38: `,Mystery Item,3.50,3.50,false`: empty_sku, SKU is empty
- line 39: `GS-099,Broken Price Item,abc,abc,false`: invalid_price, price "abc" is not a positive amount
```

The tool also prints the execution log on stderr while it runs. Add `LOG_CONSOLE=false` in front
of the command to see only its report.

The expected files were not just copied from the tool. Before they were saved, all 432 rows of the
12 files were compared field by field with an independent Python parser from round 1
(`logs/tests/*-standard-xcheck-independent.log`): 0 differences. The 2026-11-09 prices of
`GS-001` to `GS-016` are also checked against `tests/fixtures/spreadsheet.ts` by the unit tests.

### M15.3 Exploratory checks (type your own feed)

Pipe any text into the tool with `--provider standard -`. Set `H` first:

```bash
H='sku,product_name,price,regular_price,on_sale'
printf "$H\r\nGS-001,Milk,\$4.01,\$4.69,TRUE\r\n" | npx tsx tests/manual/feed.ts --provider standard -
```

| # | What to pipe in (`printf "..."`) | Expected | Why |
|---|---|---|---|
| 1 | `$H\r\nGS-001,Milk,\$4.01,\$4.69,TRUE\r\n` | 1 row: 4.01 / 4.69, on sale | CRLF, `$` prefix and upper-case flags are accepted (D-60, D-63, D-64) |
| 2 | `$H\nGS-001,Milk,1.999,,false\n` | 0 rows, 1 skipped (line 2) | at most two decimals (D-63) |
| 3 | `$H\nGS-001,Milk,3.00,2.00,true\n` | 1 row: 3.00 / **3.00**, on sale | on sale, regular below price: raised to the price (D-65) |
| 4 | `$H\nGS-001,Milk,3.00,3.50,false\n` | 1 row: 3.00 / **3.00**, not on sale | not on sale: regular = price (D-65) |
| 5 | `$H\nGS-001,Milk,3.20,3.20\n` | 0 rows, 1 skipped | too few fields (D-62) |
| 6 | `PRICE,On_Sale,SKU,Regular_Price\n3.20,no,GS-001,\n` | 1 row: 3.20 / 3.20, not on sale | header matched ignoring case and order; `product_name` optional (D-61) |
| 7 | `item_code;description;price_cents;promo_price_cents\nGS-001;MILK;360;\n` | 0 rows, 1 skipped | a `cents` feed lacks the standard columns: every row skipped |
| 8 | (nothing: `printf ''`) | 0 rows, 0 skipped | empty feed |
| 9 | the whole command: `printf '%s\n' "$H" '"GS-001","Milk, whole",3.20,3.20,false' \| npx tsx tests/manual/feed.ts --provider standard -` | 1 row: 3.20 / 3.20 | quoted fields; the comma inside the name is data (D-60) |
| 10 | `$H\nGS-001,Milk,100000000.00,,false\nGS-002,Oil,99999999.99,,false\n` | 1 row (GS-002), 1 skipped (line 2) | largest amount 99,999,999.99 (D-70) |

Everything skipped is listed under `Skipped lines` with its line number. `parse` never throws: if
you manage to make the tool crash with a stack trace that starts in `server/src/providers`, that is
a bug.

## M16. The `cents` feed adapter (`centsProvider`)

Spec: TECH_SPEC 4 and 4.1. Decisions D-60 to D-66 and D-70 to D-73. File:
`server/src/providers/cents.ts`. Tests: `server/src/providers/__tests__/cents.test.ts`.

Format: `item_code;description;price_cents;promo_price_cents`, separated by semicolons, amounts in
whole cents. **The promo column changes what `price_cents` means:**

| Promo cell | `price` (what you pay) | `regularPrice` | `onSale` |
|---|---|---|---|
| empty | `price_cents` / 100 | same as `price` | no |
| a positive whole number | promo / 100 | `price_cents` / 100 (raised to the price if the promo is not lower, D-65) | yes |
| anything else (`7.90`, `0`, `abc`) | row skipped and counted (D-73) | | |

Not testable yet: `flyer` feeds, `getProvider`, `fetchChainFeed`, the database and the UI.

### M16.1 The unit tests

```bash
bash tests/run-logged.sh cents-verbose npx jest --selectProjects unit --testPathPattern server/src/providers/__tests__/cents --verbose
```

Expected: `Tests: 72 passed, 72 total`. The first group, **"centsProvider: the requested cases"**:

| Test | Input (after the header) | Result |
|---|---|---|
| CRLF line endings | milk and salmon lines ending in `\r\n` | both rows; the `\r` does not end up in the empty promo cell |
| a promo row | `GS-012;SALMON FILLET 1 LB;949;790` | price 7.90, regularPrice 9.49, on sale |
| cents given as `3.99` | `GS-001;WHOLE MILK 1 GAL;3.99;` (and with a promo) | 0 rows, 1 skipped |
| a bad promo | promo `abc`, `7.90`, `0`, `-790`, `n/a` | 0 rows, 1 skipped each (not read as "no promo") |
| a blank item code | `;WHOLE MILK 1 GAL;360;` (and a code of spaces) | 0 rows, 1 skipped |
| a zero price | `0`, `000`, and `0` with a promo | 0 rows, 1 skipped |
| mixed feed | 3 good and 5 bad rows | the 3 good rows in file order, 5 skipped |

The next group shows the column-meaning rule directly: `949;` gives 9.49 not on sale, and `949;790`
gives 7.90 with a regular price of 9.49. It also covers a promo equal to `price_cents` (on sale, no
discount) and a promo above it (the promo is paid, as the product owner decided).

Deliberate-bug check: `bash logs/tests/cents-mutations.sh` breaks `cents.ts` in 11 ways (for
example the two columns swapped, a bad promo read as "no promo", `price_cents` read as dollars, a
comma delimiter) and every one makes tests fail (`survivors: 0`; `logs/tests/*-cents-mutations.log`).

### M16.2 Sale rows in a real file: the raw line next to what the adapter returns

```bash
npx tsx tests/manual/feed.ts --raw --sku GS-012 --sku GS-040 --sku GS-001 data/mock-api/harvest/2026-11-09.csv
```

Expected:

| line | raw text | sku | price | regularPrice | onSale |
|---|---|---|---|---|---|
| 2 | `GS-001;WHOLE MILK 1 GAL;360;` | GS-001 | 3.60 | 3.60 | no |
| 13 | `GS-012;SALMON FILLET 1 LB;949;790` | GS-012 | 7.90 | 9.49 | yes |
| 35 | `GS-040;BABY WIPES 72 COUNT;811;705` | GS-040 | 7.05 | 8.11 | yes |

followed by `Whole file: 34 rows (4 on sale), 0 skipped`. Check by eye that the **last** number of
each sale line is the price and the one before it is the regular price. The salmon's 7.90 is the
Harvest price in the golden spreadsheet (TECH_SPEC 9), which uses the price paid. Try other sale
rows: `GS-030` and `GS-036` at `citypantry`, and `GS-035` and `GS-040` at `budgetbasket`
(2026-11-09).

### M16.3 The delivered `cents` feeds

```bash
npx tsx tests/manual/feed.ts --summary data/mock-api/{harvest,citypantry,budgetbasket}/*.csv \
  | diff tests/manual/feed-cents-summary.expected.md - && echo "M16.3a OK: no differences"
npx tsx tests/manual/feed.ts --raw data/mock-api/harvest/2026-11-09.csv \
  | diff tests/manual/feed-harvest-2026-11-09-raw.expected.md - && echo "M16.3b OK: no differences"
```

Expected: both `OK` lines. Harvest has 34 rows in every week, City Pantry 37, and Budget Basket 36,
then 37 on 2026-11-09: `GS-999` is well-formed, so it is returned (the sync will ignore it because
it is not in the catalog). Nothing is skipped in any `cents` file. Before the expected files were
saved, all 429 rows were compared field by field with the independent Python parser from round 1:
0 differences (`logs/tests/*-cents-xcheck-independent.log`).

### M16.4 Exploratory checks (type your own feed)

```bash
H='item_code;description;price_cents;promo_price_cents'
printf "$H\r\nGS-012;SALMON;949;790\r\nGS-001;MILK;360;\r\n" | npx tsx tests/manual/feed.ts --raw --provider cents -
```

| # | What to pipe in (`printf "..."`) | Expected | Why |
|---|---|---|---|
| 1 | `$H\r\nGS-012;SALMON;949;790\r\nGS-001;MILK;360;\r\n` | 7.90 / 9.49 on sale; 3.60 / 3.60 not on sale | CRLF; the promo changes the meaning |
| 2 | `$H\nGS-001;MILK;3.99;\n` | skipped | cents must be whole numbers |
| 3 | `$H\nGS-012;SALMON;949;7.90\n` | skipped | bad promo |
| 4 | `$H\n;MILK;360;\n` | skipped | blank item code |
| 5 | `$H\nGS-001;MILK;0;\n` | skipped | zero price |
| 6 | `$H\nGS-001;MILK;360\n` | skipped | no trailing `;`: too few fields (D-62) |
| 7 | `$H\nGS-012;SALMON;790;949\n` | 9.49 / 9.49 on sale | a promo above the regular price is still what you pay (D-65) |
| 8 | `$H\nGS-012;SALMON;949;949\n` | 9.49 / 9.49 on sale | a promo equal to the regular price: on sale, no discount |
| 9 | `sku,product_name,price,regular_price,on_sale\nGS-001,Milk,3.20,3.20,false\n` | skipped | a `standard` file has none of the `cents` columns |
| 10 | `$H\nGS-001;MILK, WHOLE;360;\n` | 3.60 / 3.60 | a comma is data in this format |

## M17. The `flyer` feed adapter and `getProvider`

Spec: TECH_SPEC 4 and 4.1. Decisions D-60 to D-66, D-68 and D-70 to D-74. Files:
`server/src/providers/flyer.ts` (`flyerProvider`), `server/src/providers/index.ts` (`getProvider`).
Tests: `server/src/providers/__tests__/flyer.test.ts`, `index.test.ts`.

Format: `SKU,Name,Unit Price,Sale?,Was`, comma-separated, prices like `$4.01` (the `$` is
optional). `Unit Price` is what you pay:

| `Sale?` | `Was` | `price` | `regularPrice` | `onSale` |
|---|---|---|---|---|
| `Y` (or `y`, `yes`, `true`, `1`) | `$11.49` | unit price | 11.49 (raised to the price if lower, D-65) | yes |
| `Y` | empty | unit price | **= price** (spec) | yes |
| `N` (or `n`, `no`, `false`, `0`, empty) | empty or a valid amount | unit price | = price (a `Was` is ignored, D-65) | no |
| any | present but invalid (`abc`, `$0.00`, `11,49`) | row skipped and counted | | |
| anything else (`maybe`) | | row skipped and counted | | |

A row without its `Was` cell (`GS-001,Milk,$3.46,N`, no trailing comma) is skipped (D-62, product
owner decision). No delivered file has a sale without a `Was`, or a `Was` on a non-sale row, so
those cases are tested with inline feeds only.

Not testable yet: `fetchChainFeed`, the database and the UI.

### M17.1 The unit tests

```bash
bash tests/run-logged.sh flyer-index-verbose npx jest --selectProjects unit --testPathPattern 'server/src/providers/__tests__/(flyer|index)' --verbose
```

Expected: `Tests: 106 passed, 106 total` (flyer 67, index 39). The requested `flyer` cases, in
**"flyerProvider: the requested cases"**:

| Test | Input (after the header) | Result |
|---|---|---|
| a sale with no "was" price | `GS-003,Chicken Breast 2 lb,$9.13,Y,` (and a `Was` of spaces) | on sale, price 9.13, regularPrice 9.13 |
| a bad "was" | `abc`, `n/a`, `$1.999`, `$0.00`, `$-11.49`, `$ 11.49`, `"$11,49"`, each with `Y` and with `N` | skipped and counted (14 cases) |
| a bad flag | `maybe`, `S`, `sale`, `Y/N`, `?`, `YN`, `2` | skipped and counted |
| a non-numeric price | `abc`, `$abc`, `n/a`, `$`, empty, `FREE`, `$4.01.5` | skipped and counted |
| mixed feed | 3 good rows and 6 bad ones | the 3 good rows in file order, 6 skipped |

`getProvider`, in **"getProvider: unknown ids throw ..."**: each of 25 string ids throws an
`Error` whose message starts with `Unknown price provider` and quotes the id. The ids are near
misses (`Standard`, `' standard'`), every key inherited from `Object.prototype` (`toString`,
`constructor`, `__proto__`, `hasOwnProperty`, ...) and the `Map` methods (`get`, `has`, `size`).
Seven non-string ids also throw that `Error`, never a `TypeError`, including `['standard']` and an
object whose `toString()` returns `'cents'`.

### M17.2 Why a `Map`: the evidence

```bash
npx tsx logs/tests/getprovider-naive-vs-map.ts
```

(A local script in the git-ignored `logs/`.) It runs the same ids through a naive plain-object
registry and through `getProvider`:

| id | plain-object registry | getProvider (Map) |
|---|---|---|
| `"flyer"` | returns adapter "flyer" | returns adapter "flyer" |
| `"toString"` | returns a FUNCTION (toString) | throws Error: Unknown price provider "toString" (known: standard, cents, flyer) |
| `"constructor"` | returns a FUNCTION (Object) | throws Error: Unknown price provider "constructor" ... |
| `"__proto__"` | returns [object Object] | throws Error: Unknown price provider "__proto__" ... |
| `"hasOwnProperty"` | returns a FUNCTION (hasOwnProperty) | throws Error: ... |
| `["standard"]` (array) | returns adapter "standard" | throws Error: Unknown price provider (object) ... |
| `Symbol("x")` | throws TypeError: Cannot convert a Symbol value to a string | throws Error: Unknown price provider (symbol) ... |

and then `naive, then .parse(): TypeError: naiveGetProvider(...).parse is not a function`. With the
naive registry, a chain whose provider is `toString` would get past the lookup and crash later,
inside the sync, with a message that does not name the provider. TECH_SPEC 4.2 requires the failed
run's message to contain the provider id.

From the manual tool (any feed file):

```bash
npx tsx tests/manual/feed.ts --provider toString data/mock-api/sunrise/2026-11-09.csv; echo "exit $?"
```

Expected: `data/mock-api/sunrise/2026-11-09.csv: Unknown price provider "toString" (known: standard,
cents, flyer)`, then `exit 1`. Try `constructor`, `Flyer` and `' flyer'` too: all unknown.

### M17.3 Sale rows in a real file: the raw line next to what the adapter returns

```bash
npx tsx tests/manual/feed.ts --raw --sku GS-001 --sku GS-003 --sku GS-018 data/mock-api/cornercoop/2026-11-09.csv
```

Expected:

| line | raw text | sku | price | regularPrice | onSale |
|---|---|---|---|---|---|
| 2 | `GS-001,Whole Milk 1 gal,$3.46,N,` | GS-001 | 3.46 | 3.46 | no |
| 4 | `GS-003,Chicken Breast 2 lb,$9.13,Y,$11.49` | GS-003 | 9.13 | 11.49 | yes |
| 19 | `GS-018,Roma Tomatoes 1 lb,$2.48,Y,$2.85` | GS-018 | 2.48 | 2.85 | yes |

followed by `Whole file: 35 rows (4 on sale), 0 skipped`. The chicken at 9.13 is Corner Co-op's
price in the golden spreadsheet, and the biggest deal of the week (-20.54%, M14.6).

### M17.4 The delivered `flyer` feeds

```bash
npx tsx tests/manual/feed.ts --summary data/mock-api/{cornercoop,sunrise}/*.csv \
  | diff tests/manual/feed-flyer-summary.expected.md - && echo "M17.4a OK: no differences"
npx tsx tests/manual/feed.ts --raw data/mock-api/cornercoop/2026-11-09.csv \
  | diff tests/manual/feed-cornercoop-2026-11-09-raw.expected.md - && echo "M17.4b OK: no differences"
```

Expected: both `OK` lines. Corner Co-op has 35 rows in every week and Sunrise 34; nothing is
skipped. Before the expected files were saved, all 276 rows were compared field by field with the
independent Python parser from round 1: 0 differences (`logs/tests/*-flyer-xcheck-independent.log`).

### M17.5 Exploratory checks (type your own feed)

In `printf "..."`, write `\$` for a literal dollar sign.

```bash
H='SKU,Name,Unit Price,Sale?,Was'
printf "$H\nGS-003,Chicken,\$9.13,Y,\n" | npx tsx tests/manual/feed.ts --raw --provider flyer -
```

| # | What to pipe in | Expected | Why |
|---|---|---|---|
| 1 | `$H\nGS-003,Chicken,\$9.13,Y,\n` | 9.13 / 9.13, on sale | a sale with no `Was` (spec) |
| 2 | `$H\nGS-003,Chicken,\$9.13,Y,abc\n` | skipped | bad `Was` |
| 3 | `$H\nGS-003,Chicken,\$9.13,maybe,\$11.49\n` | skipped | bad flag |
| 4 | `$H\nGS-001,Milk,\$abc,N,\n` | skipped | non-numeric price |
| 5 | `$H\nGS-001,Milk,\$3.46,N,\$4.00\n` | 3.46 / 3.46, not on sale | a `Was` on a non-sale row is ignored (D-65) |
| 6 | `$H\nGS-001,Milk,\$3.46,N\n` | skipped | no `Was` cell: too few fields (D-62) |
| 7 | `$H\nGS-003,Chicken,\$9.13,Y,11,49\n` | skipped | an unquoted decimal comma makes an extra cell (D-74), so this is not read as $11 |
| 8 | `$H\r\nGS-003,Chicken,9.13,y,11.49\r\n` | 9.13 / 11.49, on sale | CRLF, no `$`, lower-case flag |
| 9 | `$H\nGS-003,Chicken,\$9.13,Y,\$8.00\n` | 9.13 / 9.13, on sale | `Was` below the price is raised to it (D-65) |

### M17.6 The deliberate-bug check

```bash
bash logs/tests/flyer-index-mutations.sh
```

(A local script in the git-ignored `logs/`; it restores every file it touches.) It breaks
`flyer.ts`, `getProvider` and the D-74 rule in 19 ways. Examples: a sale with no `Was` skipped, a
bad `Was` ignored, `Was` read as the price paid, a plain-object lookup, case-insensitive or trimmed
ids, a message without the `Unknown price provider` prefix. Expected last line: `unexpected
survivors: 0; expected survivors (allowed by the spec): 1`. The allowed one throws a `RangeError`
instead of a plain `Error`. The spec only asks for "an `Error`", and a `RangeError` is one, so the
tests deliberately do not pin the class.

## M18. Execution logs for feed ingestion

Spec: none (product owner's rule, round 5: *"always implement logs"*). Decisions D-74 to D-80. Files:
`server/src/logger.ts` (the logger), `server/src/providers/parse.ts` (what the adapters log, and
line numbers), `server/src/providers/index.ts` (`getProvider` logs unknown ids). Tests:
`server/src/__tests__/logger.test.ts`, `server/src/providers/__tests__/logging.test.ts` and
`parse.test.ts`. Where the logs go and how to read them: section 0.4.

What is logged (D-77), per feed file:

| Event | Level | When | Main fields |
|---|---|---|---|
| `row_skipped` | warn | every malformed row | `source`, `line`, `reason`, `detail`, `raw` |
| `row_adjusted` | warn | a row normalised by D-65 (regular price raised or ignored) | `line`, `sku`, `raw` |
| `header_invalid` | error | the header lacks required columns (every row is lost) | `missing`, `header`, `skipped` |
| `feed_empty` / `input_not_text` | warn | no header line / not text | |
| `feed_parsed` | info | once per file | `rows`, `skipped`, `adjusted`, `onSale`, `durationMs` |
| `row_parsed` | debug | each row read | `line`, `raw`, `sku`, `price`, `regularPrice`, `onSale` |
| `unknown_provider` | error | `getProvider` with an unknown id, before it throws | `id`, `known` |

Reason codes: `too_few_fields`, `extra_cells` (D-74), `empty_sku`, `invalid_price`,
`invalid_regular_price`, `invalid_promo`, `invalid_was`, `invalid_flag`.

### M18.1 The unit tests

```bash
bash tests/run-logged.sh logging-verbose npx jest --selectProjects unit --testPathPattern '(logger|providers/__tests__/(logging|parse))' --verbose
```

Expected: `Tests: 45 passed, 45 total` (logger 14, logging 24, parse 7). Look for:

- **"a skipped row is logged with its line number and reason"**: one test per format covers every
  reason code, checking line, reason and raw text. One test checks a whole record field by field.
  Another checks that the number of `row_skipped` records equals `skipped`.
- **"line numbers follow the file"**: blank lines, CRLF and a quoted name spanning two lines still
  give the line an editor shows.
- **"splitRecords ... on random text"**: on 3,000 random texts, splitting with line numbers never
  changes what `parseCsv` returns (D-75).
- **"the delivered feeds"**: all 32 files at the warn level log exactly the two known ValuGrocer
  rows, nothing else.
- **"tests not silent"**, **"a folder that cannot be written"**, **"a sink that throws"**: logging
  never breaks ingestion and never writes files during tests.

### M18.2 A skipped line in the execution log

Use a throwaway log folder so you see exactly what one run writes:

```bash
rm -rf /tmp/gs-m18 && LOG_DIR=/tmp/gs-m18 LOG_CONSOLE=false npx tsx tests/manual/feed.ts --summary data/mock-api/valugrocer/2026-11-09.csv
ls /tmp/gs-m18; wc -l /tmp/gs-m18/*.log
grep -h '"event":"row_skipped"' /tmp/gs-m18/grocerysave-*.log
```

Expected: the summary line `... 36 rows (1 on sale), 2 skipped`. Then one file,
`grocerysave-<today>.log`, with 3 lines (two `row_skipped` and one `feed_parsed`), and these two
records (your `time` differs):

```
{"time":"...","level":"warn","component":"app.providers.standard","event":"row_skipped","message":"data/mock-api/valugrocer/2026-11-09.csv line 38 skipped: SKU is empty","provider":"standard","source":"data/mock-api/valugrocer/2026-11-09.csv","line":38,"reason":"empty_sku","detail":"SKU is empty","raw":",Mystery Item,3.50,3.50,false"}
{"time":"...","level":"warn","component":"app.providers.standard","event":"row_skipped","message":"data/mock-api/valugrocer/2026-11-09.csv line 39 skipped: price \"abc\" is not a positive amount","provider":"standard","source":"data/mock-api/valugrocer/2026-11-09.csv","line":39,"reason":"invalid_price","detail":"price \"abc\" is not a positive amount","raw":"GS-099,Broken Price Item,abc,abc,false"}
```

Check the line numbers against the file: `sed -n '38,39p' data/mock-api/valugrocer/2026-11-09.csv`.

### M18.3 All 32 delivered files: only the known problems

```bash
LOG_LEVEL=warn LOG_DIR= npx tsx tests/manual/feed.ts --summary data/mock-api/*/*.csv 2>&1 >/dev/null
```

(`2>&1 >/dev/null` keeps the log on stderr and drops the report.) Expected: exactly two `WARN`
lines, for `valugrocer/2026-11-09.csv` lines 38 (`SKU is empty`) and 39 (`price "abc" is not a
positive amount`). Budget Basket's `GS-999` is a valid row, so nothing is logged for it (the sync
will decide what to do with unknown SKUs).

### M18.4 Every reason, from your own feed

```bash
H='SKU,Name,Unit Price,Sale?,Was'
printf "$H\nGS-003,Chicken,\$9.13,Y,11,49\nGS-001,\"Milk\nwhole\",\$3.46,N,\$4.00\n\n,x,\$1,N,\n" \
  | LOG_DIR= npx tsx tests/manual/feed.ts --raw --provider flyer -
```

Expected on stdout: line 2 `**skipped** (extra_cells)`, line 3 (the quoted name spans lines 3-4)
`GS-001 3.46 3.46 no`, and line 6 `**skipped** (empty_sku)`. Line 5 is blank and not a row. On
stderr:

```
... WARN  app.providers.flyer row_skipped: stdin line 2 skipped: 1 non-empty cell(s) beyond the 5 header columns ("49") {...}
... WARN  app.providers.flyer row_adjusted: stdin line 3 (GS-001): regular price 4.00 differs from the price 3.46 on a row not on sale: ignored {...}
... WARN  app.providers.flyer row_skipped: stdin line 6 skipped: SKU is empty {...}
... INFO  app.providers.flyer feed_parsed: stdin: 1 row (0 on sale), 2 skipped, 1 adjusted {...}
```

Try the other reasons by changing the data line: `$abc` (invalid_price), `maybe` as the flag
(invalid_flag), `abc` as `Was` (invalid_was), or drop the trailing comma (too_few_fields).

### M18.5 A whole file lost: the header does not match

```bash
LOG_DIR= npx tsx tests/manual/feed.ts --provider standard --summary data/mock-api/harvest/2026-11-09.csv 2>&1 >/dev/null
```

Expected: one `ERROR ... header_invalid: data/mock-api/harvest/2026-11-09.csv line 1: the header
lacks "sku", "price", "regular_price", "on_sale"; all 34 data rows skipped (lines 2-35)`, then the
`INFO ... feed_parsed: ... 0 rows, 34 skipped` summary. There is one record for the header, not 34
row warnings.

### M18.6 Unknown provider

```bash
LOG_DIR= npx tsx tests/manual/feed.ts --provider toString data/mock-api/sunrise/2026-11-09.csv
```

Expected: `ERROR app.providers unknown_provider: Unknown price provider "toString" (known: standard,
cents, flyer) {"id":"toString","known":["standard","cents","flyer"]}` on stderr, then the tool's own
line with the same message, and exit code 1.

### M18.7 Settings

| Command (prefix to `npx tsx tests/manual/feed.ts --summary data/mock-api/valugrocer/2026-11-09.csv`) | Expected |
|---|---|
| `LOG_LEVEL=debug LOG_DIR=` | stderr: 36 `DEBUG row_parsed`, 2 `WARN row_skipped`, 1 `INFO feed_parsed` |
| `LOG_LEVEL=silent LOG_DIR=/tmp/gs-silent` | only the report; nothing on stderr; `/tmp/gs-silent` is not created |
| `LOG_CONSOLE=false` | only the report on the terminal; the records still go to `logs/app/` |
| `LOG_DIR=/tmp/not-a-dir/logs` (after `touch /tmp/not-a-dir`) | one line `[logger] cannot write log files in /tmp/not-a-dir/logs: ENOTDIR ...; file logging disabled`, then the usual stderr records and the report; exit 0. A broken log folder never stops ingestion |

### M18.8 Tests do not write execution logs

```bash
mv logs/app /tmp/gs-app-logs-kept 2>/dev/null; npm run -s test:unit > /dev/null 2>&1; ls logs; mv /tmp/gs-app-logs-kept logs/app 2>/dev/null
```

Expected: `ls` prints only `tests`, with no `app` folder (D-79). Your execution logs are moved
aside for the test run and put back afterwards.

### M18.9 The deliberate-bug checks

```bash
for s in standard-mutations cents-mutations flyer-index-mutations logging-mutations; do bash tests/run-logged.sh $s bash logs/tests/$s.sh | tail -3; done
```

(Local scripts in the git-ignored `logs/tests/`. They take about 15 minutes in total and restore
every file they touch.) Each script breaks the code in many small ways, one at a time, and checks
that a test fails. `logging-mutations.sh` has 19 logging bugs: skipped rows not logged, a line number
off by one, newlines inside quotes not counted, `header_invalid` demoted to debug, tests no longer
silent, and so on. Expected for each script: `survivors: 0` (for `flyer-index`: `unexpected
survivors: 0; expected survivors (allowed by the spec): 1`) and `patterns not found or no result: 0`.
Since round 7, a mutation whose Jest run prints no result line is reported as `NO-RESULT` and also
fails the script (D-81). Since round
5, a bug whose search text no longer matches the code is reported as `NOT-APPLIED` and fails the
script; before, it was silently counted as a survivor.

The scripts run Jest with `LOG_DIR=/tmp/gs-mutation-logs` (D-81). One of the logging bugs makes
the tests log like production, and without that setting it would fill `logs/app/` with about 6,000
test records, which happened twice in round 5. After running them, `wc -l logs/app/*.log` should be
unchanged.

## M19. The mocked supermarket API: `fetchChainFeed`

Spec: TECH_SPEC 4.1 (now complete). Decisions D-67, D-80, D-82, D-83. File:
`server/src/providers/index.ts` (`fetchChainFeed`, `FeedSnapshot`, `MOCK_API_DIR`). Tests:
`server/src/providers/__tests__/fetchChainFeed.test.ts`. Tool: `tests/manual/fetch-feed.ts`.

`fetchChainFeed({ id, provider }, dataDir = config.dataDir)` reads
`<dataDir>/mock-api/<id>/<YYYY-MM-DD>.csv`, parses each file with the chain's provider and resolves
to `[{ date, rows, skipped }, ...]`, oldest first.

| Situation | Result | Logged |
|---|---|---|
| snapshot files present | one `FeedSnapshot` per file, by date ascending | `feed_parsed` per file, `feed_fetched` per chain (info) |
| other entries (`notes.txt`, `2026-02-30.csv`, a folder, a symlink) | ignored | `file_ignored` (info for other names, warn for look-alikes) |
| no folder for the chain (or no `mock-api`, or no data folder) | `[]` | `feed_folder_missing` (warn) |
| chain id `../x`, `a/b`, `a\b`, `..`, `.`, empty, NUL, not a string | rejects `Invalid chain id "<id>": <reason>` | `chain_id_rejected` (error) |
| unknown provider (checked before reading, D-67) | rejects `Unknown price provider ...` | `unknown_provider` (error) |
| `mock-api/<id>` is a file, or a snapshot cannot be read | rejects, naming the path (D-82) | `feed_read_failed` (error) |

Not testable yet: the sync that stores these snapshots in Postgres (TECH_SPEC 4.2), and therefore
anything in the UI.

### M19.1 The unit tests

```bash
bash tests/run-logged.sh fetch-verbose npx jest --selectProjects unit --testPathPattern fetchChainFeed --verbose
```

Expected: `Tests: 44 passed, 44 total`. In order:

- **A temporary data folder** (created and deleted by each test):
  - sorting by date, with the folder listing deliberately rearranged, because this file system lists
    names alphabetically and would hide a missing sort;
  - each of the three providers, and the wrong provider for a file;
  - 13 file names that must be ignored, plus a folder and a symlink named like snapshots;
  - a leap day (2028-02-29 read, 2026-02-29 ignored) and a year below 100;
  - an empty file;
  - missing folders;
  - a relative data folder;
  - ids with `-`, `_` and `.`.
- **Rejections:** 14 escaping or empty ids, each with its exact reason and nothing read, even though
  a snapshot waits outside `mock-api`. Also: non-string ids, an unknown provider (checked before
  reading, even for a missing folder), a folder that is a file, and an unreadable snapshot (skipped
  when running as root).
- **Logging:** the per-chain summary; the chain and file path on each row record; the missing-folder
  warning; relative paths (`data/mock-api/valugrocer/2026-11-09.csv` lines 38 and 39).
- **The real data folder:** `config.dataDir` is `./data` by default. For each of the 8 chains there
  are four snapshots, 2026-10-19 to 2026-11-09 in that order, and row counts as in M14.6. ValuGrocer
  skips 2 rows in the last week, other chains none. All 16 golden SKUs are in every snapshot, and the
  latest prices equal `tests/fixtures/spreadsheet.ts`.

### M19.2 The real data folder, every chain

```bash
LOG_CONSOLE=false npx tsx tests/manual/fetch-feed.ts --all | diff tests/manual/fetch-feed-all.expected.md - && echo "M19.2 OK: no differences"
```

Expected: `M19.2 OK: no differences`. Open the expected file to read it: 8 chains x 4 snapshots,
every one with `16/16` golden SKUs. The rows and "on sale" columns match the round-1 audit (M14.6),
and the only `skipped` value above 0 is ValuGrocer 2026-11-09 (2). This run also adds, per chain, a
`feed_fetched` record to `logs/app/`:

```bash
grep '"event":"feed_fetched"' logs/app/grocerysave-*.log | tail -8 | cut -c1-220
```

### M19.3 Rejections and a missing chain

```bash
LOG_DIR= npx tsx tests/manual/fetch-feed.ts ../x nosuchchain; echo "exit $?"
LOG_DIR= npx tsx tests/manual/fetch-feed.ts --provider toString freshmart; echo "exit $?"
```

Expected:

- For `../x`: stderr `ERROR app.providers chain_id_rejected: Invalid chain id "../x": it contains
  ".."`, and stdout `### "../x" [standard]: rejected: ...`.
- For `nosuchchain`: `WARN app.providers.fetch feed_folder_missing: chain nosuchchain: no feed
  folder at data/mock-api/nosuchchain; no snapshots`, and `0 snapshot(s)`.
- `exit 1` for the first command, because one chain was rejected.
- The second command: `ERROR ... unknown_provider: Unknown price provider "toString" ...`, nothing
  read, `exit 1`.

Try also `a/b`, `..`, `.` and `'a\b'`: each is rejected with its own reason.

### M19.4 A folder with odd files

```bash
rm -rf /tmp/gs-demo && mkdir -p /tmp/gs-demo/mock-api/demo && cd /tmp/gs-demo/mock-api/demo \
  && printf 'item_code;description;price_cents;promo_price_cents\nGS-001;MILK;360;\n' > 2026-11-09.csv \
  && cp 2026-11-09.csv 2026-11-02.csv && cp 2026-11-09.csv 2026-02-30.csv && cp 2026-11-09.csv notes.txt \
  && mkdir 2026-12-01.csv && cd - > /dev/null
LOG_DIR= npx tsx tests/manual/fetch-feed.ts --data-dir /tmp/gs-demo --provider cents demo
```

Expected on stderr (order of the `file_ignored` lines may vary):

- `WARN ... file_ignored: chain demo: /tmp/gs-demo/mock-api/demo/2026-02-30.csv ignored: 2026-02-30 is not a calendar date`
- `WARN ... file_ignored: ... 2026-12-01.csv ignored: it is a folder`
- `INFO ... file_ignored: ... notes.txt ignored: not named <YYYY-MM-DD>.csv`
- `feed_parsed` for `2026-11-02.csv`, then for `2026-11-09.csv`
- `INFO ... feed_fetched: chain demo: 2 snapshot(s) 2026-11-02..2026-11-09, 2 rows, 0 skipped, 3 other entries ignored`

On stdout, a table with 2 snapshots, `1/16` golden SKUs each. Then try the failure cases:

- `chmod 000 /tmp/gs-demo/mock-api/demo/2026-11-09.csv`: the command rejects with `cannot read ...
  EACCES` and an `ERROR feed_read_failed` (unless you are root). Undo it with `chmod 644`.
- `rm -rf /tmp/gs-demo/mock-api/demo && touch /tmp/gs-demo/mock-api/demo`: `cannot read the feed
  folder ... ENOTDIR`.

### M19.5 The deliberate-bug check

```bash
bash tests/run-logged.sh fetch-mutations bash logs/tests/fetch-mutations.sh
```

(A local script in the git-ignored `logs/tests/`, about 3 minutes; it restores the file and sends
Jest's logs to `/tmp/gs-mutation-logs`, D-81.) It breaks `fetchChainFeed` in 23 ways. Expected last
line: `unexpected survivors: 0; expected survivors (defence in depth): 1; patterns not found or no
result: 0`.
The allowed survivor removes the folder guard, which the id checks make unreachable (D-67).

The first run of this script in round 6 (`logs/tests/20261115T192030Z-fetch-mutations.log`, exit 3)
found two gaps, both fixed in the tests:

- **"Not sorted by date" survived** because the test's folder was already listed in date order.
  The test now rearranges the listing.
- **"`.` accepted" and "empty id accepted" survived** because the folder guard also rejects them.
  The tests now check the exact reason for each rejected id.

## M20. Price sync (`syncPrices`) and catalog seed (`seedCatalog`)

Spec: TECH_SPEC 4.2 and 4.3. Decisions D-84 to D-92 (and D-66, D-80). Files:
`server/src/jobs/syncPrices.ts`, `server/src/db/seed.ts`. Needs the local Postgres of section 0.5
with `TEST_DATABASE_URL` exported. Tool: `tests/manual/sync-run.ts`.

What `syncPrices(pool, { dataDir? })` does, per chain (ordered by id), each chain independently:

1. inserts a `sync_runs` row with status `running`;
2. reads the feed with `fetchChainFeed`;
3. in one transaction, upserts one `price_history` row per store of the chain, per snapshot and per
   feed row whose SKU is in `products`; unknown SKUs are ignored and logged;
4. marks the run `ok` with `rows_ingested` (rows written), or `error` with the message. A failing
   chain never stops the others.

Not testable yet: the scheduler (`startPriceSyncScheduler`), `seed`/`seedDemo`, the CLI
(`npm run db:reset`, `npm run sync-prices`), the HTTP API (`/api/sync/status`, `/api/sync/run`) and
the UI. So far a sync is run through `tests/manual/sync-run.ts`.

### M20.1 The automated tests

```bash
bash tests/run-logged.sh sync-unit npx jest --selectProjects unit --testPathPattern planPriceRows --verbose
bash tests/run-logged.sh sync-api npx jest --selectProjects api --runInBand --verbose
```

Expected: `Tests: 7 passed` (the pure row planning: stores x snapshots x known SKUs, unknown SKUs,
duplicates, no stores; the `SyncRun` conversion), then `Tests: 26 passed` across two suites:

- **`seedCatalog`**: 8 chains, 8 stores, 40 products; coordinates, category, unit and aliases
  stored; idempotent, with ids unchanged and the log reporting 0 inserted and all updated; changed
  rows updated, new rows inserted and old rows kept; 5 kinds of invalid file rejected, naming the
  row, with nothing written; a database error rolls the whole catalog back.
- **`syncPrices` on the delivered feeds**: 8 ok runs in chain order with the rows written;
  `sync_runs` matches what was returned; 1,136 `price_history` rows and 284 `current_prices`; every
  golden price and store total of TECH_SPEC 9; Harvest's salmon stored as 7.90 paid, 9.49 regular,
  on sale; a second run adds no price rows and one more run per chain; the info-level log of a run.
- **One chain never stops the others**: an unknown provider (the error names it), no feed folder,
  no stores, an unreadable feed, and a database failure in a chain's **second** write batch. That
  one checks the first batch really reached the database (50 rows) and was rolled back (0 rows
  left), and that the run was `running` meanwhile. Plus the whole sync rejecting when `products`
  is gone.
- **Upserts**: a second store of a chain gets every price; a changed price is updated in place; a
  new snapshot adds rows and becomes the current price; a SKU repeated in a snapshot keeps its last
  row.

### M20.2 A full run on an empty database: `sync_runs` and the row counts

```bash
LOG_CONSOLE=false npx tsx tests/manual/sync-run.ts --reset
```

Expected (your timestamps and durations differ):

```
migrate (reset): applied 001_init.sql
seedCatalog: done

### syncPrices #1: what it returned (SyncRun[])
| id | chainId | ... | status | rowsIngested | error |
| 1 | budgetbasket | ... | ok | 144 | null |
| 2 | citypantry   | ... | ok | 148 | null |
| 3 | cornercoop   | ... | ok | 140 | null |
| 4 | freshmart    | ... | ok | 148 | null |
| 5 | greenleaf    | ... | ok | 140 | null |
| 6 | harvest      | ... | ok | 136 | null |
| 7 | sunrise      | ... | ok | 136 | null |
| 8 | valugrocer   | ... | ok | 144 | null |

### Row counts
| chains | stores | products | price_history | current_prices | sync_runs | snapshot_dates |
| 8 | 8 | 40 | 1136 | 284 | 8 | 4 |
```

`price_history` per chain matches the round-1 prediction (M14.6) row for row; the "on_sale_rows"
column is the sum of each chain's weekly sale counts (FreshMart 3+1+4+4 = 12).

### M20.3 Running it again changes no prices

```bash
LOG_CONSOLE=false npx tsx tests/manual/sync-run.ts
```

Expected: runs 9 to 16, all `ok`, with the same `rowsIngested` as runs 1 to 8 (rows written include
updates, D-87). The row counts show `price_history` **1136** (unchanged), `current_prices` 284, and
`sync_runs` **16**.

### M20.4 The stored prices are the golden spreadsheet

```bash
psql "$TEST_DATABASE_URL" -c "
SELECT s.chain_id, sum(cp.price) AS basket_total, count(*) AS products, max(cp.effective_date) AS as_of
FROM current_prices cp JOIN stores s ON s.id = cp.store_id JOIN products p ON p.id = cp.product_id
WHERE p.sku BETWEEN 'GS-001' AND 'GS-016' GROUP BY s.chain_id
ORDER BY array_position(ARRAY['freshmart','valugrocer','greenleaf','harvest','citypantry','budgetbasket','cornercoop','sunrise'], s.chain_id);"
```

Expected: `135.51, 147.27, 141.67, 154.51, 142.02, 150.23, 146.92, 134.61` in that order, 16 products
each, as of `2026-11-09`. These are the store totals of TECH_SPEC 9 (`GOLDEN_EXPECTED.storeTotals`),
now computed from the database.

### M20.5 A failing chain does not stop the others

```bash
psql "$TEST_DATABASE_URL" -c "INSERT INTO chains VALUES ('mystery', 'Mystery Mart', 'toString')" \
  -c "INSERT INTO stores (chain_id, name, latitude, longitude) VALUES ('mystery', 'Mystery One', 29.2, -81.0)"
npx tsx tests/manual/sync-run.ts 2>&1 | grep -E 'mystery|sync_finished'; echo "exit ${PIPESTATUS[0]}"
psql "$TEST_DATABASE_URL" -c "DELETE FROM chains WHERE id = 'mystery'"
```

Expected:

- `ERROR ... unknown_provider`, then `ERROR app.sync.mystery sync_chain_failed: chain mystery: sync
  failed, no prices written: Unknown price provider "toString" ...`
- `WARN app.sync sync_finished: price sync finished: 8 ok, 1 failed, ...`
- The returned runs and the `sync_runs` table show `mystery | error | 0 | Unknown price provider
  "toString" (known: standard, cents, flyer)`; the 8 real chains are `ok`; exit 1.

The last line removes the test chain again.

### M20.6 What a run logs

```bash
LOG_LEVEL=info LOG_DIR= npx tsx tests/manual/sync-run.ts 2>&1 >/dev/null | grep -E 'app.sync[a-z.]* (sync_|unknown_|chain_)|catalog_seeded' | cut -c1-170
```

Expected: `catalog_seeded`, `sync_started`, and for each chain `INFO app.sync.<chain> sync_chain_ok:
chain <chain>: <n> price rows written (4 snapshot(s) x 1 store(s))`. Budget Basket also logs
`WARN ... unknown_skus_ignored: ... GS-999`. Then `INFO app.sync sync_finished: price sync finished:
8 ok, 0 failed, 1136 price rows written`. Without `LOG_DIR=` the same records go to
`logs/app/grocerysave-<date>.log`, where everything about one chain in one run can be found with
`grep '"chain":"valugrocer"'`.

### M20.7 The deliberate-bug check

```bash
bash tests/run-logged.sh sync-mutations bash logs/tests/sync-mutations.sh
```

(A local script in the git-ignored `logs/tests/`, about 4 minutes; needs `TEST_DATABASE_URL`; it
restores the file and sends Jest's logs to `/tmp/gs-mutation-logs`.) It breaks `syncPrices` in 18
ways. Examples: no transaction, `DO NOTHING` instead of an update, unknown SKUs not filtered, the
first duplicate winning, only the first store, failures recorded as `ok`, one failure stopping the
rest, a missing `finished_at`, the run not `running` while it works. Expected last line:
`survivors: 0; patterns not found or no result: 0`.

The first run in round 7 (`logs/tests/20261115T195946Z-sync-mutations.log`, exit 1) found that
**"no transaction" survived**. The cause was the rollback test itself: its fake pool modified the
real pooled client, so the client went back to the pool modified and was wrapped again on the next
checkout. The failure therefore fired on the first batch, before anything was written. The test now
wraps clients in a `Proxy` and checks that 50 rows did reach the database before the rollback.

## M21. Failure isolation, and the scheduler

Spec: TECH_SPEC 4.2 (now complete). Decisions D-93 to D-97. Files: `server/src/jobs/syncPrices.ts`
(`startPriceSyncScheduler`), `server/src/errors.ts` (`errorMessage`).

`errorMessage` (D-93) was rewritten twice in this round, each time because a test failed: once for
values that are not errors (the `vanishing` chain below), once for errors from another realm. The
unit-test run at 20:53 (`logs/tests/20261115T205358Z-unit.log`, 1 failed) shows the second one:
Node's `EACCES` error printed as `non-Error value thrown: Error: EACCES ...`. Needs Postgres (0.5) with
`TEST_DATABASE_URL` exported.

### M21.1 One sync, five kinds of chain: failures stay in their chain

```bash
bash tests/run-logged.sh isolation npx jest --selectProjects api --runInBand --testPathPattern syncPrices -t 'in ONE sync' --verbose
```

Expected: `✓ in ONE sync: unknown provider, a feed that throws, a feed that rejects (twice), no feed
files; the real chains unaffected`, `Tests: 1 passed, 16 skipped`. The test adds five chains, each
with a store, next to the 8 real ones, and makes the feed call fail for three of them. In one
`syncPrices` call it expects:

| Chain | What happens | Run |
|---|---|---|
| the 8 real chains | normal feeds | `ok`, 144/148/140/148/140/136/136/144 rows |
| `mystery` | provider `toString` | `error`: `Unknown price provider "toString" (known: standard, cents, flyer)` |
| `exploding` | the feed throws synchronously | `error`: `feed exploded` |
| `rejecting` | the feed rejects with the string `network down` | `error`: `network down` |
| `vanishing` | the feed rejects with `undefined` | `error`: `non-Error value thrown: undefined` |
| `nofeed` | a valid provider, no feed folder | `ok`, 0 rows |

It also checks that all 13 runs are in `sync_runs` with no run left `running`; that `price_history`
still holds exactly 1,136 rows (only the real chains wrote); and that the log has one
`sync_chain_failed` per failed chain and a `sync_finished` at **warn**: `9 ok`, failed
`[exploding, mystery, rejecting, vanishing]`.

The `vanishing` case is the bug of D-93. With the old handler the whole sync crashed (`TypeError:
Cannot read properties of undefined`) and `vanishing` stayed `running`. That was confirmed by putting
the old line back and re-running this test (1 failed).

By hand, for the unknown provider and the missing folder, see M20.5 (the `mystery` chain). For a
chain with no feed files, add a chain with a valid provider and no `data/mock-api/<id>` folder: its
run is `ok` with 0 rows, and `WARN ... feed_folder_missing` is logged.

### M21.2 The scheduler's unit tests (fake timers)

```bash
bash tests/run-logged.sh scheduler-unit npx jest --selectProjects unit --testPathPattern jobs/__tests__/scheduler --verbose
```

Expected: `Tests: 22 passed`. They run in under a second because time is simulated:

- **Timing:** the first run is one interval after the start, then one per interval; a 60 ms interval;
  intervals of 0, -5, NaN, Infinity and -Infinity start no timer and never sync; a 60-day interval
  is capped.
- **Never two at once:** ticks during a sync are skipped and logged; a slow callback blocks too; at
  most one sync is ever active even when each takes 2.5 intervals.
- **Callback:** it gets the runs after each completed sync, including chains in error, and is
  optional.
- **Errors:** a sync that rejects, throws or rejects with `undefined` is logged, no callback is
  called, and the next tick runs; a failing callback is logged; no unhandled rejection.
- **Stop:** no sync afterwards; stopping twice is harmless; stopping during a sync waits for it and
  its callback.
- **The timer is unref'd.**

### M21.3 The scheduler against the real database (short intervals)

```bash
bash tests/run-logged.sh scheduler-api npx jest --selectProjects api --runInBand --testPathPattern server/tests/scheduler --verbose
```

Expected: `Tests: 4 passed` in about 5 s:

- a 300 ms interval syncs at least twice, 8 `ok` runs each, `price_history` stays 1,136, and nothing
  more happens in the second after `stop()`;
- a 30 ms interval (far shorter than a sync) skips ticks, and no two runs in `sync_runs` overlap in
  time;
- a chain in error doesn't stop the scheduler;
- interval 0 adds no runs.

### M21.4 Watch it yourself

The database must hold the catalog (`npx tsx tests/manual/sync-run.ts --reset` once).

```bash
LOG_DIR= npx tsx tests/manual/scheduler-run.ts --minutes 0.005 --seconds 2
```

Expected on stdout: lines like `sync #1: 8 runs (8 ok), from +316 ms to +934 ms`, then `stopping at
+2000 ms ...`, `stopped at +2xxx ms`, and `syncs completed: N; sync_runs added: 8N; overlapping runs
in the table: 0`. N depends on how long a sync takes on your machine: a tick starts a sync only if
the previous one has finished. In the recorded run (`logs/tests/*-m21-4-doc-steps.log`) syncs took
350-620 ms, so 3 of the 6 ticks ran (the others were skipped). `stop()` arrived during sync #3 and
waited for it (`stopped at +2283 ms`), and `sync_runs added: 24`. What must always hold is
`overlapping runs in the table: 0` and `sync_runs added` = 8 x `syncs completed`. On
stderr: `INFO app.scheduler scheduler_started: price sync scheduler started: every 0.005 minute(s)
(300 ms) ...`, the sync's own records, a `scheduled_sync_completed` and an `after_sync_completed`
per sync, and `scheduler_stopped` at the end.

| Try | Expected |
|---|---|
| `--minutes 0.0005 --seconds 2` (30 ms, shorter than a sync) | fewer syncs than ticks; `WARN ... scheduler_tick_skipped: price sync tick #n skipped: the previous sync is still running` lines; still `overlapping runs in the table: 0` |
| `--minutes 0 --seconds 1` | `INFO ... scheduler_disabled: price sync scheduler disabled: the interval is 0 or negative (0 minutes)`; `syncs completed: 0; sync_runs added: 0` |
| `--minutes abc --seconds 1` | `scheduler_disabled: ... the interval is not a number (NaN minutes)`; nothing runs |
| `--fail-callback` | after each sync `ERROR ... after_sync_failed: after-sync callback of sync #n failed (the scheduler keeps running): simulated failure ...`, and the syncs go on |

### M21.5 The deliberate-bug check

```bash
bash tests/run-logged.sh scheduler-mutations bash logs/tests/scheduler-mutations.sh
```

(A local script in the git-ignored `logs/tests/`, about 7 minutes.) It breaks the scheduler in 14
ways. Examples: no overlap guard, 0 or NaN starting a timer, no `unref`, errors not caught, the
callback not awaited or called after a failed sync, `stop` not clearing the timer or not waiting,
huge intervals not capped, an immediate extra run, log levels changed. Expected last line:
`survivors: 0; patterns not found or no result: 0`.

The first run in round 8 (`logs/tests/20261115T203047Z-scheduler-mutations.log`, exit 1) found two
things:

- **A survivor: "a tick after stop can still run"** removed a `stopped` check inside the tick that
  could never matter, because `stop()` clears the interval. The check was removed from the code.
- **The "no unref" bug hung Jest** instead of failing fast: the unref test stopped the scheduler only
  after its assertion, so a failed assertion left a real timer running. The test now stops it in
  `finally`.

## M22. Demo data, seed and the database CLI

Spec: TECH_SPEC 4.3 (with it, all of section 4 is done). Decisions D-98 to D-103. Files:
`server/src/db/seed.ts` (`seedCatalog`, `seedDemo`, `seed`), `server/src/db/cli.ts`. Needs Postgres
(0.5). These steps use the **development** database (`DATABASE_URL`, `grocerysave`); `db:reset`
empties it.

```bash
export DATABASE_URL=postgres://postgres:postgres@localhost:5432/grocerysave
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/grocerysave_test
```

### M22.1 The automated tests

```bash
bash tests/run-logged.sh seed-cli npx jest --selectProjects api --runInBand --testPathPattern 'server/tests/(seed|cli)\.test' --verbose
```

Expected: `Tests: 29 passed` (`seed.test.ts` 18, `cli.test.ts` 11).

- **`seedDemo`:**
  - it refuses to run without the catalog, even when a single product is missing, and writes nothing;
  - the users with bcrypt at cost 10 (checked with `bcrypt.compare`);
  - the preferences row (exact values);
  - the household and its two members;
  - "Weekly basics" item by item;
  - "Party supplies" with "Birthday candles" unmatched;
  - every item name checked against the API's matcher;
  - a second run changes no count, id or hash;
  - edited preferences, a changed password and an edited list are kept;
  - a detached party list is re-attached;
  - deleted lists and a deleted household are recreated;
  - a removed partner is added back;
  - three runs at once still make one household.
- **`seed`:**
  - an empty database gets every table filled;
  - a second seed changes no data count, with `sync_runs` +8 (D-101);
  - a failing chain makes `seed` throw, naming the chain, and the demo data is not seeded;
  - the log order.
- **The CLI**, run as a real process against the test database:
  - each command's exact summary line, with stdout exactly one line;
  - exit codes 0, 1 and 2;
  - an unreachable database gives one error line on stderr;
  - the execution log records `cli_started`, `cli_finished` and `cli_failed`, with no credentials.

### M22.2 `npm run db:reset`

```bash
npm run db:reset 2>/dev/null; echo "exit $?"
```

Expected (the two `>` lines are npm's):

```
reset: schema recreated (001_init.sql) and seeded: 8 chains, 8 stores, 40 products, 1136 price rows, 8 sync runs, 2 users, 1 household(s), 2 lists (22 items)
exit 0
```

Without `2>/dev/null` you also see the execution log: `cli_started`, `catalog_seeded`,
`sync_started`, 8 x `sync_chain_ok`, the `GS-999` and two ValuGrocer warnings, `sync_finished`,
`demo_seeded: demo data ready: created 2 user(s), preferences, household, 2 membership(s), list
"Weekly basics", list "Party supplies"`, `seed_completed`, `cli_finished`.

### M22.3 The demo data, as TECH_SPEC 4.3 lists it

```bash
psql "$DATABASE_URL" -c "SELECT email, display_name, left(password_hash, 7) AS hash FROM users ORDER BY email" \
  -c "SELECT u.email, p.home_latitude, p.home_longitude, p.max_stores, p.travel_mode FROM user_preferences p JOIN users u ON u.id = p.user_id" \
  -c "SELECT h.name, o.email AS owner, m.role, u.email AS member FROM households h JOIN users o ON o.id = h.owner_id JOIN household_members m ON m.household_id = h.id JOIN users u ON u.id = m.user_id ORDER BY m.role DESC" \
  -c "SELECT l.name AS list, i.position, i.name, i.quantity, i.unit, i.category, p.sku, hh.name AS shared_with FROM list_items i JOIN shopping_lists l ON l.id = i.list_id LEFT JOIN products p ON p.id = i.product_id LEFT JOIN households hh ON hh.id = l.household_id ORDER BY l.name DESC, i.position"
```

Expected:

- **Users:** `demo@grocerysave.test | Demo Shopper | $2a$10$` and `partner@grocerysave.test | Demo
  Partner | $2a$10$` (bcrypt, cost 10).
- **Preferences:** one row, for the demo user: 29.2, -81.045, 3, driving.
- **"Demo household":** owner `demo@...` (role `owner`), partner `member`.
- **22 items in two lists:**
  - **"Weekly basics"**, positions 0-15: `Milk` (1, gal, Dairy, GS-001), `Olive oil` (GS-002) ...
    `Pasta sauce` (GS-016), not shared.
  - **"Party supplies"**, shared with "Demo household": Tortilla chips x2, Cola x3, Sparkling water,
    Frozen pizza x2, Vanilla ice cream, and `Birthday candles | 1 | each | Other |` with no SKU.

The password can be checked without the API:

```bash
psql "$DATABASE_URL" -Atc "SELECT password_hash FROM users WHERE email = 'demo@grocerysave.test'" | xargs -I{} node -e "console.log(require('bcryptjs').compareSync('demo1234', '{}'))"
```

Expected: `true`.

### M22.4 `npm run sync-prices` twice: prices do not change

Save this as `/tmp/price-state.sh`. It prints the counts and an md5 fingerprint of every price value
(store, product, date, price, regular price, on sale):

```bash
cat > /tmp/price-state.sh <<'EOS'
psql "$DATABASE_URL" -At -F ' | ' -c "
SELECT '$1', (SELECT count(*) FROM price_history), (SELECT count(*) FROM sync_runs),
  (SELECT md5(string_agg(concat_ws(',', s.chain_id, p.sku, ph.effective_date, ph.price, ph.regular_price, ph.on_sale), ';' ORDER BY s.chain_id, p.sku, ph.effective_date))
     FROM price_history ph JOIN stores s ON s.id = ph.store_id JOIN products p ON p.id = ph.product_id),
  (SELECT to_char(max(ingested_at), 'HH24:MI:SS.MS') FROM price_history)"
EOS
bash /tmp/price-state.sh "before sync 1"; npm run -s sync-prices 2>/dev/null; bash /tmp/price-state.sh "after sync 1"
bash /tmp/price-state.sh "before sync 2"; npm run -s sync-prices 2>/dev/null; bash /tmp/price-state.sh "after sync 2"
```

Expected right after M22.2 (columns: moment, `price_history`, `sync_runs`, price fingerprint, last
`ingested_at`):

```
before sync 1 | 1136 | 8 | f49f78d7a840862cd23b75f6e933b21c | ...
sync: 8 chains ok, 0 failed, 1136 price rows written
after sync 1 | 1136 | 16 | f49f78d7a840862cd23b75f6e933b21c | ...
before sync 2 | 1136 | 16 | f49f78d7a840862cd23b75f6e933b21c | ...
sync: 8 chains ok, 0 failed, 1136 price rows written
after sync 2 | 1136 | 24 | f49f78d7a840862cd23b75f6e933b21c | ...
```

- `price_history` stays at 1,136, and the fingerprint is **identical** in all four lines: no price,
  regular price or on-sale flag changed.
- `sync_runs` grows by 8 per sync (one run per chain, TECH_SPEC 4.2).
- Only the last `ingested_at` moves forward: a re-sync records when the feed last confirmed the
  prices (D-87).
- The fingerprint is the same on any machine for the delivered data. If yours differs, a price
  differs.

### M22.5 `current_prices` is the 16 x 8 matrix of `tests/fixtures/spreadsheet.ts`

```bash
npx tsx tests/manual/golden-db.ts; echo "exit $?"
```

Expected: the matrix with `✓` in all 128 cells, the totals row `135.51 ✓ | 147.27 ✓ | 141.67 ✓ |
154.51 ✓ | 142.02 ✓ | 150.23 ✓ | 146.92 ✓ | 134.61 ✓`, `Effective date(s) of these current prices:
2026-11-09`, `128 of 128 cells match; store totals match GOLDEN_EXPECTED.storeTotals`, `exit 0`.
On-sale prices carry a `*` (for example `4.01*` Sunrise milk, `7.90*` Harvest salmon).

To check that the tool really can fail, change one price in the **test** database and run it with
`--test`:

```bash
npx tsx tests/manual/sync-run.ts --reset > /dev/null 2>&1
psql "$TEST_DATABASE_URL" -c "UPDATE price_history SET price = 3.21 WHERE effective_date = '2026-11-09' AND store_id = (SELECT id FROM stores WHERE chain_id = 'freshmart') AND product_id = (SELECT id FROM products WHERE sku = 'GS-001')"
npx tsx tests/manual/golden-db.ts --test | grep -E '✗|cells match'; echo "exit ${PIPESTATUS[0]}"
```

Expected: the GS-001 row shows `✗ 3.21 (want 3.20)`, the FreshMart total `✗ (want 135.51)`, then
`127 of 128 cells match; store totals DO NOT match ...`, `exit 1`.

### M22.6 `db:seed` is safe to run twice; `db:migrate`

```bash
npm run -s db:seed 2>/dev/null; npm run -s db:seed 2>/dev/null; npm run -s db:migrate 2>/dev/null
```

Expected: two `seed: seeded: 8 chains, 8 stores, 40 products, 1136 price rows, N sync runs, 2
users, 1 household(s), 2 lists (22 items)` lines, identical except that N grows by 8 (D-101), then
`migrate: already up to date`. With the execution log visible (drop `2>/dev/null`), the second seed
says `demo data ready: nothing new; kept existing list(s) "Weekly basics", "Party supplies"`.

### M22.7 CLI errors

| Command | Expected |
|---|---|
| `npx tsx server/src/db/cli.ts; echo $?` | `usage: tsx server/src/db/cli.ts <migrate\|seed\|reset\|sync>` on stderr, `2` |
| `npx tsx server/src/db/cli.ts seedz; echo $?` | the same usage line, `2` |
| `DATABASE_URL=postgres://postgres:postgres@localhost:5432/nope npm run -s db:migrate 2>&1 \| grep failed; echo ${PIPESTATUS[0]}` | `migrate failed: database "nope" does not exist` and the `cli_failed` log line; `1` |
| with a chain `mystery` / provider `toString` added (M20.5), `npm run -s sync-prices 2>/dev/null; echo $?` | `sync: 8 chains ok, 1 failed (mystery: Unknown price provider "toString" ...), 1136 price rows written`, `1` |

### M22.8 The deliberate-bug check

```bash
bash tests/run-logged.sh seed-cli-mutations bash logs/tests/seed-cli-mutations.sh
```

(A local script in the git-ignored `logs/tests/`, about 15 minutes; needs `TEST_DATABASE_URL`.) It
breaks `seedDemo`, `seed` and the CLI in 21 ways. Examples: no catalog check, an existing password
or preferences overwritten, a new household every run, existing list items wiped, "Party supplies"
not re-attached, wrong positions, units or categories, bcrypt cost 8, no advisory lock, no
transaction, `seed` ignoring a failed chain or skipping the demo, `sync` exiting 0 despite a failure,
`reset` not dropping the schema, two lines on stdout. Expected last line: `survivors: 0; patterns
not found or no result: 0` (`logs/tests/20261115T212022Z-seed-cli-mutations.log`). `seed.ts` bugs
run `seed.test.ts`, and `cli.ts` bugs run `cli.test.ts`.

The lock and the transaction are guarded by a concurrency test (three `seedDemo` calls at once),
and a race-based test can pass by luck. `bash logs/tests/seed-lock-repeat.sh` removes each of them
and runs that test 5 times: 5 of 5 failed for both
(`logs/tests/20261115T212701Z-seed-lock-repeat.log`).

### M22.9 Not verified yet (end of the data layer)

- **Anything through HTTP**: the API (TECH_SPEC 6) is not built. So nobody has yet logged in as
  `demo@grocerysave.test` / `demo1234` through `POST /api/auth/login`; only `bcrypt.compare` on the
  stored hash was checked (M22.3). Nobody has seen "Party supplies" as the partner through the
  household rules, compared or optimised "Weekly basics" through the API, or used
  `GET /api/sync/status` / `POST /api/sync/run`. Nothing is testable in the browser yet.
- **The server process** (`server/src/index.ts`): seeding an empty database at start, running the
  scheduler with `PRICE_SYNC_INTERVAL_MINUTES` and the deal-notification callback, and a clean
  shutdown that awaits the scheduler's stop. The scheduler is tested on its own only (M21).
- **Deal notifications** (`generateDealNotifications`) are not built. The 9 expected price drops
  (M14.6) are in the database but not turned into notifications.
- **Two syncs at the same time from different processes** (for example `npm run sync-prices` while a
  server's scheduler runs). The scheduler prevents overlap within one process only. Upserts make
  this safe for the data in principle (same rows, same order), but it is not tested.
- **That the CLI closes the pool**: `closePool()` is called, but the process then exits, so a
  missing call would not be noticed by a test (only that the process ends).
- **PostgreSQL 13**: the spec asks for 13+, but everything ran on 16 only. The SQL used (`unnest`
  with several arrays, `ON CONFLICT`, `gen_random_uuid`, advisory locks) exists in 13.
- **Other machines**: only Linux x64 was used.
- **Large feeds**: the 5,000-row batching was tested with 50-row batches and the delivered data
  only.
- **Log files keep growing**: there is no retention or clean-up yet (D-76).
- **Open questions to the product owner**: D-101 (`seed` idempotence versus `sync_runs`). Several
  decisions are still Proposed and should be confirmed (D-98 to D-103 among them).
