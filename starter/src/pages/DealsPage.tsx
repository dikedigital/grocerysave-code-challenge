import React from 'react';
import MainLayout from '../components/layout/MainLayout';
import DealsList from '../components/comparison/DealsList';
import ListPicker from '../components/comparison/ListPicker';
import NotificationsPanel from '../components/comparison/NotificationsPanel';
import PageHeader from '../components/comparison/PageHeader';
import PriceTrackingPanel from '../components/comparison/PriceTrackingPanel';
import { EmptyPanel, ErrorPanel, LoadingPanel } from '../components/comparison/StatusPanel';
import { useDeals } from '../hooks/useDeals';
import { useListOptions } from '../hooks/useListOptions';

const DealsPage: React.FC = () => {
  const listOptions = useListOptions();
  const deals = useDeals();

  return (
    <MainLayout>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader
          title="Deals and price tracking"
          description="Price drops on products from your lists, your notifications, and the weekly price of each product."
        />

        <div className="space-y-8">
          <section aria-labelledby="deals-heading" className="space-y-3">
            <h2 id="deals-heading" className="text-lg font-semibold text-gray-900">
              Current deals
            </h2>
            {deals.loading && <LoadingPanel label="Looking for deals..." />}
            {deals.error && <ErrorPanel message={deals.error} onRetry={deals.reload} />}
            {!deals.loading && !deals.error && deals.data && deals.data.length === 0 && (
              <EmptyPanel title="No deals right now">
                Deals come from weekly price changes on the products in your lists. When a store lowers a price,
                or puts an item on sale, it shows up here. Add more items to your lists to widen the search.
              </EmptyPanel>
            )}
            {deals.data && deals.data.length > 0 && <DealsList deals={deals.data} />}
          </section>

          <NotificationsPanel />

          <div className="space-y-4">
            <ListPicker options={listOptions} />
            <PriceTrackingPanel list={listOptions.selectedList} />
          </div>
        </div>
      </div>
    </MainLayout>
  );
};

export default DealsPage;
