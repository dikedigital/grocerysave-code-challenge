# GrocerySave: technical specification

Version 1.0. This document is the normative description of the back end. Where it and a code
comment disagree, this document wins. The shared types in `src/models/index.ts`, the schema in
`server/migrations/001_init.sql` and the API client in `src/services/api.ts` are part of the
specification and are fixed.

## 1. Purpose and scope

GrocerySave helps shoppers spend less on groceries. A user keeps shopping lists; the system
compares each list's cost across supermarkets, recommends the cheapest single store or the cheapest
combination of stores (counting travel), orders the stops into a short route, tracks prices week
over week and notifies the user about price drops. Lists can be shared with a household.

In scope: the PostgreSQL schema, mocked supermarket price feeds and their ingestion, the pricing
and routing logic, the HTTP API, and the React client that consumes it.

Out of scope: photo (OCR) list input, real road routing or a maps provider, live supermarket
APIs, payments, email or push delivery of notifications.

The system must run entirely offline: no outbound network calls, no managed services.

## 2. Architecture

```
React client (Vite)  --HTTP/JSON-->  Express API  --SQL-->  PostgreSQL
                                        |
                                        +-- price sync job --reads--> data/mock-api/<chain>/<date>.csv
                                        +-- pure logic (src/utils): parsing, matching, comparison,
                                            optimisation, routing, deal detection
```

| Layer | Technology | Notes |
|---|---|---|
| Runtime | Node.js 20+, TypeScript (strict), ES modules run through `tsx`; Jest through `ts-jest` as CommonJS | |
| API | Express 4, `zod` for validation, `jsonwebtoken` (HS256), `bcryptjs` | No ORM |
| Database | PostgreSQL 13+, `pg` | Parameterised SQL only |
| Client | React 18, react-router 6, zustand, Tailwind, chart.js | Not part of the back-end acceptance |

Shared code: `src/models` and `src/utils` are imported by the browser, by the Node server (via
`tsx`) and by Jest. They must not import Node built-ins, the DOM or `import.meta`, and relative
imports must omit file extensions.

Repository layout:

```
data/stores.csv, data/products.csv            catalog
data/mock-api/<chain>/<YYYY-MM-DD>.csv        mocked supermarket API responses
server/migrations/001_init.sql                schema
server/src/{config.ts, db/pool.ts, db/migrate.ts}     provided
server/src/app.ts, index.ts                   Express app factory and process entry point
server/src/middleware, routes, services       HTTP layer and domain services
server/src/providers/                         one adapter per feed format
server/src/jobs/syncPrices.ts                 feed ingestion and scheduler
server/src/db/seed.ts, cli.ts                 seed and CLI
src/models/index.ts                           shared types
src/utils/*.ts                                pure logic
src/services/api.ts                           typed client (defines every endpoint)
tests/fixtures/spreadsheet.ts                 golden dataset
```

## 3. Data model

The schema is `server/migrations/001_init.sql`; do not alter it. Summary:

| Table | Purpose |
|---|---|
| `users` | account: unique `email` (stored lower-case), `password_hash`, `display_name` |
| `households`, `household_members` | a group of users who share lists; roles `owner` and `member` |
| `chains`, `stores` | supermarket chains (each names its feed `provider`) and their stores with coordinates |
| `products` | canonical catalog: `sku`, `name`, `category`, `unit`, `aliases text[]` |
| `price_history` | one row per store, product and feed date: `price` (paid), `regular_price`, `on_sale`, `effective_date`; unique on that triple |
| `current_prices` (view) | latest row per store and product |
| `shopping_lists`, `list_items` | lists (owner, optional household) and their items, ordered by `position` |
| `user_preferences` | chain include/exclude, `max_stores`, `travel_cost_per_km`, `travel_mode`, home coordinates, deal settings |
| `notifications` | deal notifications, unique per `(user_id, type, product_id, store_id, effective_date)` |
| `sync_runs` | one row per chain feed per sync run |

`numeric` columns are returned to JavaScript as numbers and `date` columns as `YYYY-MM-DD` strings
(`server/src/db/pool.ts`). JSON timestamps are ISO 8601 strings.

## 4. Mocked supermarket feeds

Each chain publishes one CSV snapshot per week, named `<YYYY-MM-DD>.csv`, under
`data/mock-api/<chain id>/`. The snapshot date is the file name. Three feed formats exist:

| Provider id | Chains | Header and conventions |
|---|---|---|
| `standard` | freshmart, valugrocer, greenleaf | `sku,product_name,price,regular_price,on_sale`; comma-separated; dollars; `on_sale` is `true` or `false` |
| `cents` | harvest, citypantry, budgetbasket | `item_code;description;price_cents;promo_price_cents`; semicolon-separated; integer cents; `promo_price_cents` empty when not on sale, otherwise it is the price paid and `price_cents` is the regular price |
| `flyer` | cornercoop, sunrise | `SKU,Name,Unit Price,Sale?,Was`; comma-separated; prices like `$4.01`; `Sale?` is `Y` or `N`; `Was` is the regular price or empty |

### 4.1 Provider adapters (`server/src/providers`)

```ts
interface ProviderPriceRow { sku: string; price: number; regularPrice: number; onSale: boolean }
interface ProviderParseResult { rows: ProviderPriceRow[]; skipped: number }
interface PriceProvider { id: string; parse(csvText: string): ProviderParseResult }
```

Files and exports (tests import these exact names and paths):

- `types.ts`: the three interfaces above.
- `standard.ts`: `standardProvider`; `cents.ts`: `centsProvider`; `flyer.ts`: `flyerProvider`.
- `index.ts`: `getProvider(id)`, `fetchChainFeed(chain, dataDir?)`, the `FeedSnapshot` type
  (`{ date: string; rows: ProviderPriceRow[]; skipped: number }`) and `MOCK_API_DIR = 'mock-api'`.

Normalisation: `price` is what the shopper pays; `regularPrice` is the shelf price and equals
`price` when the item is not on sale. Adapters never throw on bad data: a malformed row is skipped
and counted in `skipped`. `parse('')` returns `{ rows: [], skipped: 0 }`. If the header lacks a
required column, every data row is skipped. Line endings may be LF or CRLF.

A row is malformed (skipped) when:

| Provider | Skip when |
|---|---|
| `standard` | SKU empty; `price` not a positive amount; `regular_price` present but not a positive amount; `on_sale` not a recognised flag; too few fields. An empty `regular_price` means "equal to price" |
| `cents` | item code empty; `price_cents` not a positive integer (so `3.99` and `0` are skipped); `promo_price_cents` present but not a positive integer; too few fields. With a promo: `price` = promo / 100, `regularPrice` = `price_cents` / 100, `onSale` = true |
| `flyer` | SKU empty; unit price not a positive `$` amount; `Sale?` not a recognised flag; `Was` present but not a positive `$` amount. `Sale? = Y` with empty `Was` is on sale with `regularPrice = price` |

Amounts are plain decimals with at most two decimal places, optionally prefixed with `$` (so
`abc`, `n/a` and `1.999` are invalid). Flags are case-insensitive: `true`, `y`, `yes`, `1` mean on
sale; `false`, `n`, `no`, `0` and the empty string mean not on sale; anything else is malformed.
When a row is on sale, `regularPrice` is never lower than `price`; when it is not, `regularPrice`
equals `price`.

`getProvider(id)` returns the adapter, or throws an `Error` whose message starts with
`Unknown price provider`; inherited object keys such as `toString` are unknown too.

`fetchChainFeed(chain: { id: string; provider: string }, dataDir = config.dataDir)` is the mock API
call. It is asynchronous, reads every file named `<YYYY-MM-DD>.csv` in
`<dataDir>/mock-api/<chain.id>/`, ignores other files, parses each with the chain's provider and
returns the snapshots sorted by date ascending. A missing folder yields `[]`. A chain id that
contains a path separator or `..` is rejected (the promise rejects).

### 4.2 Price sync (`server/src/jobs/syncPrices.ts`)

```ts
syncPrices(pool: Pool, options?: { dataDir?: string }): Promise<SyncRun[]>
startPriceSyncScheduler(pool: Pool, intervalMinutes: number,
  onAfterSync?: (runs: SyncRun[]) => Promise<void> | void): () => void
```

`syncPrices` handles every row of `chains` independently. For each chain it inserts a `sync_runs`
row (`status = 'running'`), fetches the feed, and upserts into `price_history` one row for every
store of the chain, every snapshot and every parsed row whose SKU exists in `products`
(`ON CONFLICT (store_id, product_id, effective_date) DO UPDATE`); unknown SKUs are ignored. It then
marks the run `ok` with `rows_ingested` (price rows written) and `finished_at`, or `error` with the
message. An unknown provider or any other failure makes that chain's run `error` (the message
contains the provider id for an unknown provider) and never stops the other chains. A chain without
feed files is an `ok` run with 0 rows. The function returns the finished runs as `SyncRun` models
(camelCase, ISO timestamps). Running it twice adds no `price_history` rows but adds one more run
per chain.

The scheduler runs `syncPrices` every `intervalMinutes` using an unref'd timer, never runs two syncs
at once, logs and swallows errors, calls `onAfterSync` after each completed sync, does nothing when
`intervalMinutes <= 0`, and returns a function that stops it.

### 4.3 Seed (`server/src/db/seed.ts`) and CLI (`server/src/db/cli.ts`)

`data/stores.csv` columns: `chain_id,chain_name,provider,store_name,address,city,latitude,longitude`.
`data/products.csv` columns: `sku,name,category,unit,aliases` (aliases separated by `|`).

```ts
seedCatalog(pool, options?: { dataDir?: string }): Promise<void>   // chains, stores, products; upsert
seedDemo(pool): Promise<void>                                       // demo users and lists
seed(pool, options?): Promise<void>                                 // seedCatalog, syncPrices, seedDemo
```

All three are idempotent: a second call changes no row counts. `seed` throws if any chain's sync
fails; `seedDemo` throws if the catalog is missing. `seedDemo` creates, with `DEMO_PASSWORD =
'demo1234'` hashed with bcrypt:

- users `demo@grocerysave.test` (display name "Demo Shopper") and `partner@grocerysave.test`;
- preferences for the demo user with home at latitude 29.2000, longitude -81.0450;
- a household "Demo household" with both users as members (the demo user is owner);
- a list "Weekly basics" owned by the demo user: the 16 products `GS-001` to `GS-016` in SKU order,
  quantity 1, `position` 0 to 15, `product_id` set, `category` taken from the product, short names
  (the first item is named "Milk" with category "Dairy");
- a list "Party supplies" owned by the demo user and shared with "Demo household": at least four
  matched items plus one item named "Birthday candles" that matches no product.

