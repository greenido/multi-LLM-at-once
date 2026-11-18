import { useCallback, useEffect, useMemo, useState } from 'react';
import { MAX_SELECTED, defaultSelection, fetchModels, groupByProvider } from '../lib/models.js';
import { load, save } from '../lib/storage.js';

const SELECTION_KEY = 'multi-llm.selected-models';

/**
 * Every model the server can reach, and which of them have a panel. The
 * selection is remembered, and a remembered model that is no longer available
 * is dropped from it.
 */
export function useCatalogue() {
  const [available, setAvailable] = useState([]);
  const [providers, setProviders] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);

  const apply = useCallback(({ models, providers: found }) => {
    setAvailable(models);
    setProviders(found);

    // Keep a remembered choice only for models that are still available.
    setSelectedIds((current) => {
      const remembered = current.length > 0 ? current : load(SELECTION_KEY, null);
      const stillValid = Array.isArray(remembered)
        ? remembered.filter((id) => models.some((model) => model.id === id))
        : [];
      return stillValid.length > 0 ? stillValid.slice(0, MAX_SELECTED) : defaultSelection(models);
    });
  }, []);

  const fail = useCallback((failure) => {
    setError(failure.message);
    setAvailable([]);
    setProviders([]);
    setSelectedIds([]);
  }, []);

  // The first load starts out loading, so it sets nothing until the answer.
  useEffect(() => {
    fetchModels()
      .then(apply, fail)
      .finally(() => setLoading(false));
  }, [apply, fail]);

  /**
   * `quiet` refreshes the list without blanking the panels, for when a key
   * changed and the catalogue needs re-reading underneath a live conversation.
   */
  const reload = useCallback(
    async ({ quiet = false } = {}) => {
      if (!quiet) setLoading(true);
      setError(null);
      await fetchModels().then(apply, fail);
      if (!quiet) setLoading(false);
    },
    [apply, fail],
  );

  const select = useCallback((ids) => {
    const next = ids.slice(0, MAX_SELECTED);
    setSelectedIds(next);
    save(SELECTION_KEY, next);
  }, []);

  const toggle = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((current) => current !== id) : [...prev, id].slice(0, MAX_SELECTED);
      save(SELECTION_KEY, next);
      return next;
    });
  }, []);

  const selected = useMemo(
    () => selectedIds.map((id) => available.find((model) => model.id === id)).filter(Boolean),
    [selectedIds, available],
  );
  const groups = useMemo(() => groupByProvider(available, providers), [available, providers]);

  return { available, providers, groups, error, loading, reload, selectedIds, selected, select, toggle };
}
