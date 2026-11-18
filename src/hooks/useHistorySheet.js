import { useCallback, useEffect, useRef, useState } from 'react';
import { listComparisons } from '../lib/history.js';

// Searching history waits for a pause in typing rather than asking per key.
const SEARCH_DELAY_MS = 200;

/**
 * The history sheet's list: read when it opens and as the search changes, and
 * again after a save lands (`savedAt`) while it is open.
 */
export function useHistorySheet({ savedAt }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Searches can overlap, and the answer to an older one must not land last.
  const latestSearch = useRef(0);
  const refresh = useCallback(async (search) => {
    const ticket = ++latestSearch.current;
    try {
      const found = await listComparisons(search);
      if (ticket !== latestSearch.current) return;
      setItems(found);
      setError(null);
    } catch (failure) {
      if (ticket === latestSearch.current) setError(failure.message);
    } finally {
      if (ticket === latestSearch.current) setLoading(false);
    }
  }, []);

  // Loading from the moment it opens, or the search changes, so the sheet
  // does not flash "nothing saved" before the answer.
  const show = useCallback(() => {
    setLoading(true);
    setOpen(true);
  }, []);
  const hide = useCallback(() => setOpen(false), []);
  const search = useCallback((next) => {
    setLoading(true);
    setQuery(next);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const timer = setTimeout(() => refresh(query), query ? SEARCH_DELAY_MS : 0);
    return () => clearTimeout(timer);
  }, [open, query, refresh, savedAt]);

  const forget = useCallback((id) => setItems((current) => current.filter((item) => item.id !== id)), []);

  return { open, show, hide, query, search, items, loading, error, setError, forget };
}
