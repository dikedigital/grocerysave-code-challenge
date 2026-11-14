import type { LatLng } from '../../models';
import { notImplemented } from '../../utils/notImplemented';

export interface ProjectedPoint {
  x: number;
  y: number;
}

export interface MapProjection {
  project: (point: LatLng) => ProjectedPoint;
  /** Pixels (in viewBox units) per kilometre. */
  pixelsPerKm: number;
}

/**
 * Equirectangular projection fitted to `points`: longitude is shrunk by cos(latitude) so that
 * distances look right, north is up, and the result is centred inside a width x height box
 * with `padding` kept free on every side.
 */
export function createProjection(
  points: LatLng[],
  width: number,
  height: number,
  padding: number
): MapProjection {
  return notImplemented(points, width, height, padding);
}

/** A round scale-bar length (km) that fits within `maxPixels`. */
export function scaleBarKm(pixelsPerKm: number, maxPixels: number): number {
  return notImplemented(pixelsPerKm, maxPixels);
}

/** "200 m", "1 km", "2.5 km". */
export function formatScale(km: number): string {
  return notImplemented(km);
}
