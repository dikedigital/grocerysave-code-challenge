import React, { useId, useState } from 'react';
import { useAsync } from '../../hooks/useAsync';
import type { ShoppingList } from '../../models';
import { api } from '../../services/api';
import PriceHistoryPanel from './PriceHistoryPanel';
import { ErrorPanel } from './StatusPanel';
import { cardClass, selectClass } from './styles';

interface PriceTrackingPanelProps {
  /** The list whose matched products can be tracked; null while none is selected. */
  list: ShoppingList | null;
}

/** Pick a product of the list and see its weekly price at every store. */
const PriceTrackingPanel: React.FC<PriceTrackingPanelProps> = ({ list }) => {
  const selectId = useId();
  const [chosenId, setChosenId] = useState<string | null>(null);
  const stores = useAsync('stores', api.catalog.stores);

  const products = new Map<string, string>();
  for (const item of list?.items ?? []) {
    if (item.productId !== null && !products.has(item.productId)) products.set(item.productId, item.name);
  }
  const productId = chosenId !== null && products.has(chosenId) ? chosenId : (products.keys().next().value ?? null);
  const storeNames = Object.fromEntries((stores.data ?? []).map((store) => [store.id, store.name]));

  return (
    <section aria-labelledby="tracking-heading" className="space-y-4">
      <div className={`${cardClass} p-4 sm:p-6`}>
        <h2 id="tracking-heading" className="text-lg font-semibold text-gray-900">
          Price tracking
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Follow a product on your list week by week to see which store is getting cheaper.
        </p>
        {products.size === 0 ? (
          <p className="mt-4 text-sm text-gray-600">
            {list
              ? 'None of the items on this list match a catalog product yet, so there is no price history to show.'
              : 'Pick a list with items to track their prices.'}
          </p>
        ) : (
          <div className="mt-4 max-w-md">
            <label htmlFor={selectId} className="mb-1 block text-sm font-medium text-gray-700">
              Product
            </label>
            <select
              id={selectId}
              className={selectClass}
              value={productId ?? ''}
              onChange={(event) => setChosenId(event.target.value)}
            >
              {[...products].map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {stores.error && <ErrorPanel message={`Could not load store names: ${stores.error}`} onRetry={stores.reload} />}
      {productId !== null && <PriceHistoryPanel key={productId} productId={productId} storeNames={storeNames} />}
    </section>
  );
};

export default PriceTrackingPanel;
