import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/**
 * Runs `fn` on an interval while the screen is mounted.
 *
 * useFocusEffect only fires when the screen GAINS focus, so a screen left open
 * would never notice a delivery recorded elsewhere. This keeps it current
 * without the user doing anything.
 *
 * It stops while the app is backgrounded: a background timer would drain the
 * battery and wake the radio for nothing. The screen's own focus effect still
 * refreshes when the app comes back.
 *
 * @param fn          called on each tick; must be stable (useCallback)
 * @param intervalMs  default 30s
 * @param enabled     set false to pause (e.g. while a form is open)
 */
export function useAutoRefresh(fn: () => void | Promise<unknown>, intervalMs = 30_000, enabled = true): void {
  const saved = useRef(fn);

  // Keep the latest callback without restarting the interval, so an inline
  // arrow function does not defeat the timer on every render.
  useEffect(() => {
    saved.current = fn;
  }, [fn]);

  useEffect(() => {
    if (!enabled) return undefined;

    let active = true;

    const tick = () => {
      if (!active) return;
      if (AppState.currentState === 'active') void saved.current();
    };

    const id = setInterval(tick, intervalMs);

    // Refresh the moment the app comes back to the foreground.
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') tick();
    });

    return () => {
      active = false;
      clearInterval(id);
      sub.remove();
    };
  }, [intervalMs, enabled]);
}