It never overwrites existing demo preferences or lists, and re-attaches "Party supplies" to the
household on every run. It exports `DEMO_EMAIL`, `PARTNER_EMAIL` and `DEMO_PASSWORD`.

The CLI `tsx server/src/db/cli.ts <migrate|seed|reset|sync>`: `migrate` applies migrations; `seed`
migrates then seeds; `reset` migrates with `reset: true` then seeds; `sync` runs `syncPrices`. It
prints a one-line summary, closes the pool and exits non-zero on failure.

## 5. Business logic (`src/utils`)

The doc comment on each exported function in `src/utils/*.ts` is its specification; this section
adds the cross-cutting rules and the decisions where several readings are possible.

### 5.1 Money

Compute in integer cents. Round half away from zero without binary drift: `roundCents(1.005)` is
`1.01`, `roundTo(2.675)` is `2.68`. Fields the models call "rounded to cents" are exact cents.
Fields the models call "unrounded" stay unrounded, and so do all percentages.
Exports: `toCents`, `fromCents`, `roundCents`, `roundTo`, `sumMoney`, `formatMoney`, `formatPct`.

### 5.2 List parsing and product matching

`parseListLine`, `parseListText` and `parseListCsv` accept the shapes in `parseList.ts`. Also:

- merging in `parseListText` ignores case, keeps the first spelling, adds quantities and joins
  differing notes with `; `;
- fractional quantities are rounded to 3 decimals (`1/3` is 0.333);
- in CSV a quantity cell may carry its unit (`500g`) when the unit column is empty; unknown CSV
  units become `each`; newlines inside a note collapse to a space;
- `"2 lb"` alone parses as the name `lb` with quantity 2;
- `normalizeUnit(text)` returns the canonical unit or `null`; `parseQuantity(text)` returns a
  positive number or `null`.

`matchProduct` normalises both sides with `normalizeName`, scores exact name or alias as 1, else
Jaccard token overlap, and breaks ties by shorter name then lower SKU.

### 5.3 Price comparison

`compareBasket(lines, stores, prices)` builds the matrix. Decisions:

- A line is priceable when it has a `productId` and at least one store sells it. Other lines still
  get a row (all `null`) and are listed in `summary.unpricedKeys`.
- A store is complete when it sells every priceable line (a store with no priceable lines is
  complete). `averageTotal`, `cheapestStoreId` and "vs cheapest store" use complete stores only.
  If no store is complete: `cheapestStoreId` is `null`, `averageTotal` averages all stores, and the
  vs-cheapest fields are 0.
- Percentages use different bases: vs optimal divides by the optimal total; vs cheapest store by
  the cheapest complete store's total; a row's savings percentage by the unrounded row average; the
  summary savings percentage by the unrounded average total.
- Exact-cent fields: store totals, `vsOptimal`, `vsCheapestStore`, line totals, `low`, `high`,
  `optimalTotal`, `highTotal`. Unrounded: row `average`, `savings`, `savingsPct`, summary
  `averageTotal`, `savings`, `savingsPct`, and every store percentage.
- Ties go to the earlier store in `stores`. Prices for stores not in `stores` are ignored.
- No stores or no lines: all totals 0, nothing throws.

`filterStores(stores, preferences)` keeps a store when its chain is not excluded and either
`includedChains` is empty or contains the chain.

### 5.4 Purchase optimisation

`optimizePurchase` is exact: it searches every subset of up to `maxStores` stores. Decisions:

- Each priceable line is bought at the cheapest store of the subset that sells it (ties: earlier
  store); stores left with no lines are dropped from the plan.
- Plans are ranked by fewest unavailable lines, then lowest `grandTotal`, then fewest stores, then
  earliest stores in input order. A cheaper plan that cannot buy an item loses to a dearer plan that
  can.
- `byStoreCount[k]` holds the best plan that actually buys from exactly k stores; a plan with no
  lines is never listed there but may still be `cheapestSingleStore` or `bestPlan`.
- `maxStores` is clamped to between 1 and the number of stores. With no stores everything is null
  and `byStoreCount` is empty.
