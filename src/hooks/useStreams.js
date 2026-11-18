import { useCallback, useEffect, useRef, useState } from 'react';
import { withCost } from '../lib/metrics.js';
import { hasSettings } from '../lib/modelSettings.js';
import { streamQuery } from '../lib/stream.js';

// Tokens can arrive faster than it is worth re-rendering for, so chunks are
// coalesced into at most one state update per this many milliseconds.
const FLUSH_INTERVAL_MS = 60;

/**
 * Every request in flight — the panels', keyed by model id, and the
 * verdict's — with when each started, and the means to stop them.
 *
 * It also keeps the conversation's generation. Starting a different
 * conversation (New chat, or opening a saved one) moves it on, and a request
 * from the one before that is still settling writes nothing into the new one.
 */
export function useStreams() {
  // key -> timestamp the in-flight request started, or undefined when idle.
  const [startedAt, setStartedAt] = useState({});
  // key -> AbortController for the in-flight request.
  const controllers = useRef(new Map());
  const conversation = useRef(0);

  // Leaving the page should not leave requests running against a provider.
  useEffect(() => {
    const running = controllers.current;
    return () => {
      running.forEach((controller) => controller.abort());
      running.clear();
    };
  }, []);

  const stop = useCallback(() => {
    controllers.current.forEach((controller) => controller.abort());
  }, []);

  const abort = useCallback((key) => {
    controllers.current.get(key)?.abort();
  }, []);

  /** Stop everything, and let nothing still settling write into what comes next. */
  const nextConversation = useCallback(() => {
    stop();
    conversation.current += 1;
  }, [stop]);

  /**
   * Stream one answer into a turn: a panel's newest, or the verdict's. `key`
   * names the request, for Stop and the spinner; `begin` puts the empty turn
   * where it will grow, and `update` patches it.
   */
  const streamTurn = useCallback(async ({ key, model, messages, system, think, settings, begin, update }) => {
    const begunAt = Date.now();
    const controller = new AbortController();
    controllers.current.set(key, controller);
    setStartedAt((prev) => ({ ...prev, [key]: begunAt }));

    // Writes go to this conversation only. After New chat, or opening a saved
    // one, the panels hold something else, and a request still settling from
    // before would otherwise append "[stopped]" to the wrong answer.
    const generation = conversation.current;
    const patch = (patchTurn) => {
      if (conversation.current === generation) update(patchTurn);
    };

    // The turn the tokens stream into, with the settings it was asked with.
    begin({ role: 'assistant', text: '', streaming: true, ...(hasSettings(settings) ? { settings } : {}) });

    let pending = '';
    let pendingReasoning = '';
    let lastFlush = 0;
    // When the first token arrived — of reasoning or of the answer — which
    // splits waiting for a model from watching it write. Kept even for an
    // answer that fails or is stopped.
    let firstTokenAt;
    // Reasoning runs from its own first token to the answer's first, or to
    // the end for a model stopped while it was still thinking.
    let reasoningAt;
    let answerAt;
    const thinkingMs = () => (answerAt ?? Date.now()) - reasoningAt;
    const timings = () => ({
      ms: Date.now() - begunAt,
      ...(firstTokenAt === undefined ? {} : { ttftMs: firstTokenAt - begunAt }),
      ...(reasoningAt === undefined ? {} : { thinkingMs: thinkingMs() }),
    });
    const flush = () => {
      if (!pending && !pendingReasoning) return;
      const chunk = pending;
      const thought = pendingReasoning;
      pending = '';
      pendingReasoning = '';
      patch((last) => ({
        text: last.text + chunk,
        ...(thought ? { reasoning: (last.reasoning ?? '') + thought } : {}),
      }));
    };
    const queue = () => {
      const now = performance.now();
      if (now - lastFlush >= FLUSH_INTERVAL_MS) {
        lastFlush = now;
        flush();
      }
    };

    try {
      const { truncated } = await streamQuery({
        model: model.id,
        messages,
        system,
        think,
        settings,
        signal: controller.signal,
        onReasoning: (chunk) => {
          firstTokenAt ??= Date.now();
          reasoningAt ??= Date.now();
          pendingReasoning += chunk;
          queue();
        },
        onChunk: (chunk) => {
          firstTokenAt ??= Date.now();
          if (answerAt === undefined) {
            answerAt = Date.now();
            // The answer has started, so the thinking is over: the panel folds
            // it away and says for how long.
            if (reasoningAt !== undefined) {
              flush();
              patch(() => ({ thinkingMs: thinkingMs() }));
            }
          }
          pending += chunk;
          queue();
        },
        onUsage: (usage) => patch(() => ({ usage: withCost(usage, model.pricing) })),
      });
      flush();
      patch(() => ({ streaming: false, ...timings(), ...(truncated ? { truncated } : {}) }));
    } catch (error) {
      flush();
      const cancelled = error.name === 'AbortError';
      patch((last) => {
        // A cancelled answer keeps whatever streamed in, and so does one that
        // failed partway — reasoning included. A failure with nothing at all
        // to show becomes the error itself.
        const streamed = Boolean(last.text || last.reasoning);
        return {
          streaming: false,
          ...timings(),
          role: cancelled || streamed ? last.role : 'error',
          text: cancelled
            ? `${last.text}${last.text ? '\n' : ''}[stopped]`
            : streamed ? last.text : error.message,
          note: !cancelled && streamed ? error.message : undefined,
        };
      });
    } finally {
      // In finally, so a throw anywhere above still clears the spinner — but
      // only this request's: the same model may already be answering again.
      if (controllers.current.get(key) === controller) controllers.current.delete(key);
      setStartedAt((prev) => (prev[key] === begunAt ? { ...prev, [key]: undefined } : prev));
    }
  }, []);

  // Anything in flight at all, a panel since deselected included.
  const busy = Object.values(startedAt).some(Boolean);

  return { startedAt, busy, streamTurn, stop, abort, nextConversation };
}
