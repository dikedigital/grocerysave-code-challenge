import React, { useId, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { errorMessage } from '../../hooks/useAsync';
import Button from '../ui/Button';
import { cardClass } from '../comparison/styles';

type Status = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'error'; message: string };

interface SettingsFormProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  /** Saves the section; a rejection is shown as the error message. */
  onSave: () => Promise<unknown>;
  /** Disables the save button, e.g. while a field is invalid. */
  saveDisabled?: boolean;
  children: React.ReactNode;
}

/** A settings section that is a form: title, fields, save button and saved / error feedback. */
const SettingsForm: React.FC<SettingsFormProps> = ({ title, description, icon, onSave, saveDisabled, children }) => {
  const headingId = useId();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus({ kind: 'saving' });
    try {
      await onSave();
      setStatus({ kind: 'saved' });
    } catch (caught) {
      setStatus({ kind: 'error', message: errorMessage(caught) });
    }
  };

  return (
    <form
      aria-labelledby={headingId}
      onSubmit={(event) => void handleSubmit(event)}
      onChange={() => setStatus((current) => (current.kind === 'saved' ? { kind: 'idle' } : current))}
      className={`${cardClass} p-4 sm:p-6`}
    >
      <header className="mb-4 flex items-start gap-3">
        <span className="mt-0.5 text-green-600" aria-hidden="true">
          {icon}
        </span>
        <div>
          <h2 id={headingId} className="text-lg font-semibold text-gray-900">
            {title}
          </h2>
          <p className="text-sm text-gray-600">{description}</p>
        </div>
      </header>

      <div className="space-y-4">{children}</div>

      <footer className="mt-6 flex flex-wrap items-center gap-3">
        <Button type="submit" isLoading={status.kind === 'saving'} disabled={saveDisabled}>
          Save changes
        </Button>
        {status.kind === 'saved' && (
          <p role="status" className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Saved
          </p>
        )}
        {status.kind === 'error' && (
          <p role="alert" className="text-sm font-medium text-red-700">
            Could not save: {status.message}
          </p>
        )}
      </footer>
    </form>
  );
};

export default SettingsForm;
