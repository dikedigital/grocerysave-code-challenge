import React, { useId, useState } from 'react';
import { selectClass } from '../comparison/styles';

export interface PlanSettings {
  maxStores: number;
  travelCostPerKm: number;
}

interface PlanControlsProps {
  value: PlanSettings;
  onChange: (value: PlanSettings) => void;
}

const MAX_STORE_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8];

/** Max stores and travel cost per km. The cost is applied when the field loses focus or Enter is pressed. */
const PlanControls: React.FC<PlanControlsProps> = ({ value, onChange }) => {
  const storesId = useId();
  const costId = useId();
  const costHelpId = useId();
  const [draft, setDraft] = useState<string | null>(null);

  const shownCost = draft ?? String(value.travelCostPerKm);
  const parsed = Number(shownCost);
  const invalid = shownCost.trim() === '' || !Number.isFinite(parsed) || parsed < 0;

  const commitCost = () => {
    if (draft === null) return;
    if (!invalid && parsed !== value.travelCostPerKm) onChange({ ...value, travelCostPerKm: parsed });
    setDraft(null);
  };

  return (
    <form
      className="grid gap-4 sm:grid-cols-2 lg:max-w-xl"
      onSubmit={(event) => {
        event.preventDefault();
        commitCost();
      }}
    >
      <div>
        <label htmlFor={storesId} className="mb-1 block text-sm font-medium text-gray-700">
          Visit at most
        </label>
        <select
          id={storesId}
          className={selectClass}
          value={value.maxStores}
          onChange={(event) => onChange({ ...value, maxStores: Number(event.target.value) })}
        >
          {MAX_STORE_CHOICES.map((count) => (
            <option key={count} value={count}>
              {count} {count === 1 ? 'store' : 'stores'}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={costId} className="mb-1 block text-sm font-medium text-gray-700">
          Travel cost per km ($)
        </label>
        <input
          id={costId}
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={shownCost}
          aria-invalid={invalid}
          aria-describedby={costHelpId}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitCost}
          className={`${selectClass} ${invalid ? 'border-red-500' : ''}`}
        />
        <p id={costHelpId} className={`mt-1 text-xs ${invalid ? 'text-red-700' : 'text-gray-600'}`}>
          {invalid ? 'Enter 0 or more.' : '0 ignores travel when comparing plans.'}
        </p>
      </div>
    </form>
  );
};

export default PlanControls;
