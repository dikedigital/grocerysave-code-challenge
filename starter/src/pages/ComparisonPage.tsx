import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Download, Route } from 'lucide-react';
import MainLayout from '../components/layout/MainLayout';
import Button from '../components/ui/Button';
import ComparisonTable from '../components/comparison/ComparisonTable';
import HeatLegend from '../components/comparison/HeatLegend';
import ListPicker from '../components/comparison/ListPicker';
import PageHeader from '../components/comparison/PageHeader';
import PriceHistoryPanel from '../components/comparison/PriceHistoryPanel';
import StoreCard from '../components/comparison/StoreCard';
import SummaryCards from '../components/comparison/SummaryCards';
import { EmptyPanel, ErrorPanel, LoadingPanel } from '../components/comparison/StatusPanel';
import { buildComparisonCsv, csvFilename, downloadCsv } from '../components/comparison/exportCsv';
import { linkButtonClass } from '../components/comparison/styles';
import { useComparison } from '../hooks/useComparison';
import { useListOptions } from '../hooks/useListOptions';
import type { ComparisonResponse } from '../models';

const ComparisonContent: React.FC<{
  data: ComparisonResponse;
  selectedKey: string | null;
  onSelectKey: (key: string | null) => void;
}> = ({ data, selectedKey, onSelectKey }) => {
  const { stores, result } = data;
  const historyRef = useRef<HTMLDivElement>(null);
  const selectedRow = result.rows.find((row) => row.key === selectedKey) ?? null;
  const storeNames = Object.fromEntries(stores.map((store) => [store.id, store.name]));
  const labelByKey = new Map(result.rows.map((row) => [row.key, row.label]));
  const storeById = new Map(stores.map((store) => [store.id, store]));

  useEffect(() => {
    if (selectedRow) historyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedRow]);

  if (result.rows.length === 0) {
    return (
      <EmptyPanel title="This list has no items yet">
        Add items to the list, then come back to see how each store prices them.{' '}
        <Link to="/lists" className="font-medium text-green-700 underline">
          Go to my lists
        </Link>
      </EmptyPanel>
    );
  }
  if (result.storeIds.length === 0) {
    return (
      <EmptyPanel title="No stores to compare">
        Your store preferences leave no store to compare. Change them in{' '}
        <Link to="/settings" className="font-medium text-green-700 underline">
          Settings
        </Link>{' '}
        or tick &ldquo;Ignore my store preferences&rdquo; above.
      </EmptyPanel>
    );
  }

  return (
    <div className="space-y-6">
      {result.summary.unpricedKeys.length > 0 && (
        <div role="note" className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">
              {result.summary.unpricedKeys.length === 1
                ? '1 item could not be priced'
                : `${result.summary.unpricedKeys.length} items could not be priced`}
            </p>
            <p className="mt-1">
              No store has a price for{' '}
              {result.summary.unpricedKeys.map((key) => labelByKey.get(key) ?? key).join(', ')}. They are left out
              of the totals.
            </p>
          </div>
        </div>
      )}

      <SummaryCards data={data} />

      <div className="space-y-3">
        <HeatLegend />
        <ComparisonTable
          data={data}
          selectedKey={selectedRow?.key ?? null}
          onSelectRow={(row) => onSelectKey(row.key === selectedRow?.key ? null : row.key)}
        />
        <p className="text-xs text-gray-600">Select an item to see its weekly price history.</p>
      </div>

      <div ref={historyRef}>
        {selectedRow?.productId && (
          <PriceHistoryPanel
            productId={selectedRow.productId}
            storeNames={storeNames}
            onClose={() => onSelectKey(null)}
          />
        )}
      </div>

      <section aria-label="Totals by store" className="md:hidden">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Totals by store</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {result.storeTotals.map((total) => {
            const store = storeById.get(total.storeId);
            if (!store) return null;
            return (
              <StoreCard
                key={total.storeId}
                store={store}
                total={total}
                isCheapest={total.storeId === result.summary.cheapestStoreId}
                missingLabels={total.missingKeys.map((key) => labelByKey.get(key) ?? key)}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
};

const ComparisonPage: React.FC = () => {
  const listOptions = useListOptions();
  const [ignorePreferences, setIgnorePreferences] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const comparison = useComparison(listOptions.selectedId, ignorePreferences);

  const handleExport = () => {
    if (!comparison.data) return;
    downloadCsv(csvFilename(comparison.data.list.name), buildComparisonCsv(comparison.data));
  };

  const hasLists = listOptions.lists.length > 0;
  let body: React.ReactNode;
  if (listOptions.loading) {
    body = <LoadingPanel label="Loading your lists..." />;
  } else if (listOptions.error) {
    body = null; // the list picker already shows the error with a retry
  } else if (!hasLists) {
    body = (
      <EmptyPanel title="You have no shopping lists yet">
        Create a list and add the items you buy. This page then shows what the list costs at every store.{' '}
        <Link to="/lists" className="font-medium text-green-700 underline">
          Go to my lists
        </Link>
      </EmptyPanel>
    );
  } else if (comparison.loading && !comparison.data) {
    body = <LoadingPanel label="Comparing prices..." />;
  } else if (comparison.error) {
    body = <ErrorPanel message={comparison.error} onRetry={comparison.reload} />;
  } else if (comparison.data) {
    body = <ComparisonContent data={comparison.data} selectedKey={selectedKey} onSelectKey={setSelectedKey} />;
  }

  return (
    <MainLayout>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader
          title="Price comparison"
          description="What each item on your list costs at every store. Green is the lowest price in the row, red the highest."
          actions={
            comparison.data && comparison.data.result.rows.length > 0 ? (
              <>
                <Button variant="outline" onClick={handleExport}>
                  <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                  Export CSV
                </Button>
                <Link to={`/plan?list=${comparison.data.list.id}`} className={linkButtonClass}>
                  <Route className="h-4 w-4" aria-hidden="true" />
                  Plan this purchase
                </Link>
              </>
            ) : undefined
          }
        />

        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex-1">
            <ListPicker options={listOptions} />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={ignorePreferences}
              onChange={(event) => setIgnorePreferences(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
            />
            Ignore my store preferences
          </label>
        </div>

        <div aria-busy={comparison.loading}>{body}</div>
      </div>
    </MainLayout>
  );
};

export default ComparisonPage;
