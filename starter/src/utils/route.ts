import type { LatLng, RoutePlan, Store, TravelMode } from '../models';
import { notImplemented } from './notImplemented';

/** Average speeds used to turn distance into time. */
export const TRAVEL_SPEED_KMH: Record<TravelMode, number> = { driving: 40, walking: 5 };

/** Great-circle distance in kilometres (Earth radius 6371 km). */
export function haversineKm(a: LatLng, b: LatLng): number {
  return notImplemented(a, b);
}

export interface RouteOptions {
  mode?: TravelMode; // default 'driving'
  roundTrip?: boolean; // default true: return to the origin after the last stop
}

/**
 * Orders the stores to minimise total travel distance starting from `origin`.
 * Exact (tries every order) for up to 8 stores; nearest-neighbour followed by 2-opt beyond that.
 * Distances are straight-line (haversine); durations use TRAVEL_SPEED_KMH.
 * Distances are rounded to 2 decimals and durations to whole minutes in the returned plan;
 * totals are computed from unrounded legs and then rounded.
 * Ties between equally short orders go to the order that keeps the input sequence earliest.
 * With no stores the plan has no stops and zero totals.
 */
export function planRoute(
  origin: LatLng,
  stores: Pick<Store, 'id' | 'name' | 'location'>[],
  options: RouteOptions = {}
): RoutePlan {
  return notImplemented(origin, stores, options);
}
