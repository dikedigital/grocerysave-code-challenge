import React, { useState } from 'react';
import { PlusCircle } from 'lucide-react';
import { errorMessage } from '../../config/errors';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Input from '../ui/Input';

interface CreateListFormProps {
  /** Creates the list; rejects when the API refuses. */
  onCreate: (name: string) => Promise<void>;
}

const MAX_NAME_LENGTH = 100;

const CreateListForm: React.FC<CreateListFormProps> = ({ onCreate }) => {
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the list a name.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await onCreate(trimmed);
      setName('');
    } catch (err) {
      setError(errorMessage(err, 'Could not create the list.'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="bg-white p-5 rounded-lg shadow-md space-y-4">
      <div className="flex items-center">
        <PlusCircle className="h-6 w-6 text-green-600 mr-2" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-gray-900">New shopping list</h2>
      </div>

      {error && <Alert>{error}</Alert>}

      <Input
        label="List name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="e.g. Weekly groceries"
        maxLength={MAX_NAME_LENGTH}
        autoComplete="off"
        disabled={creating}
      />
      <Button type="submit" className="w-full" isLoading={creating}>
        {creating ? 'Creating...' : 'Create list'}
      </Button>
    </form>
  );
};

export default CreateListForm;
