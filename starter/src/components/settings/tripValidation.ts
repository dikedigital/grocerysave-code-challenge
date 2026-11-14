import type { LatLng } from '../../models';
import { notImplemented } from '../../utils/notImplemented';

/** What the user typed in the trip form, before it is validated. */
export interface TripDraft {
  maxStores: string;
  travelCostPerKm: string;
  lat: string;
  lng: string;
}

export interface TripErrors {
  maxStores?: string;
  travelCostPerKm?: string;
  lat?: string;
  lng?: string;
}

export function validateTrip(draft: TripDraft): TripErrors {
  return notImplemented(draft);
}

/** The home location typed in the draft; null when both fields are blank. Call only on a valid draft. */
export function homeFromDraft(draft: TripDraft): LatLng | null {
  return notImplemented(draft);
}
