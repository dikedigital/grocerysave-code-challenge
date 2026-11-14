import React, { useId, useState } from 'react';
import { Crosshair, Map, Trash2 } from 'lucide-react';
import type { TravelMode, UserPreferences } from '../../models';
import { selectClass } from '../comparison/styles';
import Button from '../ui/Button';
import Input from '../ui/Input';
import SettingsForm from './SettingsForm';
import { homeFromDraft, validateTrip, type TripDraft } from './tripValidation';

interface TripSettingsSectionProps {
  preferences: UserPreferences;
  save: (patch: Partial<UserPreferences>) => Promise<UserPreferences>;
}

const GEOLOCATION_ERRORS: Record<number, string> = {
  1: 'Location access was denied. Allow it in your browser, or type the coordinates.',
  2: 'Your position could not be determined. Type the coordinates instead.',
  3: 'Finding your position took too long. Try again, or type the coordinates.',
};

function toDraft(preferences: UserPreferences): TripDraft {
  return {
    maxStores: String(preferences.maxStores),
    travelCostPerKm: String(preferences.travelCostPerKm),
    lat: preferences.home ? String(preferences.home.lat) : '',
    lng: preferences.home ? String(preferences.home.lng) : '',
  };
}

const TripSettingsSection: React.FC<TripSettingsSectionProps> = ({ preferences, save }) => {
  const ids = { maxStores: useId(), cost: useId(), mode: useId(), lat: useId(), lng: useId() };
  const [draft, setDraft] = useState(() => toDraft(preferences));
  const [mode, setMode] = useState<TravelMode>(preferences.travelMode);
  const [locating, setLocating] = useState(false);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);

  const errors = validateTrip(draft);
  const invalid = Object.keys(errors).length > 0;
  const hasHome = draft.lat.trim() !== '' || draft.lng.trim() !== '';
  const update = (field: keyof TripDraft) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((current) => ({ ...current, [field]: event.target.value }));

  const useCurrentLocation = () => {
    if (!('geolocation' in navigator)) {
      setLocationMessage('Your browser cannot share your location. Type the coordinates instead.');
      return;
    }
    setLocating(true);
    setLocationMessage(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDraft((current) => ({
          ...current,
          lat: position.coords.latitude.toFixed(5),
          lng: position.coords.longitude.toFixed(5),
        }));
        setLocating(false);
        setLocationMessage('Location filled in. Save to keep it.');
      },
      (failure) => {
        setLocating(false);
        setLocationMessage(GEOLOCATION_ERRORS[failure.code] ?? 'Your position could not be determined.');
      },
      { timeout: 10000 }
    );
  };

  const handleSave = () =>
    save({
      maxStores: Number(draft.maxStores),
      travelCostPerKm: Number(draft.travelCostPerKm),
      travelMode: mode,
      home: homeFromDraft(draft),
    });

  return (
    <SettingsForm
      title="Trip settings"
      description="How far you are willing to go, and where your trips start and end."
      icon={<Map className="h-5 w-5" />}
      onSave={handleSave}
      saveDisabled={invalid}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Input
          id={ids.maxStores}
          label="Most stores per trip"
          type="number"
          min={1}
          max={8}
          step={1}
          value={draft.maxStores}
          onChange={update('maxStores')}
          error={errors.maxStores}
          aria-invalid={errors.maxStores !== undefined}
        />
        <Input
          id={ids.cost}
          label="Travel cost per km ($)"
          type="number"
          min={0}
          step="0.01"
          value={draft.travelCostPerKm}
          onChange={update('travelCostPerKm')}
          error={errors.travelCostPerKm}
          helperText={errors.travelCostPerKm ? undefined : '0 ignores travel in plans.'}
          aria-invalid={errors.travelCostPerKm !== undefined}
        />
        <div>
          <label htmlFor={ids.mode} className="mb-1 block text-sm font-medium text-gray-700">
            Travel mode
          </label>
          <select
            id={ids.mode}
            className={selectClass}
            value={mode}
            onChange={(event) => setMode(event.target.value as TravelMode)}
          >
            <option value="driving">Driving</option>
            <option value="walking">Walking</option>
          </select>
        </div>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-gray-900">Home location</legend>
        <p className="text-sm text-gray-600">
          Trips start and end here, so routes and travel costs can be worked out. Leave both fields empty to plan
          without travel.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id={ids.lat}
            label="Latitude"
            type="number"
            inputMode="decimal"
            step="any"
            min={-90}
            max={90}
            placeholder="e.g. 40.7128"
            value={draft.lat}
            onChange={update('lat')}
            error={errors.lat}
            aria-invalid={errors.lat !== undefined}
          />
          <Input
            id={ids.lng}
            label="Longitude"
            type="number"
            inputMode="decimal"
            step="any"
            min={-180}
            max={180}
            placeholder="e.g. -74.0060"
            value={draft.lng}
            onChange={update('lng')}
            error={errors.lng}
            aria-invalid={errors.lng !== undefined}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" isLoading={locating} onClick={useCurrentLocation}>
            <Crosshair className="mr-2 h-4 w-4" aria-hidden="true" />
            Use my current location
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!hasHome}
            onClick={() => {
              setDraft((current) => ({ ...current, lat: '', lng: '' }));
              setLocationMessage(null);
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
            Clear
          </Button>
        </div>
        {locationMessage && (
          <p role="status" className="text-sm text-gray-700">
            {locationMessage}
          </p>
        )}
      </fieldset>
    </SettingsForm>
  );
};

export default TripSettingsSection;
