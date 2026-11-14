-- GrocerySave schema (plain Postgres 13+, no extensions required).

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name  text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Households: a group of users who share shopping lists.
CREATE TABLE households (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  owner_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE household_members (
  household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, user_id)
);

-- Supermarket chains. `provider` names the mock-API adapter that reads the chain's price feed.
CREATE TABLE chains (
  id       text PRIMARY KEY,
  name     text NOT NULL,
  provider text NOT NULL
);

CREATE TABLE stores (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id  text NOT NULL REFERENCES chains(id) ON DELETE CASCADE,
  name      text NOT NULL,
  address   text NOT NULL DEFAULT '',
  city      text NOT NULL DEFAULT '',
  latitude  double precision NOT NULL,
  longitude double precision NOT NULL,
  UNIQUE (chain_id, name)
);

-- Canonical product catalog. List items are matched to a product by name/alias.
CREATE TABLE products (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku      text NOT NULL UNIQUE,
  name     text NOT NULL,
  category text NOT NULL DEFAULT 'Other',
  unit     text NOT NULL DEFAULT 'each',
  aliases  text[] NOT NULL DEFAULT '{}'
);

-- One row per store, product and feed date. `price` is what the shopper pays
-- on that date (the sale price when on_sale); `regular_price` is the shelf price.
CREATE TABLE price_history (
  id             bigserial PRIMARY KEY,
  store_id       uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  product_id     uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price          numeric(10, 2) NOT NULL CHECK (price >= 0),
  regular_price  numeric(10, 2) NOT NULL CHECK (regular_price >= 0),
  on_sale        boolean NOT NULL DEFAULT false,
  effective_date date NOT NULL,
  ingested_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, product_id, effective_date)
);

CREATE INDEX price_history_product_idx ON price_history (product_id, effective_date);

-- Latest known price per store and product.
CREATE VIEW current_prices AS
SELECT DISTINCT ON (store_id, product_id)
  store_id, product_id, price, regular_price, on_sale, effective_date
FROM price_history
ORDER BY store_id, product_id, effective_date DESC;

CREATE TABLE shopping_lists (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  household_id uuid REFERENCES households(id) ON DELETE SET NULL,
  name         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX shopping_lists_owner_idx ON shopping_lists (owner_id);
CREATE INDEX shopping_lists_household_idx ON shopping_lists (household_id);

CREATE TABLE list_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id    uuid NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  name       text NOT NULL,
  quantity   numeric(10, 3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit       text NOT NULL DEFAULT 'each',
  category   text NOT NULL DEFAULT 'Other',
  note       text,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  completed  boolean NOT NULL DEFAULT false,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX list_items_list_idx ON list_items (list_id, position);

CREATE TABLE user_preferences (
  user_id             uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  -- Empty included_chains means "all chains"; excluded_chains always wins.
  included_chains     text[] NOT NULL DEFAULT '{}',
  excluded_chains     text[] NOT NULL DEFAULT '{}',
  max_stores          integer NOT NULL DEFAULT 3 CHECK (max_stores BETWEEN 1 AND 8),
  travel_cost_per_km  numeric(10, 2) NOT NULL DEFAULT 0 CHECK (travel_cost_per_km >= 0),
  travel_mode         text NOT NULL DEFAULT 'driving' CHECK (travel_mode IN ('driving', 'walking')),
  home_latitude       double precision,
  home_longitude      double precision,
  notify_deals        boolean NOT NULL DEFAULT true,
  deal_threshold_pct  numeric(5, 2) NOT NULL DEFAULT 10 CHECK (deal_threshold_pct >= 0),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type           text NOT NULL DEFAULT 'deal',
  product_id     uuid REFERENCES products(id) ON DELETE CASCADE,
  store_id       uuid REFERENCES stores(id) ON DELETE CASCADE,
  effective_date date,
  title          text NOT NULL,
  body           text NOT NULL DEFAULT '',
  old_price      numeric(10, 2),
  new_price      numeric(10, 2),
  created_at     timestamptz NOT NULL DEFAULT now(),
  read_at        timestamptz,
  -- A given price drop is announced to a user at most once.
  UNIQUE (user_id, type, product_id, store_id, effective_date)
);

CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

-- Log of background price refreshes (one row per chain feed per run).
CREATE TABLE sync_runs (
  id            bigserial PRIMARY KEY,
  chain_id      text REFERENCES chains(id) ON DELETE CASCADE,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'error')),
  rows_ingested integer NOT NULL DEFAULT 0,
  error         text
);
