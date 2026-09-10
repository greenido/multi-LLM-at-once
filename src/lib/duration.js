import { useEffect, useState } from 'react';

/** Human-readable elapsed time: "0.4s", "12.8s", "1m 05s". */
export function formatDuration(ms) {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

/**
 * Milliseconds elapsed since `startedAt`, re-rendering while it is set.
 * Pass undefined when nothing is running and the timer stops.
 */
export function useElapsed(startedAt) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [startedAt]);

  return startedAt ? Math.max(0, now - startedAt) : 0;
}
