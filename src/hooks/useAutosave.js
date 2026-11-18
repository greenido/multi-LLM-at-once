import { useCallback, useEffect, useRef, useState } from 'react';
import { saveComparison, toSaved } from '../lib/history.js';

/** What a saved comparison is checked against, to tell whether it changed. */
const savedState = (snapshot) => JSON.stringify([snapshot?.transcripts ?? null, snapshot?.verdict ?? null]);

/**
 * Saves the conversation on screen each time an exchange settles — never
 * mid-stream — and only when its answers or its verdict changed. The system
 * prompt and the panels are saved along with it, but changing them is not on
 * its own a reason to save.
 *
 * `markSaved` records a comparison as already saved — one just opened from
 * history, or null for a fresh chat — so opening one to read does not bump it.
 */
export function useAutosave({ id, system, models, transcripts, verdict, busy }) {
  const lastSaved = useRef(null);
  // Saves run one at a time, in order, so an older snapshot never lands last.
  const queue = useRef(Promise.resolve());
  // When a save last landed, so an open history list can re-read itself.
  const [savedAt, setSavedAt] = useState(0);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (busy) return;
    const snapshot = toSaved({ id, system, models, transcripts, verdict });
    if (!snapshot) return;
    const state = savedState(snapshot);
    if (state === lastSaved.current) return;
    lastSaved.current = state;

    queue.current = queue.current
      .then(() => saveComparison(snapshot))
      .then(() => {
        setSavedAt(Date.now());
        setError(null);
      })
      .catch((failure) => {
        // Not marked saved, so the next exchange tries again with everything.
        lastSaved.current = null;
        setError(`Could not save this comparison: ${failure.message}`);
      });
  }, [busy, id, system, models, transcripts, verdict]);

  const markSaved = useCallback((comparison) => {
    lastSaved.current = comparison ? savedState(toSaved(comparison)) : null;
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  return { savedAt, error, dismissError, markSaved };
}
