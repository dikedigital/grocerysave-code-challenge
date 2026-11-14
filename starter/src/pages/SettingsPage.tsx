import React from 'react';
import MainLayout from '../components/layout/MainLayout';
import PageHeader from '../components/comparison/PageHeader';
import { ErrorPanel, LoadingPanel } from '../components/comparison/StatusPanel';
import AccountSection from '../components/settings/AccountSection';
import HouseholdSection from '../components/settings/HouseholdSection';
import NotificationSettingsSection from '../components/settings/NotificationSettingsSection';
import PriceDataSection from '../components/settings/PriceDataSection';
import StorePreferencesSection from '../components/settings/StorePreferencesSection';
import TripSettingsSection from '../components/settings/TripSettingsSection';
import { useAsync } from '../hooks/useAsync';
import { usePreferences } from '../hooks/usePreferences';
import { api } from '../services/api';

const SettingsPage: React.FC = () => {
  const preferences = usePreferences();
  const chains = useAsync('chains', api.catalog.chains);

  let preferenceSections: React.ReactNode;
  if (preferences.loading || chains.loading) {
    preferenceSections = <LoadingPanel label="Loading your preferences..." />;
  } else if (preferences.error || chains.error || !preferences.preferences || !chains.data) {
    preferenceSections = (
      <ErrorPanel
        message={`Could not load your preferences: ${preferences.error ?? chains.error ?? 'no data'}`}
        onRetry={() => {
          preferences.reload();
          chains.reload();
        }}
      />
    );
  } else {
    preferenceSections = (
      <>
        <StorePreferencesSection preferences={preferences.preferences} chains={chains.data} save={preferences.save} />
        <TripSettingsSection preferences={preferences.preferences} save={preferences.save} />
        <NotificationSettingsSection preferences={preferences.preferences} save={preferences.save} />
      </>
    );
  }

  return (
    <MainLayout>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader
          title="Settings"
          description="Which stores to use, how you travel, what to be notified about, who you share lists with, and your account."
        />
        <div className="space-y-6">
          {preferenceSections}
          <HouseholdSection />
          <PriceDataSection chains={chains.data ?? []} />
          <AccountSection />
        </div>
      </div>
    </MainLayout>
  );
};

export default SettingsPage;
