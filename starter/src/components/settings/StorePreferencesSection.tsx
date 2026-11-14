import React, { useState } from 'react';
import { Store } from 'lucide-react';
import type { Chain, UserPreferences } from '../../models';
import SettingsForm from './SettingsForm';

type ChainMode = 'allow' | 'only' | 'exclude';

const CHOICES: ReadonlyArray<{ mode: ChainMode; label: string; hint: string }> = [
  { mode: 'allow', label: 'Allow', hint: 'use this chain' },
  { mode: 'only', label: 'Only these', hint: 'restrict to chains marked this way' },
  { mode: 'exclude', label: 'Exclude', hint: 'never use this chain' },
];

interface StorePreferencesSectionProps {
  preferences: UserPreferences;
  chains: Chain[];
  save: (patch: Partial<UserPreferences>) => Promise<UserPreferences>;
}

function initialModes(preferences: UserPreferences, chains: Chain[]): Record<string, ChainMode> {
  const modes: Record<string, ChainMode> = {};
  for (const chain of chains) {
    if (preferences.excludedChains.includes(chain.id)) modes[chain.id] = 'exclude';
    else if (preferences.includedChains.includes(chain.id)) modes[chain.id] = 'only';
    else modes[chain.id] = 'allow';
  }
  return modes;
}

const StorePreferencesSection: React.FC<StorePreferencesSectionProps> = ({ preferences, chains, save }) => {
  const [modes, setModes] = useState(() => initialModes(preferences, chains));

  const chainIds = new Set(chains.map((chain) => chain.id));
  const onlyCount = chains.filter((chain) => modes[chain.id] === 'only').length;
  const allExcluded = chains.length > 0 && chains.every((chain) => modes[chain.id] === 'exclude');

  const handleSave = () => {
    // Ids the chain list does not know (a chain that was retired) are kept as they are.
    const keep = (ids: string[]) => ids.filter((id) => !chainIds.has(id));
    return save({
      includedChains: [...keep(preferences.includedChains), ...chains.filter((c) => modes[c.id] === 'only').map((c) => c.id)],
      excludedChains: [...keep(preferences.excludedChains), ...chains.filter((c) => modes[c.id] === 'exclude').map((c) => c.id)],
    });
  };

  return (
    <SettingsForm
      title="Store preferences"
      description="Choose which chains are used when comparing prices and planning trips."
      icon={<Store className="h-5 w-5" />}
      onSave={handleSave}
    >
      <p className="text-sm text-gray-700">
        <strong className="font-medium">Allow</strong> keeps a chain in the comparison.{' '}
        <strong className="font-medium">Only these</strong> restricts the comparison to the chains marked that way. When
        nothing is marked &ldquo;Only these&rdquo;, every chain that is not excluded is used.{' '}
        <strong className="font-medium">Exclude</strong> always wins.
      </p>

      {chains.length === 0 ? (
        <p className="text-sm text-gray-600">No chains are available yet. Load a price feed first.</p>
      ) : (
        <div className="space-y-3">
          {chains.map((chain) => (
            <fieldset key={chain.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <legend className="sr-only">{chain.name}</legend>
              <span className="font-medium text-gray-900" aria-hidden="true">
                {chain.name}
              </span>
              <div className="inline-flex overflow-hidden rounded-md border border-gray-300">
                {CHOICES.map((choice) => (
                  <label key={choice.mode} title={choice.hint} className="cursor-pointer">
                    <input
                      type="radio"
                      name={`chain-${chain.id}`}
                      value={choice.mode}
                      checked={modes[chain.id] === choice.mode}
                      onChange={() => setModes((current) => ({ ...current, [chain.id]: choice.mode }))}
                      className="peer sr-only"
                    />
                    <span
                      className={`block border-r border-gray-300 px-3 py-1.5 text-sm text-gray-700 last:border-r-0 hover:bg-gray-50 peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-green-500 ${
                        choice.mode === 'exclude'
                          ? 'peer-checked:bg-red-700 peer-checked:font-semibold peer-checked:text-white'
                          : 'peer-checked:bg-green-700 peer-checked:font-semibold peer-checked:text-white'
                      }`}
                    >
                      {choice.label}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      )}

      {onlyCount > 0 && (
        <p className="text-sm text-gray-700">
          Comparisons will use only the {onlyCount} chain{onlyCount === 1 ? '' : 's'} marked &ldquo;Only these&rdquo;
          (minus any you exclude).
        </p>
      )}
      {allExcluded && (
        <p role="alert" className="text-sm font-medium text-amber-800">
          Every chain is excluded, so comparisons will have no stores. Allow at least one chain.
        </p>
      )}
    </SettingsForm>
  );
};

export default StorePreferencesSection;
