import React, { useState } from 'react';
import { Lock, Users } from 'lucide-react';
import { errorMessage } from '../../config/errors';
import type { Household, ShoppingList } from '../../models';
import Alert from '../ui/Alert';

interface ShareControlProps {
  list: ShoppingList;
  households: Household[];
  /** True while the household list is still loading. */
  loadingHouseholds: boolean;
  householdsFailed: boolean;
  isOwner: boolean;
  /** Changes who the list is shared with (null = private); rejects when the API refuses. */
  onChange: (householdId: string | null) => Promise<void>;
}

const PRIVATE = '';

const ShareControl: React.FC<ShareControlProps> = ({
  list,
  households,
  loadingHouseholds,
  householdsFailed,
  isOwner,
  onChange,
}) => {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = list.householdId ?? PRIVATE;
  const knowsCurrent = current === PRIVATE || households.some((household) => household.id === current);

  const handleChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setSaving(true);
    setError(null);
    try {
      await onChange(value === PRIVATE ? null : value);
    } catch (err) {
      setError(errorMessage(err, 'Could not change sharing.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <label htmlFor="share-list" className="flex items-center text-sm font-medium text-gray-700">
        {list.householdId ? (
          <Users className="mr-1.5 h-4 w-4" aria-hidden="true" />
        ) : (
          <Lock className="mr-1.5 h-4 w-4" aria-hidden="true" />
        )}
        Shared with
      </label>
      <select
        id="share-list"
        value={current}
        onChange={(event) => void handleChange(event)}
        disabled={!isOwner || saving || loadingHouseholds}
        aria-describedby="share-list-help"
        className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
      >
        <option value={PRIVATE}>Private (only me)</option>
        {!knowsCurrent && <option value={current}>A household</option>}
        {households.map((household) => (
          <option key={household.id} value={household.id}>
            {household.name} ({household.members.length} {household.members.length === 1 ? 'member' : 'members'})
          </option>
        ))}
      </select>
      <p id="share-list-help" className="mt-1 text-xs text-gray-500">
        {!isOwner
          ? 'Only the list owner can change sharing.'
          : householdsFailed
            ? 'Could not load your households.'
            : households.length === 0 && !loadingHouseholds
              ? 'Create a household in Settings to share lists.'
              : 'Household members can see and edit this list.'}
      </p>
      {error && <Alert className="mt-2">{error}</Alert>}
    </div>
  );
};

export default ShareControl;
