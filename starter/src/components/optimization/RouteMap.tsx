import React from 'react';
import type { RoutePlan, Store } from '../../models';
import { notImplemented } from '../../utils/notImplemented';

interface RouteMapProps {
  route: RoutePlan;
  /** Every store of the comparison; the ones outside the route are drawn as muted dots. */
  stores: Store[];
}

/**
 * Offline route map: no tiles, just the home location, the stops and the other stores projected
 * onto an SVG, with the route drawn as a polyline with direction arrows, a scale bar and a legend.
 * Legs are straight lines between points; roads will differ.
 */
const RouteMap: React.FC<RouteMapProps> = (props) => notImplemented(props);

export default RouteMap;
