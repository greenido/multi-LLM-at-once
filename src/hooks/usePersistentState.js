import { useCallback, useState } from 'react';
import { load, save } from '../lib/storage.js';

/**
 * State remembered across reloads in localStorage. A stored value that
 * `accept` refuses — from an older version, or edited by hand — reads as the
 * fallback instead.
 */
export function usePersistentState(key, fallback, accept = () => true) {
  const [value, setValue] = useState(() => {
    const stored = load(key, fallback);
    return accept(stored) ? stored : fallback;
  });
  const update = useCallback(
    (next) => {
      setValue(next);
      save(key, next);
    },
    [key],
  );
  return [value, update];
}
