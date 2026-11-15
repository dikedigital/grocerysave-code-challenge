/**
 * The golden basket as compareBasket / optimizePurchase inputs, built from the spreadsheet fixture:
 * one store per chain (in GOLDEN_CHAINS order), one basket line of quantity 1 per product (in
 * GOLDEN_PRODUCTS order) and a price table holding every spreadsheet price.
 *
 * Ids are deliberately different from the chain ids and skus (store "store-sunrise" belongs to chain
 * "sunrise"), so a test cannot pass by confusing the two.
 */
import type { BasketLine, PriceTable, Store } from '../../src/models';
import { GOLDEN_CHAINS, GOLDEN_PRODUCTS } from './spreadsheet';
import { PORT_MARLOWE_STORES as PORT_MARLOWE_LOCATIONS } from './route';

export const goldenStoreId = (chainId: string) => `store-${chainId}`;
export const goldenProductId = (sku: string) => `product-${sku}`;
export const goldenLineKey = (sku: string) => `line-${sku}`;

export const GOLDEN_STORES: Store[] = GOLDEN_CHAINS.map((chain, index) => ({
  id: goldenStoreId(chain.id),
  chainId: chain.id,
  chainName: chain.name,
  name: `${chain.name} Downtown`,
  address: `${index + 1} Main Street`,
  city: 'Springfield',
  location: { lat: 40 + index / 100, lng: -74 - index / 100 },
}));

export const GOLDEN_LINES: BasketLine[] = GOLDEN_PRODUCTS.map((product) => ({
  key: goldenLineKey(product.sku),
  label: product.name,
  quantity: 1,
  productId: goldenProductId(product.sku),
}));

export const GOLDEN_PRICES: PriceTable = Object.fromEntries(
  GOLDEN_PRODUCTS.map((product) => [
    goldenProductId(product.sku),
    Object.fromEntries(GOLDEN_CHAINS.map((chain, index) => [goldenStoreId(chain.id), product.prices[index]])),
  ])
);

/**
 * The golden stores at their real Port Marlowe coordinates (data/stores.csv; same ids), for plans
 * with travel. GOLDEN_STORES above sit on an artificial diagonal line and are not meant for routes.
 * The seeded app prices exactly these stores with the golden prices (TECH_SPEC 9).
 */
export const GOLDEN_STORES_PORT_MARLOWE: Store[] = GOLDEN_STORES.map((store, index) => ({
  ...store,
  name: PORT_MARLOWE_LOCATIONS[index].name,
  address: '',
  city: 'Port Marlowe',
  location: { ...PORT_MARLOWE_LOCATIONS[index].location },
}));
