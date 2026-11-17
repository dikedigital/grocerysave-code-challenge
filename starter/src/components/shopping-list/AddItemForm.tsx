import React, { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { ITEM_UNITS } from '../../config/constants';
import { errorMessage } from '../../config/errors';
import type { NewItemInput } from '../../services/api';
import Alert from '../ui/Alert';
import Button from '../ui/Button';
import Input from '../ui/Input';

interface AddItemFormProps {
  /** Adds the item to the list; rejects when the API refuses. */
  onAdd: (item: NewItemInput) => Promise<void>;
}

/**
 * The unit menu starts on "auto": no unit is sent, so the server uses the matched product's unit,
 * or `each` when nothing matches (TECH_SPEC 6.3; decision D-140, option A). Picking a unit sends it.
 */
export const AUTO_UNIT = '';
export const AUTO_UNIT_LABEL = 'auto';

const selectClass =
  'w-full rounded-md border border-gray-300 bg-white px-3 py-2 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500 disabled:opacity-50';

const AddItemForm: React.FC<AddItemFormProps> = ({ onAdd }) => {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState<string>(AUTO_UNIT);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    const amount = Number(quantity);
    if (!trimmed) {
      setError('Enter the item name.');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Quantity must be a number greater than zero.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onAdd({ name: trimmed, quantity: amount, unit: unit === AUTO_UNIT ? undefined : unit, note: note.trim() || undefined });
      setName('');
      setQuantity('1');
      setUnit(AUTO_UNIT);
      setNote('');
      nameRef.current?.focus();
    } catch (err) {
      setError(errorMessage(err, 'Could not add the item.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-3">
      {error && <Alert>{error}</Alert>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
        <div className="sm:col-span-5">
          <Input
            ref={nameRef}
            label="Item"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Whole milk"
            maxLength={120}
            autoComplete="off"
            disabled={saving}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:col-span-4">
          <Input
            label="Quantity"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            disabled={saving}
          />
          <div className="space-y-1">
            <label htmlFor="add-item-unit" className="block text-sm font-medium text-gray-700">
              Unit
            </label>
            <select
              id="add-item-unit"
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              className={selectClass}
              disabled={saving}
            >
              <option value={AUTO_UNIT}>{AUTO_UNIT_LABEL}</option>
              {ITEM_UNITS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="sm:col-span-3">
          <Input
            label="Note (optional)"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. semi-skimmed"
            maxLength={200}
            autoComplete="off"
            disabled={saving}
          />
        </div>
      </div>

      <Button type="submit" isLoading={saving} className="w-full sm:w-auto">
        <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
        Add item
      </Button>
    </form>
  );
};

export default AddItemForm;
