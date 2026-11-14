/**
 * Shared data models. Used by the React app, the pure logic in src/utils and the API server,
 * so this file must stay free of browser, Node and React imports.
 *
 * Money is a plain number of currency units rounded to cents (3.2 means $3.20).
 */

// ---------- Accounts ----------

export interface User {
  id: string;
  email: string;
  displayName: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface HouseholdMember {
  userId: string;
  email: string;
  displayName: string;
  role: 'owner' | 'member';
}

export interface Household {
  id: string;
  name: string;
  ownerId: string;
  members: HouseholdMember[];
}

export type TravelMode = 'driving' | 'walking';

export interface UserPreferences {
  /** Chain ids to consider. Empty means every chain. */
  includedChains: string[];
  /** Chain ids never to consider. Wins over includedChains. */
  excludedChains: string[];
  /** Most stores the user is willing to visit in one trip (1-8). */
  maxStores: number;
  /** Cost of travelling one kilometre, added to multi-store plans. 0 ignores travel. */
  travelCostPerKm: number;
  travelMode: TravelMode;
  /** Where trips start and end. null until the user sets it. */
  home: LatLng | null;
  notifyDeals: boolean;
  /** Minimum price drop, in percent, that counts as a deal. */
  dealThresholdPct: number;
}

// ---------- Catalog ----------

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Chain {
  id: string;
  name: string;
}

export interface Store {
  id: string;
  chainId: string;
  chainName: string;
  name: string;
  address: string;
  city: string;
  location: LatLng;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  aliases: string[];
}

// ---------- Shopping lists ----------

/** One line of a list as typed or uploaded by the user, before it is stored. */
export interface ParsedItem {
  name: string;
  quantity: number;
  unit: string;
  note?: string;
}

export interface ListItem {
  id: string;
  listId: string;
  name: string;
  quantity: number;
  unit: string;
  category: string;
  note: string | null;
  /** Catalog product this item was matched to, or null when nothing matched. */
  productId: string | null;
  completed: boolean;
}

export interface ShoppingList {
  id: string;
  name: string;
  ownerId: string;
  /** Set when the list is shared with a household. */
  householdId: string | null;
  items: ListItem[];
  createdAt: string;
  updatedAt: string;
}

// ---------- Price comparison ----------

/** One list item prepared for pricing. */
export interface BasketLine {
  /** Stable identifier of the line (the list item id). */
  key: string;
  label: string;
  quantity: number;
  /** null when the item matched no catalog product: it cannot be priced anywhere. */
  productId: string | null;
}

/** Current unit prices: prices[productId][storeId]. A missing entry means the store does not sell it. */
export type PriceTable = Record<string, Record<string, number>>;

/** One row of the comparison matrix (one list item across all stores). */
export interface ComparisonRow {
  key: string;
  label: string;
  quantity: number;
  productId: string | null;
  /** Unit price per store id; null where the store does not sell the item. */
  unitPrices: Record<string, number | null>;
  /** unit price x quantity per store id, rounded to cents; null where unavailable. */
  lineTotals: Record<string, number | null>;
  /** Mean of the available line totals (unrounded); null when no store sells the item. */
  average: number | null;
  high: number | null;
  low: number | null;
  /** Stores charging the lowest line total (ties included). */
  lowStoreIds: string[];
  /** average - low. 0 when the item is unavailable everywhere. */
  savings: number;
  /** savings / average x 100. 0 when average is null or 0. */
  savingsPct: number;
}

/** Totals for buying the whole list at a single store. */
export interface StoreTotal {
  storeId: string;
  /** Sum of the line totals this store can supply, rounded to cents. */
  total: number;
  /** Keys of priceable lines this store does not sell. */
  missingKeys: string[];
  /** True when the store sells every priceable line. */
  complete: boolean;
  /** total - optimalTotal ("Comp optimal" in the dashboard). */
  vsOptimal: number;
  /** vsOptimal / optimalTotal x 100. */
  vsOptimalPct: number;
  /** total - cheapest complete store total ("Comp lower"). */
  vsCheapestStore: number;
  /** vsCheapestStore / cheapest complete store total x 100. */
  vsCheapestStorePct: number;
}

export interface ComparisonSummary {
  /** Mean of the complete stores' totals (unrounded). */
  averageTotal: number;
  /** Sum of each row's high. */
  highTotal: number;
  /** Sum of each row's low: the cheapest possible basket when splitting across stores. */
  optimalTotal: number;
  /** averageTotal - optimalTotal. */
  savings: number;
  /** savings / averageTotal x 100. */
  savingsPct: number;
  /** Cheapest complete store; null when no store sells every priceable line. */
  cheapestStoreId: string | null;
  /** Lines that could not be priced at any store (no product match or no price). */
  unpricedKeys: string[];
}

export interface ComparisonResult {
  /** Store ids in column order (the order of the `stores` argument). */
  storeIds: string[];
  rows: ComparisonRow[];
  storeTotals: StoreTotal[];
  summary: ComparisonSummary;
}

// ---------- Route planning ----------

export interface RouteStop {
  storeId: string;
  name: string;
  location: LatLng;
  /** Distance from the previous point (origin or previous stop). */
  legDistanceKm: number;
  legDurationMin: number;
}

export interface RoutePlan {
  mode: TravelMode;
  origin: LatLng;
  /** Stops in visiting order. */
  stops: RouteStop[];
  roundTrip: boolean;
  /** Distance of the final leg back to the origin; 0 when roundTrip is false. */
  returnDistanceKm: number;
  totalDistanceKm: number;
  totalDurationMin: number;
}

// ---------- Purchase planning ----------

export interface PlanLine {
  key: string;
  label: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface PlanStore {
  storeId: string;
  lines: PlanLine[];
  subtotal: number;
}

/** A concrete way to buy the list: which items at which stores, and what it costs. */
export interface ShoppingPlan {
  /** Stores actually visited (each buys at least one line), in route order when a route exists. */
  storeIds: string[];
  stores: PlanStore[];
  /** Sum of all line totals. */
  itemsTotal: number;
  /** Round-trip distance from home through the stores; 0 without a home location. */
  travelDistanceKm: number;
  /** travelDistanceKm x travelCostPerKm, rounded to cents. */
  travelCost: number;
  /** itemsTotal + travelCost: the figure plans are ranked by. */
  grandTotal: number;
  /** Priceable lines none of the plan's stores sells. */
  unavailableKeys: string[];
  /** Present when a home location was given. */
  route: RoutePlan | null;
}

export interface OptimizeOptions {
  /** Most stores a plan may visit. */
  maxStores: number;
  travelCostPerKm: number;
  travelMode: TravelMode;
  /** Trip start/end. null disables travel distance and cost. */
  home: LatLng | null;
}

export interface OptimizationResult {
  /** Best plan that buys everything at one store; null when there are no stores. */
  cheapestSingleStore: ShoppingPlan | null;
  /** Best plan overall within maxStores (lowest grandTotal among plans covering the most lines). */
  bestPlan: ShoppingPlan | null;
  /** Best plan for exactly 1, 2, ... maxStores stores (entries exist only where a plan uses that many). */
  byStoreCount: ShoppingPlan[];
  /** cheapestSingleStore.grandTotal - bestPlan.grandTotal (0 when either is null). */
  savingsVsSingleStore: number;
  /** Lines that could not be priced at any store. */
  unpricedKeys: string[];
}

// ---------- Price tracking ----------

export interface PricePoint {
  storeId: string;
  productId: string;
  /** Feed date, 'YYYY-MM-DD'. */
  date: string;
  price: number;
  regularPrice: number;
  onSale: boolean;
}

export interface Deal {
  storeId: string;
  productId: string;
  date: string;
  /** Price in the previous snapshot. */
  oldPrice: number;
  newPrice: number;
  /** (oldPrice - newPrice) / oldPrice x 100. */
  dropPct: number;
  onSale: boolean;
}

/** A deal enriched with names, as returned by GET /api/deals. */
export interface DealView extends Deal {
  productName: string;
  storeName: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  productId: string | null;
  storeId: string | null;
  oldPrice: number | null;
  newPrice: number | null;
  createdAt: string;
  readAt: string | null;
}

export interface SyncRun {
  id: number;
  chainId: string | null;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'ok' | 'error';
  rowsIngested: number;
  error: string | null;
}

// ---------- API payloads ----------

export interface ComparisonResponse {
  list: ShoppingList;
  /** Stores considered, after the user's chain preferences were applied. */
  stores: Store[];
  result: ComparisonResult;
}

export interface OptimizationResponse {
  list: ShoppingList;
  stores: Store[];
  options: OptimizeOptions;
  result: OptimizationResult;
}

export interface PriceHistoryResponse {
  product: Product;
  points: PricePoint[];
}

export interface ImportResponse {
  /** Items created from the uploaded text or CSV. */
  items: ListItem[];
  /** How many of them matched a catalog product. */
  matched: number;
}
