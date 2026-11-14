import { ApiError } from '../services/api';

/** Turns anything thrown by the API client into a message that can be shown to the user. */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof ApiError) return error.message || fallback;
  // fetch() rejects with a TypeError when the server cannot be reached at all.
  if (error instanceof TypeError) return 'Cannot reach the server. Check your connection and try again.';
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
