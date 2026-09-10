import { formatDuration } from './duration.js';

/**
 * The numbers worth comparing on a finished answer.
 *
 * Wall-clock time on its own mixes two different things: how long a model
 * takes to start answering, and how fast it writes once it has. So a turn also
 * records `ttftMs` — time to first token — and speed is measured from that
 * point on, leaving connection setup, queueing and prompt processing out of it.
 */

// A window shorter than this is one or two chunks, and a rate taken over it
// is noise — or a division by nearly zero.
const MIN_STREAMING_MS = 100;

// A warm local model reports a load time of a few milliseconds. Only a cold
// load, where the weights come off disk, is worth pointing out.
export const NOTABLE_LOAD_MS = 500;

/**
 * Output tokens per second for one answer, or null when there is not enough to
 * go on.
 *
 * Ollama times its own decoding, which beats anything measured from here. For
 * everyone else the clock runs from the first token to the last.
 *
 * Reasoning a model does privately — OpenAI's o-series and GPT-5, Gemini, Grok
 * — is billed as output but is no part of the streamed answer, so it is taken
 * off the count: thousands of hidden tokens divided by the few seconds the
 * visible answer took to stream would make a reasoning model look many times
 * faster than it is.
 */
export function tokensPerSecond({ usage, ms, ttftMs }) {
  if (!usage?.completionTokens) return null;
  if (usage.evalMs > 0) return usage.completionTokens / (usage.evalMs / 1000);

  if (ms === undefined || ttftMs === undefined) return null;
  const streamingMs = ms - ttftMs;
  const streamedTokens = usage.completionTokens - (usage.reasoningTokens ?? 0);
  if (streamingMs < MIN_STREAMING_MS || streamedTokens <= 0) return null;
  return streamedTokens / (streamingMs / 1000);
}

/** "1,234 in · 567 out" */
export const formatTokens = ({ promptTokens, completionTokens }) =>
  `${promptTokens.toLocaleString()} in · ${completionTokens.toLocaleString()} out`;

/**
 * Everything known about how an answer was produced, each already formatted
 * and null when it does not apply. The panel and the export both read this, so
 * they cannot disagree about what a number means.
 */
export function turnStats(turn) {
  const speed = tokensPerSecond(turn);
  const loadMs = turn.usage?.loadMs;
  return {
    duration: turn.ms !== undefined ? formatDuration(turn.ms) : null,
    load: loadMs >= NOTABLE_LOAD_MS ? `load ${formatDuration(loadMs)}` : null,
    firstToken: turn.ttftMs !== undefined ? `first token ${formatDuration(turn.ttftMs)}` : null,
    speed: speed === null ? null : `${speed >= 10 ? Math.round(speed) : speed.toFixed(1)} tok/s`,
    tokens: turn.usage ? formatTokens(turn.usage) : null,
  };
}
