import React, { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, User as UserIcon } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { errorMessage } from '../../hooks/useAsync';
import { cardClass } from '../comparison/styles';
import Button from '../ui/Button';

/** Who is signed in, and the sign-out button. */
const AccountSection: React.FC = () => {
  const headingId = useId();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignOut = async () => {
    setSigningOut(true);
    setError(null);
    try {
      await signOut();
      navigate('/login');
    } catch (caught) {
      setError(errorMessage(caught));
      setSigningOut(false);
    }
  };

  return (
    <section aria-labelledby={headingId} className={`${cardClass} p-4 sm:p-6`}>
      <header className="mb-4 flex items-start gap-3">
        <UserIcon className="mt-0.5 h-5 w-5 text-green-600" aria-hidden="true" />
        <h2 id={headingId} className="text-lg font-semibold text-gray-900">
          Account
        </h2>
      </header>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-gray-500">Display name</dt>
          <dd className="font-medium text-gray-900">{user?.displayName || '—'}</dd>
        </div>
        <div>
          <dt className="text-gray-500">Email</dt>
          <dd className="font-medium text-gray-900">{user?.email ?? '—'}</dd>
        </div>
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" isLoading={signingOut} onClick={() => void handleSignOut()}>
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
          Sign out
        </Button>
        {error && (
          <p role="alert" className="text-sm font-medium text-red-700">
            Could not sign out: {error}
          </p>
        )}
      </div>
    </section>
  );
};

export default AccountSection;