- With `home` set, stops are ordered with `planRoute` (round trip from home). `travelDistanceKm` is
  that route's rounded `totalDistanceKm`, and `travelCost = roundCents(travelDistanceKm x
  travelCostPerKm)`. A plan with a home but no stops has a zero-length route, not `null`.
- Plans are ranked by money only. Travel time is not given a price: every plan carries its `route`
  with `totalDurationMin`, and the plan and route view (7.2.5, 7.2.6) shows it so that the shopper
  decides whether a cheaper plan is worth the longer trip.
- Performance: 8 stores, 16 lines, `maxStores` 8 and a home location must complete in under 2
  seconds. Callers keep the store list to about 8 stores.

### 5.5 Routing

`haversineKm` uses an Earth radius of 6371 km. `planRoute` orders stops to minimise total distance
from `origin`: exact for up to 8 stops, nearest neighbour followed by 2-opt beyond that (2-opt also
works one-way). Equal-length orders (including the two directions along a line) keep the input
sequence. Leg distances are rounded to 2 decimals and durations to whole minutes; totals are
computed from unrounded legs, then rounded. Speeds: driving 40 km/h, walking 5 km/h.

### 5.6 Deals

`detectDeals(points, thresholdPct)` compares each store and product's two most recent snapshots and
reports a deal when the latest price is lower by at least `thresholdPct` percent (a drop exactly at
the threshold counts). A single snapshot never yields a deal. Several points for the same store,
product and date count as one snapshot (the last one wins). Results sort by `dropPct` descending,
then `productId`, then `storeId`.

## 6. HTTP API

All routes are under `/api`; the endpoint list, methods, query strings and bodies are those of
`src/services/api.ts`, and the response shapes are those of `src/models/index.ts`.

### 6.1 Conventions

- Bodies and responses are JSON. Errors are `{ "error": "<message>" }`.
- Status codes: 200 OK; 201 for created resources; 204 for deletions; 400 validation or malformed
  JSON; 401 missing or invalid token; 403 authenticated but not allowed; 404 not found, including
  resources the caller may not see, and unknown `/api` paths (JSON, for everyone); 409 duplicate
  email.
- Authentication: `Authorization: Bearer <JWT>`; HS256 signed with `config.jwtSecret`, valid 7
  days, subject is the user id. A token whose user no longer exists is 401. Everything except
  `GET /api/health`, register and login requires a valid token.
- Passwords: minimum 8 characters, hashed with bcryptjs at cost 10, never returned or logged.
- Emails are trimmed and lower-cased; uniqueness is case-insensitive.
- Validation with `zod`; Postgres input errors (bad uuid, check violation) map to 400 or 404 as
  below, never 500. A malformed id in a path is 404.
- Parameterised SQL only. List endpoints must not issue one query per row.

### 6.2 Process

`createApp(pool: Pool, options?: { staticDir?: string }): express.Express` builds the app without
listening. `server/src/index.ts` is an async `main()`: get the pool, run `migrate`, `seed` when the
`chains` table is empty, generate deal notifications once, start the scheduler with
`config.priceSyncIntervalMinutes` and a callback that generates deal notifications, serve
`staticDir` (the built client) with an SPA fallback for non-`/api` GET requests when it contains an
`index.html`, listen on `config.port`, and close the server and pool on SIGINT or SIGTERM.

### 6.3 Endpoints

**Health and auth**

- `GET /health` returns `{ ok: true }` after a `SELECT 1`.
- `POST /auth/register` `{ email, password, displayName? }` returns 201 `AuthResponse`. Invalid
  email, short password or empty input is 400; duplicate email 409.
- `POST /auth/login` returns 200 `AuthResponse`. A wrong password and an unknown email give the
  same 401.
- `GET /auth/me` returns `{ user }`.

**Catalog**

- `GET /chains`; `GET /stores` ordered by chain name then store name; `GET /products?q=` filters by
  case-insensitive match on name or any alias (all products when `q` is empty);
  `GET /products/:id/price-history` returns `PriceHistoryResponse` with all points oldest first
  (then by store), 404 for an unknown product.

**Lists.** A user sees a list when they own it or belong to its household. Members may rename a
list and add, edit and remove items; only the owner may delete it or change `householdId`
(resending the unchanged value is allowed), and only to a household they belong to or `null`.

- `GET /lists` returns visible lists with items, most recently changed first. Items are ordered by
  `position`, then creation time. Any item change sets the list's `updated_at`.
- `POST /lists` `{ name, householdId? }` 201; `GET|PATCH|DELETE /lists/:id`. A list the caller
  cannot see is 404 on every route. Moving a list to a household the caller does not belong to is
  404; a member changing `householdId` is 403; a non-owner deleting is 403. Empty name is 400.
- `POST /lists/:id/items` 201 with `{ name, quantity?, unit?, note? }`. Quantity defaults to 1 and
  must be greater than 0 (else 400). The name is matched with `matchProduct` against the whole
  catalog: on a match `productId` is set, `category` is the product's category and the unit
  defaults to the product's unit; otherwise `productId` is null, category `Other`, unit `each`.
  Explicit quantity and unit are kept.
- `PATCH /lists/:id/items/:itemId` (`ItemPatch`): invalid values 400; a changed name is matched
  again; other fields do not touch the product. `DELETE` 204; a missing item is 404.
- `POST /lists/:id/items/bulk` `{ items: ParsedItem[] }` and `POST /lists/:id/import`
  `{ format: 'text' | 'csv', content }` return 201 `ImportResponse` (`matched` counts items that
  matched a product). Parsing uses `parseListText` or `parseListCsv`; bulk keeps the parsed unit.
  An empty request, content that yields no items, an unknown format, or more than 500 items is 400.
- `GET /lists/:id/comparison[?allStores=true]` returns `ComparisonResponse`: one `BasketLine` per
  item (key = item id, label = item name); stores are all stores filtered with `filterStores` by the
  caller's preferences unless `allStores=true`; prices come from `current_prices`; the result is
  `compareBasket(...)`. An empty list returns 200 with zero totals.
- `GET /lists/:id/optimization[?maxStores=&travelCostPerKm=]` returns `OptimizationResponse`;
  options come from the caller's preferences (`maxStores`, `travelCostPerKm`, `travelMode`, `home`)
  and query values override them. `maxStores` is clamped to 1..8 and a negative `travelCostPerKm`
  to 0; a non-numeric value is 400. Stores are filtered by the caller's preferences.

**Routes.** `POST /routes/optimize` `{ storeIds, origin?, mode?, roundTrip? }` returns `RoutePlan`
via `planRoute`. `origin` defaults to the saved home location (400 when neither exists), `mode` to
the saved travel mode, `roundTrip` to `true`. Empty or malformed input, an unknown store id or an
invalid origin is 400.

**Preferences.** `GET /preferences` returns defaults for a user without a row:
`{ includedChains: [], excludedChains: [], maxStores: 3, travelCostPerKm: 0, travelMode: 'driving',
home: null, notifyDeals: true, dealThresholdPct: 10 }`. `PUT /preferences` accepts a partial
`UserPreferences`, merges it, upserts and returns the full object. 400 for: `maxStores` not an
integer in 1..8; negative `travelCostPerKm`; `dealThresholdPct` outside 0..100; `home` with latitude
outside -90..90, longitude outside -180..180 or a missing coordinate; unknown `travelMode`;
non-boolean `notifyDeals`; a chain id not in `chains`. `home: null` clears the location.

**Households.** All endpoints return the `Household` with its members (`HouseholdMember`).

- `GET /households` lists those the caller belongs to. `POST /households` `{ name }` returns 201;
  the creator becomes owner and member.
- `POST /households/:id/members` `{ email }`: owner only (a member gets 403, an outsider 404); an
  unknown email is 404; email match is case-insensitive; adding an existing member is a no-op that
  returns 200.
- `DELETE /households/:id/members/:userId`: the owner may remove any member except themselves; a
  member may remove only themselves; anything else is 403; a user who is not a member is 404. The
  response is the household after removal.
- `DELETE /households/:id`: owner only (member 403, outsider 404), 204. The household's lists are
  kept and become private to their owners.

**Deals and notifications**

- `GET /deals` returns `DealView[]`: products matched in the caller's visible lists, their price
  points run through `detectDeals` with the caller's `dealThresholdPct`, limited to stores that
  pass the caller's chain preferences, with product and store names added. Best first.
- `generateDealNotifications(pool): Promise<number>` in `server/src/services/notifications.ts`
  inserts, for every user with `notify_deals`, one `notifications` row per deal (`type 'deal'`) with
  `ON CONFLICT DO NOTHING`, and returns how many rows were inserted. Title:
  `<product name> is <N>% cheaper at <chain name>` where N is `dropPct` rounded to the nearest
  integer (for example "Butter 1 lb is 22% cheaper at GreenLeaf Market"); the body contains the old
  and new price formatted like `$5.00` and `$3.90`; `oldPrice`, `newPrice`, `productId`, `storeId`
  are set; `readAt` is null. A user who turns notifications on later is notified on the next run.
- `GET /notifications` newest first; `POST /notifications/:id/read` returns the `Notification`
  (404 for a missing one or another user's); `POST /notifications/read-all` returns
  `{ updated }`, the number that were unread.

**Sync**

- `GET /sync/status` returns the 40 most recent `SyncRun`s, newest `startedAt` first.
- `POST /sync/run` runs `syncPrices`, then `generateDealNotifications`, and returns `{ runs }`.

## 7. Client

The React client (Vite, React 18, react-router, zustand, Tailwind) consumes the API through
`src/services/api.ts`. Its pages, hooks, stores and layout are specified only by that use; this
section is normative for the modules below, which the tests exercise directly: the comparison view
(7.1), the plan and route view (7.2) and the list, deal and settings pieces (7.3). Other notable
behaviour: shared lists refresh by polling every 5 seconds and rely on the server bumping
`updated_at`; the route map is an offline SVG; pages are lazy-loaded.

Client tests run in Jest with jsdom and Testing Library (no browser needed): files ending in
`.test.tsx` belong to the `web` project and `.test.ts` to the `unit` project. They query by role,
accessible name, label and visible text, never by class name or DOM structure, so the accessible
contract stated below is part of the specification.

### 7.1 Comparison view (`src/components/comparison`)

This section specifies the pure helpers and the three presentational components of the comparison
page. The shared types are in `src/models/index.ts`; money and percentage text come from
`src/utils/money.ts` (`formatMoney`, `formatPct`, section 5.1). Everything is formatted for the
`en-US` locale, whatever the locale of the machine. The em dash `—` (U+2014) is the "no value"
mark. "Screen-reader-only text" is text that is exposed to assistive technology but not shown
(Tailwind `sr-only`); it counts as part of the text content of the element that holds it. Tests
find elements by role, accessible name, label and visible text, never by class name or DOM nesting.
Where the text says "own element", the text sits in an element of its own so that it can be found by
its exact text.

#### 7.1.1 `format.ts`

All functions are pure and synchronous.

| Function | Result |
|---|---|
| `formatQuantity(quantity: number): string` | `Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })`: at most two decimals, no trailing zeros, thousands separators. `2` -> `"2"`, `0.5` -> `"0.5"`, `1.25` -> `"1.25"`, `1.333` -> `"1.33"`, `3.0` -> `"3"`, `0` -> `"0"`, `1234.5` -> `"1,234.5"`, `1000` -> `"1,000"`. |
| `formatMoneyDelta(amount: number): string` | `"+"` followed by `formatMoney(amount)` when `amount > 0`; otherwise just `formatMoney(amount)`. `2.1` -> `"+$2.10"`, `0` -> `"$0.00"`, `-1` -> `"-$1.00"`, `1234.5` -> `"+$1,234.50"`, `1.005` -> `"+$1.01"`, `-1.005` -> `"-$1.01"` (half a cent rounds away from zero, section 5.1). A negative amount that rounds to zero (`-0.004`) and `NaN` give `"$0.00"`, never `"-$0.00"`. A positive amount below half a cent is not specified. |
| `formatPctDelta(value: number): string` | `"+"` followed by `formatPct(value)` when `value > 0`; otherwise `formatPct(value)`. Two decimals, no thousands separator. `3.5` -> `"+3.50%"`, `0` -> `"0.00%"`, `-2` -> `"-2.00%"`, `2.675` -> `"+2.68%"`, `-2.675` -> `"-2.68%"`, `10.004` -> `"+10.00%"`, `1234.5` -> `"+1234.50%"`. |
| `formatKm(km: number): string` | `km.toFixed(1)` followed by `" km"`: `3.2` -> `"3.2 km"`, `10` -> `"10.0 km"`, `0` -> `"0.0 km"`, `3.26` -> `"3.3 km"`, `1234.56` -> `"1234.6 km"` (no thousands separator). Behaviour for non-finite input is not specified. |
| `formatDuration(minutes: number): string` | Round `minutes` to a whole number first (`Math.round`, half up). Below 60: `"<n> min"`. From 60 up: whole hours alone as `"<h> h"`, otherwise `"<h> h <m> min"`. `0` -> `"0 min"`, `0.4` -> `"0 min"`, `44.6` -> `"45 min"`, `59` -> `"59 min"`, `59.5` -> `"1 h"` (it rounds to 60), `60` -> `"1 h"`, `61` -> `"1 h 1 min"`, `80` -> `"1 h 20 min"`, `125.6` -> `"2 h 6 min"`, `600` -> `"10 h"`. Negative and non-finite input is not specified. |
| `formatDateTime(iso: string): string` | Parse `iso` with `new Date(iso)`. If the result is an invalid date, return `iso` unchanged (so `"not a date"` and `""` come back as they were). Otherwise format it with `Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })` in the local time zone of the runtime: `"Nov 13, 2026, 8:30 AM"`, `"Mar 5, 2026, 5:05 PM"`, `"Jan 2, 2026, 12:00 AM"` (midnight). Day without leading zero, 12-hour clock. The space before `AM`/`PM` may be a normal space or a narrow no-break space, depending on the runtime's ICU data; callers must not depend on which. A timestamp without a UTC offset (`2026-11-13T08:30:00`) is read as local time. |
| `formatFeedDate(feedDate: string): string` | Reads a feed date `YYYY-MM-DD` as a calendar date (no time-zone shift) and formats it as `"Nov 13, 2026"` (`Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })`): `"2026-01-05"` -> `"Jan 5, 2026"`, `"2026-12-31"` -> `"Dec 31, 2026"`, `"2024-02-29"` -> `"Feb 29, 2024"`. Split on `-` and convert the three parts to numbers; if any part is not a positive number (missing, `NaN` or `0`) return the input unchanged: `"soon"`, `""`, `"2026-11"`, `"2026-00-10"`, `"2026-11-00"` and `"abcd-ef-gh"` come back as they were. Out-of-range days or months (`2026-13-45`) are not specified. |
| `storeLabel(store: Pick<Store, 'name' \| 'chainName'>): string` | `store.name` when it already contains `store.chainName`, compared case-insensitively and anywhere in the name; otherwise `"<name> (<chainName>)"`. `{ name: 'Kroger Downtown', chainName: 'Kroger' }` -> `"Kroger Downtown"`; `{ name: 'KROGER downtown', chainName: 'Kroger' }` -> `"KROGER downtown"`; `{ name: 'The Big Aldi Store', chainName: 'Aldi' }` -> `"The Big Aldi Store"`; `{ name: 'Corner Market', chainName: 'Trader Joes' }` -> `"Corner Market (Trader Joes)"`. An empty chain name is contained in every name, so the result is the name alone. |

#### 7.1.2 `heatColor.ts`

```ts
export type HeatRank = 'lowest' | 'highest' | 'middle';
export interface Heat { style: CSSProperties; rank: HeatRank }
export function heatColor(value: number, low: number, high: number): Heat;
export function heatLegendSteps(count = 5): Heat[];
```

`heatColor` colours `value` on the scale between `low` and `high` (the lowest and highest value of
its row or column). Green is cheap, red is expensive.

1. **Position.** `position = (value - low) / (high - low)` clamped to the range `[0, 1]`, when
   `high > low`; otherwise (`high` equal to or below `low`, so every value is equal) `position = 0`.
   A value below `low` therefore counts as `low`, and a value above `high` as `high`. Behaviour for
   a non-finite `value` is not specified.
2. **Rank.** `position === 0` -> `'lowest'`; `position === 1` -> `'highest'`; anything else
   (including a value only slightly above `low` or below `high`) -> `'middle'`. When all values are
   equal every value is `'lowest'`.
3. **Lowest style.** `style` contains exactly `backgroundColor: '#15803d'`, `color: '#ffffff'` and
   `fontWeight: 700` (a number): deep green, white, bold. It is not on the hue scale.
4. **Every other style** contains `color: '#111827'` and `fontWeight: 400` (a number), and
   `backgroundColor` is the string `hsl(<hue> 85% 74%)`: CSS space-separated syntax, a plain number
   for the hue (no unit, no commas), saturation `85%`, lightness `74%`.
5. **Hue** is linear interpolation of `position` between these stops:

   | position | 0 | 0.34 | 0.67 | 1 |
   |---|---|---|---|---|
   | hue | 135 | 55 | 28 | 0 |

   (green, yellow, orange, red). Examples on `low = 0`, `high = 100`: value `34` -> hue 55, `67` ->
   28, `100` -> 0, `17` -> 95, `50.5` -> 41.5, `83.5` -> 14, `1` -> about 132.6. The hue must be exact
   to within 0.5; the number may be printed with any number of decimals. The hue falls steadily as the
   value grows.

The colour depends only on the relative position: `heatColor(7.5, 5, 10)` equals `heatColor(50, 0, 100)`.

`heatLegendSteps(count = 5)` returns `count` swatches from lowest to highest: element `i` is
`heatColor(i, 0, count - 1)`. For the default count the ranks are `lowest, middle, middle, middle,
highest` and the middle hues are about 76.18, 41.91 and 21.21; `heatLegendSteps(3)` has ranks
`lowest, middle, highest`; `heatLegendSteps(2)` has `lowest, highest`; `heatLegendSteps(1)` has
the single `lowest` step (the all-equal case); `heatLegendSteps(0)` is `[]`.

#### 7.1.3 `exportCsv.ts`

```ts
export function buildComparisonCsv(data: ComparisonResponse): string;
export function downloadCsv(filename: string, text: string): void;
export function csvFilename(listName: string): string;
```

**`buildComparisonCsv`** returns the comparison matrix as CSV text.

- **Records and quoting.** Records are separated by `\r\n`; there is no trailing newline. A field is
  written as is, except that a field containing a comma, a double quote, `\r` or `\n` is wrapped in
  double quotes with every inner double quote doubled (`Milk "organic"` ->
  `"Milk ""organic"""`, `Salt, fine` -> `"Salt, fine"`, a label with a line break stays one record).
  An empty or absent value is an empty field (nothing between the commas). The text must survive a
  round trip through an RFC 4180 parser.
- **Amounts.** Every money amount and percentage is written with exactly two decimals and a `.`
  decimal point, as `Number.prototype.toFixed(2)` gives, with no currency symbol and no thousands
  separator: `6.4` -> `6.40`, `-4.5` -> `-4.50`, `0` -> `0.00`. Values that fall exactly on half a
  cent are not specified. Percentages carry no `%` sign. Quantity is the number as written by
  `String(quantity)` (`2`, `1.5`), not two decimals.
- **Columns.** Let `S` be the number of ids in `data.result.storeIds`. Store columns follow
  `storeIds`, in that order. A store column is titled `"<store.name> (<store.chainName>)"` for the
  store in `data.stores` with that id (note: always with the chain, unlike `storeLabel`), or the raw
  id when `data.stores` has no such store.
- **Header record:** `Item`, `Quantity`, one title per store, `Average`, `High`, `Low`, `Savings`,
  `Savings %` (`S + 7` fields).
- **One record per `result.rows` entry, in order:** `label`, `quantity`, then per store its line
  total (empty when `lineTotals[storeId]` is `null` or absent), then `average`, `high`, `low` (each
  empty when `null`), then `savings` and `savingsPct` (always written, `0.00` for an item priced
  nowhere). Example, milk x2 at three stores (`6.40`, `5.98`, `7.50`): `Milk,2,6.40,5.98,7.50,6.63,7.50,5.98,0.65,9.76`.
  An item sold by only two stores: `Eggs,1,4.50,,4.50,4.50,4.50,4.50,0.00,0.00`. An item matching no
  product: `Pasta sauce,1.5,,,,,,,0.00,0.00` (with three stores).
- **Footer records**, in this order, after the item records. Per-store fields use the `StoreTotal`
  whose `storeId` matches; a store with no `StoreTotal` gets an empty field in every one of these rows.
  1. `Total cost`, an empty field, per store `total`, then `summary.averageTotal`,
     `summary.highTotal`, `summary.optimalTotal`, `summary.savings`, `summary.savingsPct`
     (`S + 7` fields).
  2. `Missing items`, empty, per store the number of `missingKeys` (`0` is written as `0`).
  3. `vs optimal ($)`, empty, per store `vsOptimal`.
  4. `vs optimal (%)`, empty, per store `vsOptimalPct`.
  5. `vs cheapest store ($)`, empty, per store `vsCheapestStore`.
  6. `vs cheapest store (%)`, empty, per store `vsCheapestStorePct`.

  Records 2 to 6 have `S + 2` fields (no trailing empty fields). Negative values keep their sign:
  `-4.50`, `-42.94`.
- With no items the output is the header and the six footer records. With no stores the header is
  `Item,Quantity,Average,High,Low,Savings,Savings %`.
- On the golden dataset (section 9) the footer reproduces the spreadsheet: 16 item records, a
  `Total cost` record of 15 fields holding the eight store totals, then `average`, `high`, `low`
  total, savings and savings %, each with two decimals.

**`downloadCsv(filename, text)`** offers `text` to the browser as a file download:

1. build a `Blob` whose content is the UTF-8 byte order mark (bytes `EF BB BF`) followed by the UTF-8
   bytes of `text`, with a MIME type starting with `text/csv` (`text/csv;charset=utf-8`);
2. create an object URL for it (`URL.createObjectURL`);
3. create an anchor element (`<a>`) whose `href` is that URL and whose `download` attribute is
   `filename`, append it to `document.body`, click it, and remove it from the document again;
4. revoke the object URL (`URL.revokeObjectURL`, with the same URL), after the click.

The anchor must be attached to the document at the moment of the click, and exactly one anchor is
clicked per call. No anchor is left in the document afterwards.

**`csvFilename(listName)`** turns a list name into a file name: lower-case the name, replace every
run of characters outside `a-z` and `0-9` with a single `-`, strip leading and trailing `-`, and
use `list` when nothing is left; append `-comparison.csv`. Non-ASCII letters count as separators.
`"Weekly shop"` -> `"weekly-shop-comparison.csv"`; `"Costco RUN 2026"` -> `"costco-run-2026-comparison.csv"`;
`"Milk & eggs -- (big!) list"` -> `"milk-eggs-big-list-comparison.csv"`; `"  --Party!!  "` ->
`"party-comparison.csv"`; `"Café Crème"` -> `"caf-cr-me-comparison.csv"`; `""`, `"   "`, `"!!! ???"`
and `"日本語"` -> `"list-comparison.csv"`.

#### 7.1.4 `SummaryCards.tsx`

Default export `SummaryCards`, props `{ data: ComparisonResponse }`. It shows four summary cards
side by side in one **region landmark named `Summary`** (`role="region"`, `aria-label="Summary"`).
In document order the cards are **Cheapest single store**, **Best possible split**, **Potential
savings** and **Stores compared**. Each card shows three texts in this order, each in its own
element with exactly that text: the card title, the value, the detail line. (The titles are not
headings; icons are decorative and hidden from assistive technology.) Let `summary =
data.result.summary`.

| Card | Value | Detail |
|---|---|---|
| Cheapest single store | `formatMoney(total)` of the `StoreTotal` in `data.result.storeTotals` whose `storeId` equals `summary.cheapestStoreId`; `None` when there is no such total (in particular when `cheapestStoreId` is `null`) | `storeLabel(store)` for the store in `data.stores` with that id (`Kroger Downtown`; `Corner Market (Trader Joes)`); when there is no such store (in particular for `null`): `No single store sells every item on this list.` |
| Best possible split | `formatMoney(summary.optimalTotal)` | `Every item bought at its lowest price.` |
| Potential savings | `formatMoney(summary.savings)` | `<formatPct(summary.savingsPct)> below the average store (<formatMoney(summary.averageTotal)>).`, e.g. `8.47% below the average store ($11.45).` |
| Stores compared | `String(data.result.storeIds.length)` (the stores in the comparison, not the length of `data.stores`; `0` for none) | `After your store preferences.` |

Amounts use `formatMoney`, so `1234.5` shows as `$1,234.50`. On the golden dataset the cards
show `$134.61` and `Sunrise Market ...` (the cheapest complete store), `$115.56`, `$28.53` with
`19.80% below the average store ($144.09).`, and `8`.

#### 7.1.5 `StoreCard.tsx`

Default export `StoreCard`, props:

```ts
{ store: Store; total: StoreTotal; missingLabels: string[]; isCheapest: boolean }
```

One store's basket total as a card for narrow screens. It is an **`article`**. Its content:

- the **store name** (`store.name`, not `storeLabel`) as a **level-3 heading**, and the chain name
  (`store.chainName`) as its own text element next to it. Both are shown even when the name
  already contains the chain name;
- when `isCheapest` is true, a badge with the text `Cheapest` (decorative icon hidden from
  assistive technology); the text is absent otherwise. It depends only on `isCheapest`, not on
  `total`;
- the total, `formatMoney(total.total)` (`$1,234.50`), in its own element;
- two comparisons, in this order, each a label in its own element followed by its value in its own
  element: `vs optimal` with `"<formatMoneyDelta(vsOptimal)> (<formatPctDelta(vsOptimalPct)>)"`,
  and `vs cheapest store` with
  `"<formatMoneyDelta(vsCheapestStore)> (<formatPctDelta(vsCheapestStorePct)>)"`. Examples:
  `+$1.52 (+14.50%)`, `-$4.50 (-42.94%)`, `$0.00 (0.00%)`;
- only when `total.complete` is false: a note in one element reading
  `Missing <n> item: <labels>` for `n = 1` and `Missing <n> items: <labels>` otherwise, where `n` is
  `missingLabels.length` (not `missingKeys.length`) and `<labels>` is `missingLabels.join(', ')`:
  `Missing 2 items: Milk, Eggs`, `Missing 1 item: Eggs`. No note when `total.complete` is true, even
  when `missingLabels` is not empty.

#### 7.1.6 `ComparisonTable.tsx`

Default export `ComparisonTable`, props:

```ts
{ data: ComparisonResponse; selectedKey: string | null; onSelectRow: (row: ComparisonRow) => void }
```

The price matrix: items down, stores across. It is a real HTML table with a header row, one body row
per `data.result.rows` entry (in order) and three footer rows. It uses the table roles: the table
(`table`), column header cells (`columnheader`), row header cells (`rowheader`, the first cell of
every body and footer row), data cells (`cell`). The table has an accessible name from a
screen-reader-only caption: `Line totals per store for each list item, with the lowest price of each
row highlighted.`

**Header row.** Column headers in this order: `Item`; one per id in `data.result.storeIds`, in that
order; then `Average`, `High`, `Low`, `Savings`, `%`. A store header contains the store name and the
chain name of the store in `data.stores` with that id (the raw id and no chain name when there is
no such store). The header of the store whose id equals `summary.cheapestStoreId` also contains the
text `Cheapest`; no header does when `cheapestStoreId` is `null`.

**Body rows.** The row header holds the item label and, when `row.quantity !== 1`, the quantity as
`×` followed by `formatQuantity(quantity)` right after the label (`Milk×2`, `×1.5`); a quantity of 1
shows no `×`. Then:

- *Matched item* (`row.productId !== null`): the label is inside a **button** with the accessible
  name `Price history for <label>` (an `aria-label`) and an `aria-expanded` attribute, `"true"` when
  `row.key === selectedKey` and `"false"` otherwise (including when `selectedKey` is `null`);
  `aria-expanded` follows `selectedKey` when it changes. Clicking the button calls
  `onSelectRow(row)` once, with that entry of `data.result.rows`. A focused button is activated
  by Enter and by Space (native button behaviour). These buttons are the only controls in the table.
- *Item without a product match* (`row.productId === null`): plain text, no button, followed by the
  text `no product match`.

Then one cell per store id (in `storeIds` order), then five summary cells.

- **Store cell, unavailable.** When `row.lineTotals[storeId]` is `null` or absent, or `row.low` or
  `row.high` is `null`, the cell shows the dash `—`, hidden from assistive technology
  (`aria-hidden`), followed by the screen-reader-only text `not sold here`; so the cell's accessible
  name is exactly `not sold here`, and its text contains no price. It is not heat-coloured.
- **Store cell, price.** Otherwise the cell shows `formatMoney(lineTotal)` followed by
  screen-reader-only rank text from `heat = heatColor(lineTotal, row.low, row.high)` (7.1.2): a
  single space then `(lowest price)` for rank `lowest` and `(highest price)` for `highest`, nothing
  for `middle`. The text content is therefore `$5.98 (lowest price)`, `$7.50 (highest price)` or
  `$6.40`. The cell's inline style is `heat.style`: for rank `lowest` background `#15803d`, white
  text, font weight 700; for the other ranks dark text `#111827`, font weight 400 and the pastel
  background of 7.1.2. Stores that tie for the lowest price all show `(lowest price)`; so does the
  only priced cell of a row, and all cells of a row whose prices are all equal.
