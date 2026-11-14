import React, { useId, useState } from 'react';
import { Crown, UserMinus, UserPlus } from 'lucide-react';
import type { Household } from '../../models';
import Button from '../ui/Button';
import Input from '../ui/Input';

interface HouseholdCardProps {
  household: Household;
  currentUserId: string | null;
  /** Runs a mutation and reports its outcome in the section's feedback line. */
  run: (action: () => Promise<void>, success: string) => Promise<boolean>;
  onAddMember: (householdId: string, email: string) => Promise<void>;
  onRemoveMember: (householdId: string, userId: string, isSelf: boolean) => Promise<void>;
  onDelete: (householdId: string) => Promise<void>;
}

/** One household: its members, plus the actions the current user's role allows. */
const HouseholdCard: React.FC<HouseholdCardProps> = ({
  household,
  currentUserId,
  run,
  onAddMember,
  onRemoveMember,
  onDelete,
}) => {
  const emailId = useId();
  const [email, setEmail] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isOwner = household.ownerId === currentUserId;

  const handleAdd = async (event: React.FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    if (!address) return;
    if (await run(() => onAddMember(household.id, address), `Added ${address} to ${household.name}.`)) setEmail('');
  };

  return (
    <article className="rounded-md border border-gray-200 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-900">{household.name}</h3>
        <span className="text-sm text-gray-600">
          {household.members.length} {household.members.length === 1 ? 'member' : 'members'}
          {isOwner ? ' · you are the owner' : ''}
        </span>
      </header>

      <ul className="mt-3 divide-y divide-gray-100">
        {household.members.map((member) => {
          const isSelf = member.userId === currentUserId;
          const canRemove = isOwner && member.role !== 'owner' && !isSelf;
          return (
            <li key={member.userId} className="flex items-center justify-between gap-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-gray-900">
                  {member.displayName || member.email}
                  {isSelf && <span className="ml-1 font-normal text-gray-600">(you)</span>}
                </p>
                <p className="truncate text-gray-600">{member.email}</p>
              </div>
              <div className="flex flex-shrink-0 items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                    member.role === 'owner' ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {member.role === 'owner' && <Crown className="h-3 w-3" aria-hidden="true" />}
                  {member.role === 'owner' ? 'Owner' : 'Member'}
                </span>
                {canRemove && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void run(
                        () => onRemoveMember(household.id, member.userId, false),
                        `Removed ${member.displayName || member.email}.`
                      )
                    }
                  >
                    <UserMinus className="mr-1 h-4 w-4" aria-hidden="true" />
                    Remove
                    <span className="sr-only"> {member.displayName || member.email}</span>
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {isOwner && (
        <form onSubmit={(event) => void handleAdd(event)} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Input
              id={emailId}
              label="Add a member by email"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              helperText="They need a GrocerySave account already."
            />
          </div>
          <Button type="submit" variant="outline" disabled={email.trim() === ''}>
            <UserPlus className="mr-2 h-4 w-4" aria-hidden="true" />
            Add member
          </Button>
        </form>
      )}

      <footer className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
        {isOwner ? (
          confirmingDelete ? (
            <>
              <span className="text-sm text-gray-800">Delete this household? Shared lists stop being shared.</span>
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => void run(() => onDelete(household.id), `Deleted ${household.name}.`)}
              >
                Yes, delete
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirmingDelete(true)}>
              Delete household
            </Button>
          )
        ) : (
          currentUserId !== null && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                void run(() => onRemoveMember(household.id, currentUserId, true), `You left ${household.name}.`)
              }
            >
              Leave household
            </Button>
          )
        )}
      </footer>
    </article>
  );
};

export default HouseholdCard;
