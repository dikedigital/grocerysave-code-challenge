import { useEffect, useRef } from 'react';

interface PollingOptions {
  /** Set to false to stop polling (for example while signed out). Defaults to true. */
  enabled?: boolean;
  /** Also run the callback once as soon as polling starts. Defaults to false. */
  immediate?: boolean;
}

/**
 * Calls `callback` every `intervalMs` while the browser tab is visible.
 * Polling pauses when the tab is hidden and resumes, with an immediate call, when it is shown again.
 * A call is skipped while the previous one is still running, so slow responses never pile up.
 * The callback is expected to handle its own errors; a rejection is ignored here.
 */
export function usePolling(
  callback: () => void | Promise<void>,
  intervalMs: number,
  { enabled = true, immediate = false }: PollingOptions = {}
): void {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;

    let timer: number | undefined;
    let running = false;

    const tick = async () => {
      if (running || document.hidden) return;
      running = true;
      try {
        await savedCallback.current();
      } catch {
        // Ignored: the next tick tries again.
      } finally {
        running = false;
      }
    };

    const stop = () => {
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    };
    const start = () => {
      stop();
      timer = window.setInterval(tick, intervalMs);
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        stop();
      } else {
        void tick();
        start();
      }
    };

    if (!document.hidden) {
      if (immediate) void tick();
      start();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [intervalMs, enabled, immediate]);
}