- **Summary cells**, in this order, plain text without rank text or colour (never heat-coloured,
  even when a value equals the lowest price): **Average** `formatMoney(row.average)`, **High**
  `formatMoney(row.high)`, **Low** `formatMoney(row.low)` (each a lone `—` when its value is `null`),
  **Savings** `formatMoney(row.savings)` and **%** `formatPct(row.savingsPct)` (each a lone `—`
  when `row.average` is `null`). Example for milk x2 (line totals 6.40, 5.98, 7.50): `$6.63`, `$7.50`,
  `$5.98`, `$0.65`, `9.76%`. An item priced nowhere (matched or not) has `—` in all five.
  Savings may be negative and then show as `-$1.25`; amounts use thousands separators (`$1,234.50`).

**Footer rows**, after the body, in this order, each with a row header and one cell per store id in
`storeIds` order:

1. **`Total cost`.** For a store with no entry in `data.result.storeTotals`, the same unavailable
   cell as above. Otherwise `formatMoney(total.total)`. Heat colouring uses only the **complete**
   stores: `low` and `high` are the smallest and largest `total` among `storeTotals` entries with
   `complete === true`. A complete store's cell gets `heatColor(total, low, high)` (inline style as
   for price cells) and the same screen-reader-only rank text (`$10.90 (lowest price)`, `$12.00
   (highest price)`); a single complete store is `lowest`. An **incomplete** store (`complete ===
   false`) is never heat-coloured and has no rank text, even when its total is the lowest of all
   (it sells fewer items); instead its cell adds the text `missing <n>` (`n = missingKeys.length`)
   immediately followed by the screen-reader-only text `: <labels>`, where `<labels>` are the labels
   of the `data.result.rows` whose `key` is in `missingKeys`, in `missingKeys` order, joined with
   `, `; a key matching no row is listed as the key itself. So the cell's text contains
   `missing 1: Eggs` or `missing 3: Eggs, Milk, ghost`. A complete store's cell has no `missing`
   text. When no store is complete, no store cell is coloured. After the store cells, five summary cells:
   `formatMoney(summary.averageTotal)`, `formatMoney(summary.highTotal)`,
   `formatMoney(summary.optimalTotal)`, `formatMoney(summary.savings)`,
   `formatPct(summary.savingsPct)` (under `Average`, `High`, `Low`, `Savings`, `%`; note that `Low`
   holds the optimal total).
