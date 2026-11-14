import React, { useId, useState } from 'react';
import { Bell } from 'lucide-react';
import type { UserPreferences } from '../../models';
import Input from '../ui/Input';
import SettingsForm from './SettingsForm';

interface NotificationSettingsSectionProps {
  preferences: UserPreferences;
  save: (patch: Partial<UserPreferences>) => Promise<UserPreferences>;
}

const NotificationSettingsSection: React.FC<NotificationSettingsSectionProps> = ({ preferences, save }) => {
  const toggleId = useId();
  const thresholdId = useId();
  const [notifyDeals, setNotifyDeals] = useState(preferences.notifyDeals);
  const [threshold, setThreshold] = useState(String(preferences.dealThresholdPct));

  const value = threshold.trim() === '' ? Number.NaN : Number(threshold);
  const invalid = !Number.isFinite(value) || value < 0 || value > 100;

  return (
    <SettingsForm
      title="Notifications"
      description="Be told when a product on your lists gets cheaper."
      icon={<Bell className="h-5 w-5" />}
      onSave={() => save({ notifyDeals, dealThresholdPct: value })}
      saveDisabled={invalid}
    >
      <div className="flex items-start gap-3">
        <input
          id={toggleId}
          type="checkbox"
          role="switch"
          checked={notifyDeals}
          onChange={(event) => setNotifyDeals(event.target.checked)}
          className="mt-1 h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
        />
        <label htmlFor={toggleId} className="text-sm">
          <span className="block font-medium text-gray-900">Notify me about deals</span>
          <span className="block text-gray-600">
            When a weekly price feed lowers the price of a product on one of your lists by at least the threshold
            below, a notification appears on the Deals page.
          </span>
        </label>
      </div>
      <div className="max-w-xs">
        <Input
          id={thresholdId}
          label="Deal threshold (% price drop)"
          type="number"
          min={0}
          max={100}
          step="0.5"
          value={threshold}
          onChange={(event) => setThreshold(event.target.value)}
          error={invalid ? 'Enter a percentage from 0 to 100.' : undefined}
          helperText="Smaller drops are ignored."
          aria-invalid={invalid}
        />
      </div>
    </SettingsForm>
  );
};

export default NotificationSettingsSection;
