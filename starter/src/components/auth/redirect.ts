import type { Location } from 'react-router-dom';

/** Where protected routes send signed-out visitors, and where a signed-in user goes by default. */
export const LOGIN_PATH = '/login';
export const DEFAULT_AFTER_LOGIN = '/lists';

export interface FromState {
  from?: string;
}

/** Remembers the page a visitor was heading to, to return there after signing in. */
export function rememberDestination(location: Location): FromState {
  return { from: `${location.pathname}${location.search}${location.hash}` };
}

/** The remembered destination, if it is a safe in-app path; otherwise the default page. */
export function destinationAfterLogin(location: Location): string {
  const from = (location.state as FromState | null)?.from;
  // Only same-app absolute paths; "//host" would be a protocol-relative external URL.
  if (typeof from === 'string' && from.startsWith('/') && !from.startsWith('//')) return from;
  return DEFAULT_AFTER_LOGIN;
}