2. **`vs optimal`** and 3. **`vs cheapest store`**. Each store cell shows two texts, each in its own
   element, in this order: the money delta (`formatMoneyDelta(total.vsOptimal)` /
   `formatMoneyDelta(total.vsCheapestStore)`) and the percentage delta (`formatPctDelta(total.vsOptimalPct)`
   / `formatPctDelta(total.vsCheapestStorePct)`), e.g. `+$0.42` and `+4.01%`, `-$4.50` and
   `-42.94%`, `$0.00` and `0.00%`. A store with no `StoreTotal` shows only `—`. These cells are not
   heat-coloured. A final cell spanning the five summary columns is empty.

**Empty data.** With no items (`rows` empty) the table has no body rows, but the header row and the
three footer rows are still rendered. With no stores there are no store columns.

### 7.2 Plan and route view (`src/components/optimization`)

This section specifies two pure helpers and four presentational components that show an
optimisation result: the map projection and scale bar, the plan key, the offline route map, the
plan summary cards, the "plans by number of stores" table and the per-store shopping list. None of
them fetches data or keeps state of its own. The types `Store`, `LatLng`, `RoutePlan`, `RouteStop`,
`ShoppingPlan`, `PlanStore`, `PlanLine` and `OptimizationResult` come from `src/models` and are
fixed. The components are default exports of `RouteMap.tsx`, `PlanSummary.tsx`,
`StoreCountTable.tsx` and `PlanStoreCard.tsx`; the helpers are named exports of `mapProjection.ts`
and `planKey.ts`.

Tests query by role, accessible name, label and visible text. Where this section quotes a string
in `"double quotes"` it is exact (case, punctuation, single spaces). Where it says a string is "the
entire text of an element", that text is one element's own text, not part of a longer paragraph.
CSS classes, element nesting beyond what is stated, icons and pixel sizes are free.

#### 7.2.1 Display formats used by the components

- **Money**: US dollars as `$1,234.50`: thousands separated by commas, exactly two decimals,
  rounded to whole cents (the `formatMoney` of section 5.1; a negative amount is `-$1.00`).
- **Percentage**: the `formatPct` of section 5.1: two decimals followed by `%` (`12.50%`).
- **Distance**: kilometres with exactly one decimal, then ` km`: `3.2 km`, `12.0 km`.
- **Quantity**: a plain number with at most two decimals, no trailing zeros and commas for
  thousands: `2`, `0.5`, `1.25`, `1,500`; `0.333333` is `0.33`.
- **Store label**: the store's `name`, followed by ` (` chain name `)` unless the name already
  contains the chain name when compared case-insensitively. A store `Downtown` of chain `Costco`
  is `Downtown (Costco)`; `COSTCO Westend` of chain `Costco` is `COSTCO Westend`. When a store id
  is not found in the `storeById` map the label is the store id itself.
- **Count label**: `1 store`, `2 stores`, `3 stores` (singular only for exactly one).

#### 7.2.2 `mapProjection.ts`

```ts
export interface ProjectedPoint { x: number; y: number }
export interface MapProjection {
  project: (point: LatLng) => ProjectedPoint;
  pixelsPerKm: number;           // canvas units (viewBox units) per kilometre
}
export function createProjection(points: LatLng[], width: number, height: number, padding: number): MapProjection;
export function scaleBarKm(pixelsPerKm: number, maxPixels: number): number;
export function formatScale(km: number): string;
```

**`createProjection`** fits `points` (at least one; behaviour for an empty list is undefined) into a
`width` x `height` canvas with `padding` free on every side. An equirectangular projection with
these exact rules, where `K = 111.32` kilometres per degree:

1. `minLat`, `maxLat`, `minLng`, `maxLng` are the extremes of the points. The centre is the
   **midpoint of the extremes**, not the mean: `centerLat = (minLat + maxLat) / 2`,
   `centerLng = (minLng + maxLng) / 2`.
2. `lngFactor = K * cos(centerLat in radians)`: kilometres per degree of longitude. The same
   factor is used for every point, whatever its own latitude.
3. `spanX = max((maxLng - minLng) * lngFactor, 0.4)` and `spanY = max((maxLat - minLat) * K, 0.4)`
   kilometres. The 0.4 km minimum span keeps a single point, identical points or two very close
   points from zooming to infinity; it applies to each axis separately.
4. `pixelsPerKm = min((width - 2 * padding) / spanX, (height - 2 * padding) / spanY)`. One scale
   is used on both axes, so the limiting axis fills the padded box and the other is centred.
5. `project(p)` returns
   `x = width / 2 + (p.lng - centerLng) * lngFactor * pixelsPerKm` and
   `y = height / 2 - (p.lat - centerLat) * K * pixelsPerKm`.
   North is up (a larger latitude gives a smaller `y`) and east is right. Points that were not
   part of the fit may project outside the padded box.

Worked examples (width 640, height 420, padding 56, so the padded box is 528 x 308):

| points | `pixelsPerKm` | projected |
|---|---|---|
| (0, 0) and (0, 1) (lat, lng) | `528 / 111.32` = 4.7431 (width limits; height uses 0.4) | (0, 0) -> (56, 210); (0, 1) -> (584, 210) |
| (0, 0) and (1, 0) | `308 / 111.32` = 2.7668 (height limits) | (1, 0) -> (320, 56); (0, 0) -> (320, 364) |
| (60, 10) and (60, 11) | `528 / 55.66` = 9.4862 (`lngFactor` = 55.66 because cos 60 deg = 0.5) | the two points are 528 apart horizontally |
| one point | 770 (`308 / 0.4`) | the point -> (320, 210) |
| (0, 0) and (0, 10/111.32) | 52.8 (10 km east-west; height uses the 0.4 km minimum) | |

Because `lngFactor` is applied to the longitude difference, two points at the same latitude that
are 1 km apart are `pixelsPerKm` apart horizontally, and two points 1 km apart due north-south
are `pixelsPerKm` apart vertically (`x` uses the cosine of the centre latitude).

**`scaleBarKm(pixelsPerKm, maxPixels)`** returns a round scale-bar length in kilometres. The steps
are, in order, `0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000`. It returns the largest
step whose pixel length `step * pixelsPerKm` is **at most** `maxPixels` (equal counts as fitting);
when no step fits it returns the smallest step, `0.1`. Examples with `maxPixels = 140`:
`pixelsPerKm` 92 -> `1` (1 km = 92 px, 2 km = 184 px); 70 -> `2` (exactly 140 px); 70.5 -> `1`;
237 -> `0.5`; 528 -> `0.2`; 770 -> `0.1`; 100000 -> `0.1`; 50 -> `2`; 27 -> `5`; 8 -> `10`;
6 -> `20`; 2.5 -> `50`; 1.3834 -> `100`; 0.6 -> `200`; 0.25 -> `500`; 0.0001 -> `1000`.
With `pixelsPerKm` 10: `maxPixels` 30 -> `2`, `maxPixels` 300 -> `20`.

