import React, { useState } from 'react';
import { Car, Clock, Footprints, Home, Navigation } from 'lucide-react';
import { useAsync } from '../../hooks/useAsync';
import type { RoutePlan, ShoppingPlan, Store, TravelMode } from '../../models';
import { api } from '../../services/api';
import { formatDuration, formatKm } from '../comparison/format';
import { ErrorPanel } from '../comparison/StatusPanel';
import { cardClass, focusRing } from '../comparison/styles';
import RouteMap from './RouteMap';

const MODES: ReadonlyArray<{ mode: TravelMode; label: string; icon: React.ReactNode }> = [
  { mode: 'driving', label: 'Driving', icon: <Car className="h-4 w-4" aria-hidden="true" /> },
  { mode: 'walking', label: 'Walking', icon: <Footprints className="h-4 w-4" aria-hidden="true" /> },
];

const ModeToggle: React.FC<{
  mode: TravelMode;
  disabled: boolean;
  onChange: (mode: TravelMode) => void;
}> = ({ mode, disabled, onChange }) => (
  <div role="group" aria-label="Travel mode" className="inline-flex rounded-md border border-gray-300 bg-white p-0.5">
    {MODES.map((option) => (
      <button
        key={option.mode}
        type="button"
        aria-pressed={mode === option.mode}
        disabled={disabled}
        onClick={() => onChange(option.mode)}
        className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium disabled:opacity-60 ${focusRing} ${
          mode === option.mode ? 'bg-green-600 text-white' : 'text-gray-700 hover:bg-gray-100'
        }`}
      >
        {option.icon}
        {option.label}
      </button>
    ))}
  </div>
);

const StopList: React.FC<{ route: RoutePlan }> = ({ route }) => (
  <ol className="space-y-3">
    <li className="flex items-center gap-3 text-sm">
      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-blue-700 text-white">
        <Home className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="font-medium text-gray-900">Start at home</span>
    </li>
    {route.stops.map((stop, index) => (
      <li key={stop.storeId} className="flex items-start gap-3 text-sm">
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-green-700 font-bold text-white">
          {index + 1}
        </span>
        <div>
          <p className="font-medium text-gray-900">{stop.name}</p>
          <p className="text-gray-600">
            {formatKm(stop.legDistanceKm)} · {formatDuration(stop.legDurationMin)} from the previous point
          </p>
        </div>
      </li>
    ))}
    {route.roundTrip && (
      <li className="flex items-start gap-3 text-sm">
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-blue-700 text-white">
          <Home className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <p className="font-medium text-gray-900">Back home</p>
          <p className="text-gray-600">{formatKm(route.returnDistanceKm)} return leg</p>
        </div>
      </li>
    )}
  </ol>
);

interface RoutePanelProps {
  plan: ShoppingPlan;
  route: RoutePlan;
  /** Stores of the comparison, for the muted dots on the map. */
  stores: Store[];
}

/**
 * Map, stop list and totals of a plan's route. Switching the travel mode asks the API for the route
 * again with the plan's stores and shows the new distances and times.
 */
const RoutePanel: React.FC<RoutePanelProps> = ({ plan, route: planRoute, stores }) => {
  const [mode, setMode] = useState<TravelMode>(planRoute.mode);
  const changed = mode !== planRoute.mode;
  const requested = useAsync<RoutePlan>(changed ? `route:${plan.storeIds.join(',')}:${mode}` : null, () =>
    api.routes.optimize({ storeIds: plan.storeIds, mode })
  );
  const route = changed ? requested.data : planRoute;

  return (
    <section aria-label="Route" className={`${cardClass} p-4 sm:p-6`}>
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Route</h2>
        <ModeToggle mode={mode} disabled={requested.loading} onChange={setMode} />
      </header>

      {requested.error && <ErrorPanel message={requested.error} onRetry={requested.reload} />}

      {route && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" aria-busy={requested.loading}>
          <RouteMap route={route} stores={stores} />
          <div className="space-y-5">
            <StopList route={route} />
            <dl className="grid grid-cols-3 gap-3 border-t border-gray-100 pt-4 text-sm">
              <div>
                <dt className="flex items-center gap-1 text-gray-500">
                  <Navigation className="h-3.5 w-3.5" aria-hidden="true" />
                  Distance
                </dt>
                <dd className="font-semibold text-gray-900">{formatKm(route.totalDistanceKm)}</dd>
              </div>
              <div>
                <dt className="flex items-center gap-1 text-gray-500">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  Time
                </dt>
                <dd className="font-semibold text-gray-900">{formatDuration(route.totalDurationMin)}</dd>
              </div>
              <div>
                <dt className="text-gray-500">Mode</dt>
                <dd className="font-semibold capitalize text-gray-900">{route.mode}</dd>
              </div>
            </dl>
          </div>
        </div>
      )}
      {!route && requested.loading && (
        <p role="status" className="py-10 text-center text-sm text-gray-600">
          Recalculating the route...
        </p>
      )}
    </section>
  );
};

export default RoutePanel;
