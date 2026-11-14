import React from 'react';
import { X } from 'lucide-react';
import { usePriceHistory } from '../../hooks/usePriceHistory';
import PriceHistoryChart from './PriceHistoryChart';
import { ErrorPanel, LoadingPanel } from './StatusPanel';
import { cardClass } from './styles';

interface PriceHistoryPanelProps {
  productId: string;
  storeNames: Record<string, string>;
  /** Shows a close button when given. */
  onClose?: () => void;
}

/** Loads and shows the weekly price history of one product, one line per store. */
const PriceHistoryPanel: React.FC<PriceHistoryPanelProps> = ({ productId, storeNames, onClose }) => {
  const history = usePriceHistory(productId);
  const product = history.data?.product;
  const points = history.data?.points ?? [];

  return (
    <section aria-label="Price history" className={`${cardClass} p-4 sm:p-6`}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {product ? `Weekly prices: ${product.name}` : 'Weekly prices'}
          </h2>
          {product && <p className="text-sm text-gray-600">Price per {product.unit}, one snapshot per week.</p>}
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close price history"
            className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </header>

      {history.loading && <LoadingPanel label="Loading price history..." />}
      {history.error && <ErrorPanel message={history.error} onRetry={history.reload} />}
      {!history.loading && !history.error && history.data && points.length === 0 && (
        <p className="py-8 text-center text-sm text-gray-600">
          No price snapshots for this product yet. History builds up as weekly price feeds are loaded.
        </p>
      )}
      {!history.loading && points.length > 0 && product && (
        <PriceHistoryChart
          points={points}
          storeNames={storeNames}
          label={`Weekly price history of ${product.name} by store`}
        />
      )}
    </section>
  );
};

export default PriceHistoryPanel;
