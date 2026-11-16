> **Current state.** The pure logic in `src/utils` is implemented and unit-tested (parsing,
> matching, comparison, routing, purchase optimisation, deal detection; choices in
> `docs/DECISIONS.md`, manual checks in `docs/MANUAL_TESTING.md`). The server (`server/src/app.ts`,
> routes, services, providers, sync job, seed) and several UI components are not written yet.
> The specification is `TECH_SPEC.md`; this README describes the finished application.

# GrocerySave

Compare the cost of a shopping list across supermarkets, find the cheapest single store or the
best multi-store split, and plan the trip.

Everything runs offline against a local Postgres database. Supermarket price APIs are mocked by
CSV files, and routes are computed locally, so no external service is needed.

## Requirements

- Node.js 20 or newer
- PostgreSQL 13 or newer

## Quick start

```bash
npm ci
cp .env.example .env        # then edit DATABASE_URL
export $(grep -v '^#' .env | xargs)
npm run db:reset            # create the schema, load stores, products, prices and demo data
npm run dev                 # API on :3001, web app on :5173
```

Production-style run (one process serving the API and the built web app):

```bash
npm run build
npm start                   # http://localhost:3001
```

The server applies pending migrations on start and seeds an empty database by itself.
The demo account is defined in `server/src/db/seed.ts`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API server (watch mode) and Vite dev server together |
| `npm run build` | Production build of the web app into `dist/` |
| `npm start` | API server; also serves `dist/` when it exists |
| `npm run db:migrate` | Apply pending SQL migrations |
| `npm run db:seed` | Migrate, then load catalog, prices and demo data (idempotent) |
| `npm run db:reset` | Drop everything, migrate and seed |
| `npm run sync-prices` | Re-read every supermarket price feed now |
| `npm run test:unit` | Pure logic tests (no database) |
| `npm run test:api` | API tests against `TEST_DATABASE_URL` (the database is wiped) |
| `npm test` | Both |
| `npm run typecheck` / `npm run lint` | Static checks |

## Logs

Execution logs are written for troubleshooting:

- `logs/app/grocerysave-YYYY-MM-DD.log` holds one JSON object per line (`time`, `level`, `component`,
  `event`, `message`, plus context such as `source`, `line` and `reason`). A new file starts each
  day (UTC).
- A readable copy of each record goes to stderr.
- Settings (see `.env.example`): `LOG_LEVEL` (`debug`, `info`, `warn`, `error`, `silent`; default
  `info`), `LOG_DIR` (empty disables the file) and `LOG_CONSOLE`.

For example, a feed row that cannot be read is logged as `row_skipped`, with the file, the line
number, a reason code and the raw line:

```bash
grep '"event":"row_skipped"' logs/app/grocerysave-*.log
```

## How it is organised

```
data/
  stores.csv, products.csv         catalog
  mock-api/<chain>/<date>.csv      mocked supermarket API responses, one per weekly snapshot
server/
  migrations/                      SQL schema
  src/providers/                   one adapter per feed format -> normalised price rows
  src/jobs/syncPrices.ts           ingests feeds into Postgres; also runs on a timer
  src/routes/, src/services/       Express API
  src/db/                          pool, migrations, seed, CLI
  tests/                           API tests (Jest + supertest)
src/
  models/                          shared types (browser and server)
  utils/                           pure logic: list parsing, product matching, comparison,
                                   purchase optimisation, route planning, deal detection
  services/api.ts                  typed API client
  hooks/, store/, contexts/        React state
  components/                      shopping-list, comparison, optimization, settings, layout, ui
  pages/                           routed pages (lazy-loaded)
tests/fixtures/spreadsheet.ts      golden dataset used by the tests
```

## Mocked supermarket APIs

Each chain publishes a weekly price feed. In this project a feed is a CSV file under
`data/mock-api/<chain>/<YYYY-MM-DD>.csv`, in one of three formats (`standard`, `cents`, `flyer`)
that mimic how real feeds differ: column names, separators, prices in cents, sale flags.

A provider adapter (`server/src/providers/`) turns each format into the same normalised rows.
`syncPrices` stores them in `price_history`; the `current_prices` view exposes the latest price per
store and product. The sync runs at start-up, on a timer (`PRICE_SYNC_INTERVAL_MINUTES`) and on
demand from Settings. To simulate a new week, add a CSV with a later date and sync.

To connect a real API later, write a provider that fetches over HTTP and returns the same rows.

## The comparison numbers

For a list, the comparison matrix shows the price of every item at every store, plus:

- **Total cost** per store: buying everything there.
- **Optimal total**: the sum of each item's lowest price, i.e. splitting across stores.
- **vs optimal**: store total minus the optimal total (percentage of the optimal total).
- **vs cheapest store**: store total minus the cheapest store's total.
- **Savings**: average store total minus the optimal total (percentage of the average).

The purchase planner goes further: given a maximum number of stores and a travel cost per
kilometre, it searches every combination of stores and returns the plan with the lowest
items-plus-travel total, with the stops ordered into the shortest round trip from home.

## Scope notes

- Photo upload of a shopping list is not implemented: it needs an OCR service, which is not
  available offline.
- Shared lists stay in sync by polling every few seconds rather than a push channel.
- Distances are straight-line; travel times use a fixed average speed per travel mode.
