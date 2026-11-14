import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  /** The loaded value; null while loading for the first time, after a failure, or when disabled. */
  data: T | null;
  loading: boolean;
  /** Human-readable failure message, or null. */
  error: string | null;
  /** Runs the loader again, keeping the current data visible meanwhile. */
  reload: () => void;
  /** Replaces the loaded value, e.g. with the response of a mutation. */
  setData: (data: T) => void;
}

interface Stored<T> {
  key: string | null;
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** Turns whatever a promise rejected with into a message that can be shown to the user. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
}

/**
 * Loads a value and tracks its loading and error state.
 *
 * `key` identifies the request: when it changes the value is loaded again and the previous
 * value is dropped; `null` disables loading. A response that arrives after the key changed
 * (or after unmount) is ignored.
 */
export function useAsync<T>(key: string | null, load: () => Promise<T>): AsyncState<T> {
  const loadRef = useRef(load);
  const [stored, setStored] = useState<Stored<T>>({
    key,
    data: null,
    loading: key !== null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    if (key === null) {
      setStored({ key, data: null, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setStored((previous) => ({
      key,
      data: previous.key === key ? previous.data : null,
      loading: true,
      error: null,
    }));
    loadRef.current().then(
      (data) => {
        if (!cancelled) setStored({ key, data, loading: false, error: null });
      },
      (error: unknown) => {
        if (!cancelled) setStored({ key, data: null, loading: false, error: errorMessage(error) });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [key, attempt]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  const setData = useCallback(
    (data: T) => setStored((previous) => ({ ...previous, data, error: null })),
    []
  );

  // Until the effect for a new key has run, the stored value still belongs to the old key.
  const current: Stored<T> =
    stored.key === key ? stored : { key, data: null, loading: key !== null, error: null };

  return { data: current.data, loading: current.loading, error: current.error, reload, setData };
}
