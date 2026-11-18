import { useCallback, useState } from 'react';

/** Every panel's turns, by model id, and the two ways a turn changes. */
export function useTranscripts() {
  const [transcripts, setTranscripts] = useState({});

  const appendTurn = useCallback((modelId, turn) => {
    setTranscripts((prev) => ({ ...prev, [modelId]: [...(prev[modelId] ?? []), turn] }));
  }, []);

  /** Patch the newest turn of a transcript, used to grow a streaming answer. */
  const patchLastTurn = useCallback((modelId, patch) => {
    setTranscripts((prev) => {
      const turns = prev[modelId] ?? [];
      if (turns.length === 0) return prev;
      const last = turns[turns.length - 1];
      return { ...prev, [modelId]: [...turns.slice(0, -1), { ...last, ...patch(last) }] };
    });
  }, []);

  return { transcripts, setTranscripts, appendTurn, patchLastTurn };
}