**`formatScale(km)`**: under 1 km it is whole metres, `Math.round(km * 1000)` followed by ` m`
(`0.1` -> `"100 m"`, `0.5` -> `"500 m"`, `0.1234` -> `"123 m"`, `0.6789` -> `"679 m"`); from 1 km it
is the number as JavaScript prints it followed by ` km`, with no separators and no rounding
(`1` -> `"1 km"`, `2.5` -> `"2.5 km"`, `100` -> `"100 km"`, `1000` -> `"1000 km"`).

#### 7.2.3 `planKey.ts`

`planKey(plan: ShoppingPlan): string` identifies a plan by the set of stores it visits, whatever
the route order: the plan's `storeIds` sorted ascending by **plain string comparison** (UTF-16
code-unit order: not numeric, not locale-aware, so `s10` sorts before `s2` and `B` before `a`) and
joined with `|`. `['c','a','b']` -> `"a|b|c"`; `['store-7']` -> `"store-7"`; `[]` -> `""`;
`['s10','s2','s1']` -> `"s1|s10|s2"`; `['b','B','a','A']` -> `"A|B|a|b"`. It depends only on
`storeIds` and must not reorder the plan's own array.

#### 7.2.4 `RouteMap`

```ts
interface RouteMapProps {
  route: RoutePlan;     // origin, stops in visiting order, roundTrip, ...
  stores: Store[];      // every store of the comparison
}
```

An offline map, no tiles: the home location, the stops and the other stores projected on an SVG.
The root element is a `<figure>` containing one `<svg>` and a `<figcaption>` legend. Legs are
straight lines between points.

**The map image.** The `<svg>` has `viewBox="0 0 640 420"`, `role="img"` and an `aria-label` that
is exactly

`Route map: start at home, then ` + the stops as `1. {name}, 2. {name}, ...` joined by `, ` +
(`, and return home` if `route.roundTrip`) + `.`

