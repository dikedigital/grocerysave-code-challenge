import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, MapPinOff, Table2 } from 'lucide-react';
import MainLayout from '../components/layout/MainLayout';
import ListPicker from '../components/comparison/ListPicker';
import PageHeader from '../components/comparison/PageHeader';
import { EmptyPanel, ErrorPanel, LoadingPanel } from '../components/comparison/StatusPanel';
import { linkOutlineClass } from '../components/comparison/styles';
import PlanControls, { type PlanSettings } from '../components/optimization/PlanControls';
import PlanStoreCard from '../components/optimization/PlanStoreCard';
import PlanSummary from '../components/optimization/PlanSummary';
import RoutePanel from '../components/optimization/RoutePanel';
import StoreCountTable from '../components/optimization/StoreCountTable';
import { planKey } from '../components/optimization/planKey';
import { useListOptions } from '../hooks/useListOptions';
import { useOptimization } from '../hooks/useOptimization';
import { usePreferences } from '../hooks/usePreferences';
import type { OptimizationResponse } from '../models';

const Callout: React.FC<{ icon: React.ReactNode; tone: 'amber' | 'blue'; children: React.ReactNode }> = ({
  icon,
  tone,
  children,
}) => (
  <div
    role="note"
    className={`flex gap-3 rounded-lg border p-4 text-sm ${
      tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-blue-200 bg-blue-50 text-blue-900'
    }`}
  >
    <span className="mt-0.5 flex-shrink-0" aria-hidden="true">
      {icon}
    </span>
    <div>{children}</div>
  </div>
);

const PlanContent: React.FC<{ data: OptimizationResponse }> = ({ data }) => {
  const { list, stores, result } = data;
  const [pickedKey, setPickedKey] = useState<string | null>(null);

  const storeById = new Map(stores.map((store) => [store.id, store]));
  const labelByKey = new Map(list.items.map((item) => [item.id, item.name]));
  const labelsOf = (keys: string[]) => keys.map((key) => labelByKey.get(key) ?? key).join(', ');

  if (list.items.length === 0) {
    return (
      <EmptyPanel title="This list has no items yet">
        Add items to the list and the planner will work out where to buy them.{' '}
        <Link to="/lists" className="font-medium text-green-700 underline">
          Go to my lists
        </Link>
      </EmptyPanel>
    );
  }
  if (!result.bestPlan && !result.cheapestSingleStore) {
    return (
      <EmptyPanel title="Nothing to plan">
        No store has a price for the items on this list. Check your store preferences in{' '}
        <Link to="/settings" className="font-medium text-green-700 underline">
          Settings
        </Link>
        , or add items that match catalog products.
      </EmptyPanel>
    );
  }

  const plan =
    result.byStoreCount.find((candidate) => planKey(candidate) === pickedKey) ?? result.bestPlan ?? result.byStoreCount[0] ?? null;
  const route = plan?.route ?? null;
  const orderOf = (storeId: string) => (plan ? plan.storeIds.indexOf(storeId) : 0);

  return (
    <div className="space-y-6">
      {result.unpricedKeys.length > 0 && (
        <Callout tone="amber" icon={<AlertCircle className="h-5 w-5" />}>
          <p className="font-medium">
            {result.unpricedKeys.length === 1 ? '1 item' : `${result.unpricedKeys.length} items`} could not be priced
          </p>
          <p className="mt-1">No store has a price for {labelsOf(result.unpricedKeys)}. They are not in any plan below.</p>
        </Callout>
      )}

      <PlanSummary result={result} storeById={storeById} />

      <StoreCountTable
        plans={result.byStoreCount}
        bestPlan={result.bestPlan}
        selectedKey={plan ? planKey(plan) : null}
        storeById={storeById}
        onSelect={(chosen) => setPickedKey(planKey(chosen))}
      />

      {plan && (
        <>
          {plan.unavailableKeys.length > 0 && (
            <Callout tone="amber" icon={<AlertCircle className="h-5 w-5" />}>
              <p className="font-medium">Not available in this plan</p>
              <p className="mt-1">None of the stores in this plan sells {labelsOf(plan.unavailableKeys)}.</p>
            </Callout>
          )}

          <section aria-label="Shopping lists by store" className="space-y-3">
            <h2 className="text-lg font-semibold text-gray-900">
              What to buy where{' '}
              <span className="text-sm font-normal text-gray-600">
                ({plan.storeIds.length} {plan.storeIds.length === 1 ? 'store' : 'stores'}
                {route ? ', in route order' : ''})
              </span>
            </h2>
            <div className="grid gap-4 lg:grid-cols-2">
              {[...plan.stores]
                .sort((a, b) => orderOf(a.storeId) - orderOf(b.storeId))
                .map((planStore) => {
                  const stopIndex = route ? route.stops.findIndex((stop) => stop.storeId === planStore.storeId) : -1;
                  return (
                    <PlanStoreCard
                      key={planStore.storeId}
                      planStore={planStore}
                      store={storeById.get(planStore.storeId)}
                      stopNumber={stopIndex >= 0 ? stopIndex + 1 : null}
                    />
                  );
                })}
            </div>
          </section>

          {route ? (
            <RoutePanel key={planKey(plan)} plan={plan} route={route} stores={stores} />
          ) : (
            <Callout tone="blue" icon={<MapPinOff className="h-5 w-5" />}>
              <p className="font-medium">No route without a home location</p>
              <p className="mt-1">
                Save where your trips start in{' '}
                <Link to="/settings" className="font-medium underline">
                  Settings
                </Link>{' '}
                to see travel distance, cost, a route and a map. The plan above ignores travel until then.
              </p>
            </Callout>
          )}
        </>
      )}
    </div>
  );
};

