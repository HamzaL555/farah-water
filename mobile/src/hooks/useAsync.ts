import { useState, useCallback, useEffect, useRef } from 'react';
import { ApiError } from '../services/types';

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Loads data with loading/error state and pull-to-refresh support.
 *
 * `run` is returned so screens can refresh on focus (React Navigation's
 * useFocusEffect), which is how the admin sees another worker's new delivery
 * without a manual pull.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: true, error: null });
  const mounted = useRef(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (showSpinner = true) => {
    if (showSpinner && mounted.current) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await loaderRef.current();
      if (mounted.current) setState({ data, loading: false, error: null });
    } catch (err) {
      if (!mounted.current) return;
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Naməlum xəta baş verdi.';
      setState({ data: null, loading: false, error: message });
    }
  }, []);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, run, setData: (data: T) => setState((s) => ({ ...s, data })) };
}

/**
 * Wraps a one-shot write (submit form, confirm dialog) with pending/error state.
 */
export function useSubmit<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (...args: TArgs): Promise<TResult | null> => {
      setSubmitting(true);
      setError(null);
      try {
        return await action(...args);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Əməliyyat uğursuz oldu.',
        );
        return null;
      } finally {
        setSubmitting(false);
      }
    },
    [action],
  );

  return { submit, submitting, error, setError, clearError: () => setError(null) };
}