for example `Route map: start at home, then 1. Alpha Market, 2. Beta Foods, and return home.` and,
one way, `Route map: start at home, then 1. Alpha Market, 2. Beta Foods.` (`{name}` is the
stop's `name`.) For a route without stops the label still starts with `Route map:`; nothing
further is specified. The decorative symbols of the legend are hidden from assistive technology,
so the map is the only image.

**Geometry.** The projection is `createProjection(points, 640, 420, 56)` with `points` = the
origin, the stops' locations and the locations of the "other stores" (below). Everything is drawn
at its projected position, so the other stores influence the zoom and the centring.

- **Route line**: exactly one `<polyline>` in the `<svg>`; its `points` attribute is a list of
  `x,y` pairs separated by spaces: home, then each stop in the order of `route.stops`, then home
  again when `route.roundTrip` is true. A one-way route ends at its last stop. With no stops the
  line starts at home. The line may carry direction arrows in the middle of each leg that is at
  least 36 units long (not checked).
- **Home**: a marker at the origin, labelled with an SVG `<text>` whose content is exactly
  `Home`, and a `<title>` of exactly `Home (start and end)`; there is exactly one such title even
  for a round trip.
- **Stops**: for each stop, in order, a marker with a `<title>` of exactly
  `Stop {n}: {full name}` (n from 1), an SVG `<text>` containing only the number `n`, and a name
  label.
- **Other stores**: every store in `stores` whose `id` is not the `storeId` of any stop, in the
  order of the `stores` array, is drawn as a small muted marker with a `<title>` of exactly
  `{full name} (not on this route)` and a name label. Stores that are stops are not drawn a
  second time. With no other stores nothing extra is drawn.
- **Labels**: the name label of a stop or of another store is an SVG `<text>` holding the name;
  a name longer than 24 characters is cut to its first 23 characters followed by `…` (U+2026), a
  name of 24 characters or fewer is shown whole. Titles always carry the full name. The text of
  a name label never consists only of digits. (Labels should move to the left of their marker near
  the right edge so that they stay inside the map; not checked.)
- The `<svg>` contains no `<title>` other than those listed, and no `<polyline>` other than the
  route line.
- **Scale bar**: one bar with one label, an SVG `<text>` whose content is
  `formatScale(scaleBarKm(pixelsPerKm, 140))`, where `pixelsPerKm` is the projection's. The bar is
  `step * pixelsPerKm` units long. No other `<text>` has the form `<number> m` or
  `<number> km`. Examples: home (40, -74) with stops (40.01, -74.01), (40.02, -73.98) and another
  store (39.99, -73.97) gives 92.2 px per km, label `1 km`; home with one stop at
  (40.0005, -74.0005) gives 770 px per km, label `100 m`; one stop 2.2 km east of home (at
  latitude 40, 0.02 / cos 40 deg degrees of longitude) gives 237 px per km, label `500 m`; one
  stop at (42, -70) gives 1.38 px per km, label `100 km`.
- **North arrow**: an SVG `<text>` containing exactly `N`.

**Legend.** The `<figcaption>` holds these five entries, each the entire text of its own element
and each present whatever the route (also when there are no other stores): `Home`,
`Numbered stop, in visiting order`, `Route and direction`, `Other store, not on this route` and
`Straight lines between points; real roads differ.`

**Empty route.** With no stops the component still renders the image, the home marker, the scale
bar, the north arrow and the legend, without stop numbers or `Stop ...` titles, and does not
throw.

#### 7.2.5 `PlanSummary`

```ts
interface PlanSummaryProps {
  result: OptimizationResult;
  storeById: Map<string, Store>;
}
```

A `<section aria-label="Plan summary">` (a region named `Plan summary`) with three cards in this
order. Each card is one container element that holds that card's title, headline value and detail
lines, and nothing of the other cards. The title and the headline value are each the entire text
of their own element; each detail line below is the entire text of its own element (one line).
Let `single = result.cheapestSingleStore`, `best = result.bestPlan`.

1. **Title `Cheapest single store`.** Headline value: money of `single.grandTotal`, or `None` when
   `single` is null. Details when present: the store label (7.2.1) of `single.storeIds[0]`; then
   `Items {money of itemsTotal}` followed by ` + travel {money of travelCost}` only when
   `travelCost > 0` (`Items $20.00`, `Items $38.00 + travel $2.00`); then, only when
   `single.route` is not null and `single.travelDistanceKm > 0`, a line of its own
   `Travel time {formatDuration(single.route.totalDurationMin)}` (`Travel time 18 min`). When null
   the detail is `No store has a price for the items on this list.`
2. **Title `Best plan`.** Headline: money of `best.grandTotal`, or `None`. Details when present:
   `{count label}: {store labels joined by ", "}` with the stores in the plan's `storeIds`
   order (`2 stores: Eastside Foods, Downtown (Costco)`, `1 store: Eastside Foods`); then
   `Items {itemsTotal} + travel {travelCost}` with the travel cost always shown, even `$0.00`,
   followed by ` ({distance})` only when `travelDistanceKm > 0` (`Items $1,200.00 + travel
   $34.50 (12.3 km)`, `Items $12.00 + travel $0.00`); then, only when `best.route` is not null
   and `best.travelDistanceKm > 0`, a line of its own `Travel time
   {formatDuration(best.route.totalDurationMin)}` (`Travel time 1 h 5 min`). When null the detail
   is `No plan could be made.`
3. **Title `Savings vs single store`.** Headline: money of `result.savingsVsSingleStore` (`$0.00`
   when there are no plans). Detail: when `savingsVsSingleStore > 0`, `{percentage} less than
   shopping at one store.` where the percentage is `savingsVsSingleStore / single.grandTotal * 100`
   formatted as in 7.2.1 (`$5.00` saved against a `$40.00` single store: `12.50% less than
   shopping at one store.`; `$1.00` against `$30.00`: `3.33% less than shopping at one store.`),
   or `0.00%` when `single` is null or its total is not above zero; otherwise
   `Splitting the shop does not beat the cheapest single store.` Then, as a line of its own, the
   price of the saving in time: when `single.route` and `best.route` are both not null and their
   `totalDurationMin` differ, `{d} more travel than the cheapest single store.` when the best
   plan takes longer and `{d} less travel than the cheapest single store.` when it takes less,
   with `d = formatDuration(|best.route.totalDurationMin - single.route.totalDurationMin|)`
   (`18 min more travel than the cheapest single store.`). Otherwise this line is absent. This line
   is shown whether or not there is a saving: the time is for the shopper to weigh against the
   money, not for the ranking.

#### 7.2.6 `StoreCountTable`

```ts
interface StoreCountTableProps {
  plans: ShoppingPlan[];            // best plan for 1, 2, ... stores
  bestPlan: ShoppingPlan | null;
  selectedKey: string | null;       // planKey of the plan shown in detail
  storeById: Map<string, Store>;
  onSelect: (plan: ShoppingPlan) => void;
}
```

A `<section aria-label="Plans by number of stores">` (region of that name) containing an `<h2>`
with exactly `By number of stores`, a short explanatory sentence (wording free) and a `<table>`
whose `<caption>` (visually hidden) gives it the accessible name
`Best plan for each number of stores visited`.

- **Header row**: seven `<th scope="col">` column headers with exactly these texts, in order:
  `Stores visited`, `Items`, `Travel distance`, `Travel time`, `Travel cost`, `Grand total`,
  `Show details` (the last one visually hidden).
- **Body**: one row per element of `plans`, in the order given. With no plans there are no body
  rows (the header row remains). Each body row starts with a row header (`<th scope="row">`)
  followed by six `<td>` cells.
- **Row header**: in this order, the count label of `plan.storeIds.length` (`1 store`,
  `2 stores`), then, only for the best plan, the text `Best` as the entire text of its own
  element, then the store labels of `plan.storeIds` in that order joined by `, ` (unknown ids
  show as the id).
- **Cells 1-5**: money of `itemsTotal`; the distance of `travelDistanceKm` when it is above 0,
  otherwise an em dash `—` (U+2014); the travel time, `formatDuration(plan.route.totalDurationMin)`,
  when `plan.route` is not null and `travelDistanceKm` is above 0, otherwise an em dash; money of
  `travelCost`; money of `grandTotal`. Cell 6 holds the button. The time column is there so that
  the shopper can compare, row by row, what each extra store saves against the minutes it adds.
- **Best plan**: a row is the best row when `planKey(row plan) === planKey(bestPlan)`, i.e. the
  same set of stores, not the same object and not necessarily the same order. At most one row is
  marked, and none when `bestPlan` is null or not in `plans`. The marker is the `Best` text only.
- **Selected plan**: a row is selected when `planKey(row plan) === selectedKey`. With
  `selectedKey` null no row is selected.
- **Button**: every row has one `<button type="button">` whose accessible name is
  `Show the {n}-store plan` (`Show the 2-store plan`) or, for the selected row,
  `Showing the {n}-store plan`, with `n = plan.storeIds.length` (no pluralisation). Its
  `aria-pressed` is `true` for the selected row and `false` for every other row. Its visible
  text starts with `Show` or `Showing`; the remainder of the name may be visually hidden.
- **Interaction**: clicking a button, or activating it with Enter or Space, calls
  `onSelect(plan)` once with that row's plan object (the same reference as in `plans`); this also
  happens for the already selected row. The component keeps no selection state: what is pressed
  follows only `selectedKey`.

#### 7.2.7 `PlanStoreCard`

```ts
interface PlanStoreCardProps {
  planStore: PlanStore;             // storeId, lines, subtotal
  store: Store | undefined;
  stopNumber: number | null;        // 1-based position in the route, when the plan has one
}
```

What to buy at one store of a plan. The root is an `<article>`.

- **Heading**: an `<h3>` whose text is exactly `store.name` (the plain name, without the chain
  suffix of the store label), or `planStore.storeId` when `store` is undefined.
- **Address line** (only when `store` is defined): the entire text of one element is
  `{chainName} · {address}, {city}`, the separator being the middle dot U+00B7 with a space on
  each side: `Fresh Mart · 12 Maple St, Springfield`. When `store` is undefined this line, and
  any text containing the city, is absent.
- **Stop number**: when `stopNumber` is not null, an element with `aria-label="Stop {n}"` and the
  text `{n}`. When it is null no element with an `aria-label` starting `Stop ` is rendered.
- **Table**: a `<table>` with a visually hidden `<caption>` of exactly
  `Items to buy at {heading text}` (the store name, or the store id when unknown). Header row with
  `<th scope="col">` texts exactly `Item`, `Qty`, `Unit price`, `Total`, in this order.
- **Body**: one row per `planStore.lines` element in the given order: a row header
  (`<th scope="row">`) with `line.label`, then three cells: the quantity (7.2.1), money of
  `unitPrice`, money of `lineTotal`. The values are shown as given: nothing is recomputed from
  quantity and price.
- **Subtotal row**: the last row of the table has a row header with exactly `Subtotal` (it may
  span the first three columns) and exactly one data cell with money of `planStore.subtotal`,
  shown as given, not summed from the lines. With no lines the table has just the header row and
  the subtotal row.

### 7.3 Lists, deals and settings forms

This section specifies two pure helper modules and four presentational components. Types come from `src/models/index.ts`; money and percentage formatting comes from `src/utils/money.ts` (`formatMoney`, `formatPct`); the UI primitives (`Button`, `Alert`) are in `src/components/ui/`; `ITEM_UNITS` is in `src/config/constants.ts`; `errorMessage(error, fallback)` is in `src/config/errors.ts`. All of these already exist. Components are default exports. Tests find elements by role, accessible name, label and visible text, so those are normative; class names, DOM nesting and icons are not.

Where this section says a text is shown "as one piece of text", it must be rendered in a single element, so that a text query for the whole string finds it. The separator `·` is the middle dot U+00B7 with one space on each side.

#### 7.3.1 `src/components/shopping-list/format.ts`

```ts
export function formatDate(iso: string): string;
export function formatQuantity(quantity: number): string;
export function groupByCategory<T extends { category: string }>(items: T[]): { category: string; items: T[] }[];
```

**`formatDate(iso)`** turns an ISO timestamp into a short English calendar date.
- The output has the form `Mon D, YYYY` with a three-letter English month, the day without a leading zero and a four-digit year: `Nov 13, 2026`, `Jan 5, 2026`, `Dec 31, 2025`. The locale is always `en-US`, never the visitor's locale.
- The instant is parsed with `new Date(iso)` and shown in the runtime's local time zone. An ISO string without an offset such as `2026-03-09T08:15:00` is therefore read as local time and gives `Mar 9, 2026`.
- If the value cannot be parsed (`''`, `'not a date'`) the result is the empty string `''`. It never throws.

**`formatQuantity(quantity)`** prints a quantity with at most three decimals and no trailing zeros: `2` gives `"2"`, `1.5` gives `"1.5"`, `0.333333` gives `"0.333"`, `1.2346` gives `"1.235"`, `2.0004` gives `"2"`, `0.2501` gives `"0.25"`.
- The value is rounded to three decimals (`Math.round(q * 1000) / 1000`) and converted with `String`. There are no thousands separators (`1234.5678` gives `"1234.568"`); a negative value keeps its sign (`-1.5` gives `"-1.5"`).
- A quantity that rounds to nothing prints as `"0"`, never `"-0"` (`0.0004` and `-0.0001` both give `"0"`).

**`groupByCategory(items)`** groups items by category.
- The category of an item is its `category` trimmed. A blank (empty or whitespace-only) category becomes `"Other"`.
- Items with the same trimmed category (compared case-sensitively) are in one group; `' Dairy '` and `'Dairy'` are the same group, named `"Dairy"`. Blank categories and a category literally named `"Other"` form one group `"Other"`.
- Groups are sorted alphabetically by category name using `localeCompare` (so `"apples"` sorts before `"Bakery"`), except that the group `"Other"` is always last, even though it would sort before names such as `"Pantry"` or `"Produce"`.
- Inside a group the items keep their input order. The items in the result are the original objects (not copies, same identity, other fields untouched). The input array and its items are not modified. No items give `[]`.
- Result shape: `[{ category: 'Dairy', items: [...] }, ..., { category: 'Other', items: [...] }]`.

#### 7.3.2 `src/components/settings/tripValidation.ts`

```ts
export interface TripDraft { maxStores: string; travelCostPerKm: string; lat: string; lng: string }
export interface TripErrors { maxStores?: string; travelCostPerKm?: string; lat?: string; lng?: string }
export function validateTrip(draft: TripDraft): TripErrors;
export function homeFromDraft(draft: TripDraft): LatLng | null;
```

The draft holds the raw text of the form fields. A field's text is converted to a number as follows: if the text is empty or only whitespace the number is `NaN` (a blank is never read as 0); otherwise it is `Number(text)`, which ignores surrounding spaces (`' 4 '` is 4).

**`validateTrip(draft)`** returns an object that has a key only for each field that is wrong. A fully valid draft returns `{}`. All fields are checked independently and all problems are reported together. The exact messages are:

| Field | Rule | Message when broken |
| --- | --- | --- |
| `maxStores` | an integer from 1 to 8, inclusive (`'1'`, `'8'` valid; `'0'`, `'9'`, `'-1'`, `'2.5'`, `'three'`, `''`, `'   '` invalid) | `Enter a whole number from 1 to 8.` |
| `travelCostPerKm` | a finite number, 0 or more (`'0'`, `'0.5'` valid; `'-0.1'`, `'cheap'`, `''`, `'  '` invalid) | `Enter 0 or more.` |
| `lat`, `lng` | see below | see below |

The home location is optional, but latitude and longitude go together:
- If both `lat` and `lng` are blank (empty or whitespace after trimming) there is no error for either.
- If at least one is not blank, then both are checked:
  - blank `lat` gives `lat: 'Enter a latitude, or clear both fields.'`; blank `lng` gives `lng: 'Enter a longitude, or clear both fields.'`;
  - a non-blank `lat` that is not a finite number, or is below -90 or above 90, gives `lat: 'Latitude is a number from -90 to 90.'`; the limits `-90` and `90` are valid;
  - a non-blank `lng` that is not a finite number, or is below -180 or above 180, gives `lng: 'Longitude is a number from -180 to 180.'`; the limits `-180` and `180` are valid; `'0'` is valid for both.
- Example: `{ maxStores: '0', travelCostPerKm: '-1', lat: '100', lng: '' }` gives all four errors: `maxStores` and `travelCostPerKm` with their messages, `lat` with the range message and `lng` with `Enter a longitude, or clear both fields.`

**`homeFromDraft(draft)`** reads the home location of a draft that already passed `validateTrip`. If `lat` and `lng` are both blank (after trimming) it returns `null`. Otherwise it returns `{ lat: Number(draft.lat), lng: Number(draft.lng) }` (`' 12.5 '` and `' 7 '` give `{ lat: 12.5, lng: 7 }`; zero coordinates are kept, `{ lat: 0, lng: 0 }`). It looks only at `lat` and `lng`.

#### 7.3.3 `ListCard` (`src/components/shopping-list/ListCard.tsx`)

A summary card of one shopping list on the lists page. It is rendered inside a router (it contains links).

```ts
interface ListCardProps {
  list: ShoppingList;
  householdName?: string;   // name of the household the list is shared with, when known
  canDelete: boolean;       // only the owner can delete
  deleting: boolean;        // a deletion of this list is running
  onDelete: (list: ShoppingList) => void;
}
```

Content:
- A heading of level 3 whose text is the list name and which contains a link (name = the list name) to `/lists/{list.id}`.
- The text `Updated {formatDate(list.updatedAt)}` as one piece of text, for example `Updated Mar 9, 2026`.
- A sharing badge, shown only when `list.householdId` is not null: the text `Shared · {householdName}` as one piece of text, or just `Shared` when `householdName` is missing or empty. A list with `householdId === null` shows no badge and no text containing "Shared", even if `householdName` is given.
- A count line as one piece of text: `{total} {item|items} · {completed} done`, singular `item` only when total is exactly 1. Examples: `4 items · 1 done`, `1 item · 0 done`, `0 items · 0 done`. `completed` is the number of items with `completed === true`.
- The percentage `{progress}%` as text (for example `25%`, `67%`, `0%`), where `progress = Math.round(completed / total * 100)` and is 0 when the list has no items.
- A progress bar: an element with role `progressbar`, accessible name `{list.name} progress`, and attributes `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow="{progress}"`.
- An item preview of at most the first three items, each shown as its name as separate text (`Item 1`, ...). An empty list shows the text `No items yet` instead. When the list has more than three items an extra text `+{n} more` is shown, where n is the number of items not previewed (7 items give `+4 more`); with three items or fewer there is no such text.
- Three links with these names and targets: `Open` to `/lists/{id}`, `Compare` to `/compare?list={id}`, `Plan` to `/plan?list={id}`.

Deleting (two steps):
- When `canDelete` is false there is no delete control of any kind.
- When `canDelete` is true the card shows a button named `Delete {list.name}`. Clicking it does not call `onDelete`; it switches the card to confirmation mode: the button `Delete {list.name}` is replaced by a button named `Confirm deleting {list.name}` (its visible text is `Delete`) and a button named `Cancel`.
- Clicking `Confirm deleting {list.name}` calls `onDelete` exactly once with the `list` object received in props.
- Clicking `Cancel` leaves confirmation mode without calling `onDelete`: the button `Delete {list.name}` is back and `Cancel` is gone.
- While `deleting` is true (in confirmation mode) the confirm button is disabled and has `aria-busy="true"`, and the `Cancel` button is disabled. (The `Button` component already provides `isLoading`, which sets both.) The card keeps its confirmation mode in its own state, so a change of the `deleting` prop (from false to true) does not leave that mode.

#### 7.3.4 `ImportPreview` (`src/components/shopping-list/ImportPreview.tsx`)

Shows how pasted text or an uploaded CSV will be read, before it is sent to the server.

```ts
interface ImportPreviewProps { items: ParsedItem[] | null }   // null: the preview could not be computed
```

- `items === null`: the single text `Preview unavailable. You can still upload; the server reads the list itself.` and no table.
- `items.length === 0`: the single text `Nothing to import yet.` and no table.
- Otherwise:
  - A summary text `{n} {item|items} found` (`1 item found`, `4 items found`, `100 items found`, `130 items found`), where n is `items.length` (all items, not only the displayed rows).
  - A table (role `table`) with the accessible name (caption) `Preview of the items that will be added`. Its four column headers (role `columnheader`) are, in order, `Item`, `Qty`, `Unit`, `Note`.
  - One body row per item, in input order, each with exactly four cells (role `cell`, in the column order above): the item `name`; `formatQuantity(quantity)`; the `unit`; the `note`, or an empty cell when `note` is undefined. Example: `{ name: 'Chicken breast', quantity: 1.5, unit: 'lb' }` gives cells `Chicken breast`, `1.5`, `lb`, `` (empty); `{ name: 'Flour', quantity: 0.333333, unit: 'kg', note: 'plain' }` gives `Flour`, `0.333`, `kg`, `plain`. The table has one header row plus the body rows.
  - At most 100 body rows are rendered (the first 100 items). When there are more than 100 items, the text `...and {n} more not shown.` is shown (three ASCII dots), where n = `items.length - 100` (130 items give `...and 30 more not shown.`). With exactly 100 items or fewer, no such text exists.

#### 7.3.5 `ListItemRow` (`src/components/shopping-list/ListItemRow.tsx`)

One item of an open shopping list, with a completed toggle, inline editing and removal. It renders a list item (`li`), so it must be placed inside a `ul`/`ol`.

```ts
interface ListItemRowProps {
  item: ListItem;
  onUpdate: (itemId: string, patch: ItemPatch) => Promise<void>;   // ItemPatch is in src/services/api.ts
  onRemove: (itemId: string) => Promise<void>;
}
```

Each handler returns a promise that rejects when the API refuses; the row shows the failure message (below). The row never changes `item` itself; the parent re-renders it with new props. The edits typed in edit mode live only in the row's own state.

**Display (not editing).**
- The item `name`.
- A line `{formatQuantity(quantity)} {unit}`, followed by ` · {note}` (middle dot) only when the item has a non-empty note. Examples: `2 kg`, `0.333 kg`, `2 l · semi-skimmed`. Without a note the row contains no `·`.
- When `item.productId` is `null` (no catalog match) the text `No price data for this item` is shown as one piece of text; for a matched item it is absent.
- A checkbox: an element with role `checkbox` and `aria-checked` equal to `item.completed` (`"true"` / `"false"`). Its accessible name is `Check {name}` when the item is not completed and `Uncheck {name}` when it is. Activating it calls `onUpdate(item.id, { completed: !item.completed })` (the patch has only that key).
- A button named `Edit {name}` (enters edit mode) and a button named `Delete {name}`. Delete calls `onRemove(item.id)` immediately, with no confirmation step.

**Errors and busy state.** Each of the three actions (toggle, remove, save) is one request. From the moment the handler is called until its promise settles the row is busy; a busy row disables the checkbox, the `Edit {name}` and `Delete {name}` buttons (when shown) and, in edit mode, all form controls and buttons (below). When busy ends the controls are enabled again. If the promise rejects, an element with role `alert` shows the error message: the `message` of the thrown `Error` (via `errorMessage(error, fallback)`); when the rejection carries no message (for example `undefined`) a fixed fallback is shown instead:

| Action | Fallback text |
| --- | --- |
| toggle completed | `Could not update the item.` |
| remove | `Could not delete the item.` |
| save an edit | `Could not save the changes.` |

A new request clears an earlier message when it starts.

**Edit mode.** Clicking `Edit {name}` opens a form inside the row and hides the `Edit {name}` and `Delete {name}` buttons and the quantity line (`{quantity} {unit}`); the name, checkbox and the no-price-data text stay. The form contains:
- a field labelled `Quantity`, filled with `formatQuantity(item.quantity)` (a quantity of 2.5 shows `2.5`);
- a select (role `combobox`) labelled `Unit` with its value set to `item.unit`. Its options are exactly the units of `ITEM_UNITS` in that order, shown by their text (`kg`, `lb`, ...); if `item.unit` is not one of them, it is added as one more option after the standard ones (an item with unit `tub` offers `ITEM_UNITS` then `tub`, and `tub` is selected);
- a text field labelled `Note`, filled with `item.note` or empty when it is null;
- a submit button `Save` and a button `Cancel` (type button).

Each time edit mode is opened the fields are reset from the current `item` (so edits typed before a `Cancel` are not kept).

Saving (clicking `Save`, or pressing Enter in a text field of the form):
1. The quantity text is converted with `Number(text)`. If the result is not finite or is not greater than zero (zero, a negative number, an empty field), `onUpdate` is not called, the row stays in edit mode and an element with role `alert` shows `Quantity must be a number greater than zero.`
2. Otherwise `onUpdate(item.id, { quantity, unit, note })` is called once, where `quantity` is the number, `unit` is the selected unit, and `note` is the note text trimmed, or `null` when the trimmed note is empty (cleared field or only spaces). The patch has exactly these three keys. Example: quantity `1.5`, unit `kg`, note `organic` gives `{ quantity: 1.5, unit: 'kg', note: 'organic' }`; note `  fresh  ` gives `note: 'fresh'`.
3. When the promise resolves the row leaves edit mode (the form is gone and `Edit {name}` is back). When it rejects, the row stays in edit mode with the `alert` message above and the form enabled again.

While the save is running the `Quantity`, `Unit` and `Note` controls, the `Save` button and the `Cancel` button are disabled, and `Save` has `aria-busy="true"`.

`Cancel` leaves edit mode without calling `onUpdate`.

#### 7.3.6 `DealsList` (`src/components/comparison/DealsList.tsx`)

The table of current price drops (`GET /api/deals`).

```ts
const DealsList: React.FC<{ deals: DealView[] }>;
```

- Rows are sorted by `dropPct`, largest first. Deals with equal `dropPct` keep their input order. The `deals` array received in props is not reordered or mutated.
- A table (role `table`) with the accessible name (caption) `Current deals, sorted by price drop`, and six column headers (role `columnheader`) in this order: `Product`, `Store`, `Was`, `Now`, `Drop`, `Since`. There is one body row per deal. With no deals the table is still shown, with only the header row.
- Per deal row:
  - The product name is the row header (role `rowheader`, name = `productName`). When `onSale` is true the row header also contains the text `ON SALE`; when false that text appears nowhere in the row.
  - `storeName` in a cell (role `cell`).
  - The old price in a cell whose accessible name (text) is `Was ` followed by `formatMoney(oldPrice)`: for example `Was $5.00`, `Was $1,234.50`. The new price likewise: `Now $3.00`. Money is US dollars with a thousands separator and two decimals.
  - The drop in a cell whose accessible name is `Down ` followed by `formatPct(dropPct)`: for example `Down 19.80%` (a percent sign and two decimals). (The prefixes `Was `, `Now ` and `Down ` may be visually hidden but must be part of the cell's text.)
  - The date `date` (a feed date `YYYY-MM-DD`) in a cell, as `Mon D, YYYY` in English (`2026-01-05` gives `Jan 5, 2026`). The feed date is read as a calendar date, with no time-zone shift. `formatFeedDate` in `src/components/comparison/format.ts` already does this.

## 8. Configuration and commands

Environment: `DATABASE_URL`, `TEST_DATABASE_URL` (wiped by the API tests), `JWT_SECRET`, `PORT`
(3001), `DATA_DIR` (`./data`), `PRICE_SYNC_INTERVAL_MINUTES` (15; 0 disables). See `.env.example`.
Run every command from the repository root.

| Command | Purpose |
|---|---|
| `npm run typecheck`, `npm run lint` | static checks (client and server) |
| `npm run test:unit` | Jest project `unit`: pure logic, client helper and provider tests, no database |
| `npm run test:web` | Jest project `web`: React component tests (jsdom and Testing Library, no browser) |
| `npm run test:api` | Jest project `api`: HTTP and Postgres integration tests, run in band |
| `npm run db:migrate`, `db:seed`, `db:reset`, `sync-prices` | database CLI |
| `npm run dev`, `npm run build`, `npm start` | development, client build, production server |

## 9. Reference data and acceptance numbers

`tests/fixtures/spreadsheet.ts` holds 16 products priced at 8 chains. The seeded latest snapshot
(2026-11-09) reproduces those prices exactly for the 16 SKUs `GS-001` to `GS-016`, and a basket of
one unit of each must give:

| | |
|---|---|
| Store totals (in `GOLDEN_CHAINS` order) | 135.51, 147.27, 141.67, 154.51, 142.02, 150.23, 146.92, 134.61 |
| Optimal split (sum of row lows) | 115.56 |
| Sum of row highs | 182.79 |
| Average store total | 144.0925 (144.09) |
| Savings vs average | 28.53, 19.80% |
| Cheapest single store | `sunrise` (134.61) |
| Best plan, `maxStores` 1 / 8, free travel | 134.61 / 115.56 |

## 10. Quality requirements

- TypeScript strict; `npm run typecheck` and `npm run lint` pass.
- Money in integer cents internally; no floating-point drift in totals.
- Parameterised SQL; no secrets in the repository; passwords never stored or returned in plain text.
- Idempotent ingestion, notification generation and seeding.
- Tests: pure logic has unit tests (no database); the API has integration tests against a real
  Postgres, run in band, from an empty database.

## 11. Known limits

- Distances are straight-line; travel time uses a fixed average speed per mode.
- The optimiser is exponential in the number of stores (2^n); it is meant for about 8 stores.
- Shared-list sync is polling, not push.
- Photo upload of a list is not implemented.
