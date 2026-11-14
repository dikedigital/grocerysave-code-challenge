import React, { useId } from 'react';
import type { ListOptions } from '../../hooks/useListOptions';
import { selectClass } from './styles';

interface ListPickerProps {
  options: Pick<ListOptions, 'lists' | 'loading' | 'error' | 'reload' | 'selectedId' | 'select'>;
}

/** The list selector shown at the top of every feature page. */
const ListPicker: React.FC<ListPickerProps> = ({ options }) => {
  const id = useId();
  const { lists, loading, error, reload, selectedId, select } = options;

  return (
    <div className="max-w-md">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700">
        Shopping list
      </label>
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          Could not load your lists: {error}{' '}
          <button
            type="button"
            onClick={reload}
            className="font-medium underline focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            Try again
          </button>
        </p>
      ) : (
        <select
          id={id}
          className={selectClass}
          value={selectedId ?? ''}
          disabled={loading || lists.length === 0}
          onChange={(event) => select(event.target.value)}
        >
          {loading && <option value="">Loading lists...</option>}
          {!loading && lists.length === 0 && <option value="">No lists yet</option>}
          {lists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.name} ({list.items.length} {list.items.length === 1 ? 'item' : 'items'})
            </option>
          ))}
        </select>
      )}
    </div>
  );
};

export default ListPicker;
