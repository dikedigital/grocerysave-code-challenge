import type {
  AuthResponse,
  Chain,
  ComparisonResponse,
  DealView,
  Household,
  ImportResponse,
  LatLng,
  ListItem,
  Notification,
  OptimizationResponse,
  ParsedItem,
  PriceHistoryResponse,
  Product,
  RoutePlan,
  ShoppingList,
  Store,
  SyncRun,
  TravelMode,
  User,
  UserPreferences,
} from '../models';

/**
 * Typed client for the GrocerySave API. Every call goes to the same origin under /api
 * (the Vite dev server proxies it to the API server).
 */

const TOKEN_KEY = 'grocerysave.token';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage unavailable (private mode): the session simply will not persist.
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${response.status})`;
    throw new ApiError(response.status, message);
  }
  return data as T;
}

function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export interface NewItemInput {
  name: string;
  quantity?: number;
  unit?: string;
  note?: string;
}

export interface ItemPatch {
  name?: string;
  quantity?: number;
  unit?: string;
  note?: string | null;
  completed?: boolean;
}

export interface OptimizeQuery {
  maxStores?: number;
  travelCostPerKm?: number;
}

export interface RouteRequest {
  storeIds: string[];
  /** Defaults to the user's saved home location. */
  origin?: LatLng;
  mode?: TravelMode;
  roundTrip?: boolean;
}

export const api = {
  auth: {
    register: (email: string, password: string, displayName?: string) =>
      request<AuthResponse>('POST', '/auth/register', { email, password, displayName }),
    login: (email: string, password: string) =>
      request<AuthResponse>('POST', '/auth/login', { email, password }),
    me: () => request<{ user: User }>('GET', '/auth/me'),
  },

  catalog: {
    chains: () => request<Chain[]>('GET', '/chains'),
    stores: () => request<Store[]>('GET', '/stores'),
    products: (q?: string) => request<Product[]>('GET', `/products${query({ q })}`),
    priceHistory: (productId: string) =>
      request<PriceHistoryResponse>('GET', `/products/${productId}/price-history`),
  },

  lists: {
    all: () => request<ShoppingList[]>('GET', '/lists'),
    get: (id: string) => request<ShoppingList>('GET', `/lists/${id}`),
    create: (name: string, householdId?: string | null) =>
      request<ShoppingList>('POST', '/lists', { name, householdId: householdId ?? null }),
    update: (id: string, patch: { name?: string; householdId?: string | null }) =>
      request<ShoppingList>('PATCH', `/lists/${id}`, patch),
    remove: (id: string) => request<void>('DELETE', `/lists/${id}`),

    addItem: (listId: string, item: NewItemInput) =>
      request<ListItem>('POST', `/lists/${listId}/items`, item),
    addItems: (listId: string, items: ParsedItem[]) =>
      request<ImportResponse>('POST', `/lists/${listId}/items/bulk`, { items }),
    /** Uploads pasted text or a CSV file's content; the server parses it. */
    importItems: (listId: string, format: 'text' | 'csv', content: string) =>
      request<ImportResponse>('POST', `/lists/${listId}/import`, { format, content }),
    updateItem: (listId: string, itemId: string, patch: ItemPatch) =>
      request<ListItem>('PATCH', `/lists/${listId}/items/${itemId}`, patch),
    removeItem: (listId: string, itemId: string) =>
      request<void>('DELETE', `/lists/${listId}/items/${itemId}`),

    /** Price matrix across stores. allStores ignores the user's chain preferences. */
    comparison: (listId: string, allStores = false) =>
      request<ComparisonResponse>(
        'GET',
        `/lists/${listId}/comparison${query({ allStores: allStores || undefined })}`
      ),
    /** Cheapest single store and best multi-store plan. Options default to the user's preferences. */
    optimization: (listId: string, options: OptimizeQuery = {}) =>
      request<OptimizationResponse>('GET', `/lists/${listId}/optimization${query({ ...options })}`),
  },

  routes: {
    optimize: (body: RouteRequest) => request<RoutePlan>('POST', '/routes/optimize', body),
  },

  preferences: {
    get: () => request<UserPreferences>('GET', '/preferences'),
    update: (patch: Partial<UserPreferences>) =>
      request<UserPreferences>('PUT', '/preferences', patch),
  },

  households: {
    all: () => request<Household[]>('GET', '/households'),
    create: (name: string) => request<Household>('POST', '/households', { name }),
    addMember: (householdId: string, email: string) =>
      request<Household>('POST', `/households/${householdId}/members`, { email }),
    removeMember: (householdId: string, userId: string) =>
      request<Household>('DELETE', `/households/${householdId}/members/${userId}`),
    remove: (householdId: string) => request<void>('DELETE', `/households/${householdId}`),
  },

  deals: {
    /** Current price drops on products that appear in the user's lists. */
    current: () => request<DealView[]>('GET', '/deals'),
  },

  notifications: {
    all: () => request<Notification[]>('GET', '/notifications'),
    markRead: (id: string) => request<Notification>('POST', `/notifications/${id}/read`),
    markAllRead: () => request<{ updated: number }>('POST', '/notifications/read-all'),
  },

  sync: {
    /** Recent background price refreshes. */
    status: () => request<SyncRun[]>('GET', '/sync/status'),
    /** Re-reads every chain's price feed now. */
    run: () => request<{ runs: SyncRun[] }>('POST', '/sync/run'),
  },
};
