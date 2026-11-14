import React, { useId, useState } from 'react';
import { CheckCircle2, Users } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { errorMessage } from '../../hooks/useAsync';
import { useHouseholds } from '../../hooks/useHouseholds';
import { ErrorPanel, LoadingPanel } from '../comparison/StatusPanel';
import { cardClass } from '../comparison/styles';
import Button from '../ui/Button';
import Input from '../ui/Input';
import HouseholdCard from './HouseholdCard';

type Feedback = { kind: 'ok' | 'error'; text: string } | null;

/** Households of the user: members, creating, and the owner's add / remove / delete actions. */
const HouseholdSection: React.FC = () => {
  const headingId = useId();
  const nameId = useId();
  const { user } = useAuth();
  const households = useHouseholds();
  const [name, setName] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);

  /** Runs a mutation, shows its outcome, and resolves true when it worked. */
  const run = async (action: () => Promise<void>, success: string): Promise<boolean> => {
    setBusy(true);
    setFeedback(null);
    try {
      await action();
      setFeedback({ kind: 'ok', text: success });
      return true;
    } catch (caught) {
      setFeedback({ kind: 'error', text: errorMessage(caught) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    if (await run(() => households.create(trimmed), `Created ${trimmed}.`)) setName('');
  };

  return (
    <section aria-labelledby={headingId} className={`${cardClass} p-4 sm:p-6`}>
      <header className="mb-4 flex items-start gap-3">
        <Users className="mt-0.5 h-5 w-5 text-green-600" aria-hidden="true" />
        <div>
          <h2 id={headingId} className="text-lg font-semibold text-gray-900">
            Household
          </h2>
          <p className="text-sm text-gray-600">
            Share shopping lists with the people you shop with. Create a household and add members here, then share
            a list with it from the list page.
          </p>
        </div>
      </header>

      <div className="space-y-4">
        {households.loading && <LoadingPanel label="Loading households..." />}
        {households.error && <ErrorPanel message={households.error} onRetry={households.reload} />}
        {!households.loading && !households.error && households.households.length === 0 && (
          <p className="text-sm text-gray-600">You are not in a household yet.</p>
        )}

        {households.households.map((household) => (
          <HouseholdCard
            key={household.id}
            household={household}
            currentUserId={user?.id ?? null}
            run={run}
            onAddMember={households.addMember}
            onRemoveMember={households.removeMember}
            onDelete={households.remove}
          />
        ))}

        <form onSubmit={(event) => void handleCreate(event)} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Input
              id={nameId}
              label="New household"
              placeholder="e.g. The Smiths"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Button type="submit" isLoading={busy} disabled={name.trim() === ''}>
            Create household
          </Button>
        </form>

        {feedback?.kind === 'ok' && (
          <p role="status" className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {feedback.text}
          </p>
        )}
        {feedback?.kind === 'error' && (
          <p role="alert" className="text-sm font-medium text-red-700">
            {feedback.text}
          </p>
        )}
      </div>
    </section>
  );
};

export default HouseholdSection;