const PlanPage: React.FC = () => {
  const listOptions = useListOptions();
  const preferences = usePreferences();
  const [override, setOverride] = useState<PlanSettings | null>(null);

  const settings: PlanSettings | null =
    override ??
    (preferences.preferences
      ? { maxStores: preferences.preferences.maxStores, travelCostPerKm: preferences.preferences.travelCostPerKm }
      : null);
  const optimization = useOptimization(listOptions.selectedId, settings);

  let body: React.ReactNode;
  if (listOptions.loading || preferences.loading) {
    body = <LoadingPanel label="Loading your lists and preferences..." />;
  } else if (listOptions.error) {
    body = null; // the list picker shows the error and a retry
  } else if (preferences.error) {
    body = <ErrorPanel message={`Could not load your preferences: ${preferences.error}`} onRetry={preferences.reload} />;
  } else if (listOptions.lists.length === 0) {
    body = (
      <EmptyPanel title="You have no shopping lists yet">
        Create a list and add the items you buy; this page then plans where to buy them.{' '}
        <Link to="/lists" className="font-medium text-green-700 underline">
          Go to my lists
        </Link>
      </EmptyPanel>
    );
  } else if (optimization.loading && !optimization.data) {
    body = <LoadingPanel label="Planning your purchase..." />;
  } else if (optimization.error) {
    body = <ErrorPanel message={optimization.error} onRetry={optimization.reload} />;
  } else if (optimization.data) {
    body = <PlanContent key={optimization.data.list.id} data={optimization.data} />;
  }

  return (
    <MainLayout>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader
          title="Plan your purchase"
          description="The cheapest way to buy your list, counting what you save on items against the cost of travelling between stores."
          actions={
            listOptions.selectedId ? (
              <Link to={`/compare?list=${listOptions.selectedId}`} className={linkOutlineClass}>
                <Table2 className="h-4 w-4" aria-hidden="true" />
                Price comparison
              </Link>
            ) : undefined
          }
        />

        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <ListPicker options={listOptions} />
          {settings && <PlanControls value={settings} onChange={setOverride} />}
        </div>

        <div aria-busy={optimization.loading}>{body}</div>
      </div>
    </MainLayout>
  );
};

export default PlanPage;
