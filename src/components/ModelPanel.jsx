import { memo, useCallback, useEffect, useRef } from 'react';
import Markdown from './Markdown.jsx';
import { modelToMarkdown, totalTokens } from '../lib/transcript.js';
import { formatDuration, useElapsed } from '../lib/duration.js';
import { formatTokens, turnStats } from '../lib/metrics.js';
import { isAtBottom } from '../lib/scroll.js';

const ROLE_LABELS = { user: 'Me', assistant: 'AI', error: 'Error' };

const TIMING_HELP =
  'Total time · model load (a cold local model only) · time to the first token · output speed once it started';

/**
 * The live timer ticks ten times a second. On its own that would re-render the
 * whole panel — and re-parse every answer in it — so it renders itself.
 */
function ElapsedTime({ startedAt, label }) {
  const elapsed = useElapsed(startedAt);
  return (
    <>
      <span
        role="status"
        aria-label={`Waiting for ${label}`}
        className="inline-block size-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600"
      />
      <span className="font-mono text-xs tabular-nums text-slate-500">
        {formatDuration(elapsed)}
      </span>
    </>
  );
}

/**
 * One turn. Memoized on the turn object, which is the whole point: a streaming
 * answer replaces only the last turn, so everything above it keeps its identity
 * and react-markdown does not re-parse an answer that has not changed.
 */
const Turn = memo(function Turn({ turn }) {
  const { duration, load, firstToken, speed, tokens } = turnStats(turn);
  const timing = [duration, load, firstToken, speed].filter(Boolean).join(' · ');

  return (
    <li>
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {ROLE_LABELS[turn.role]}
        {timing && (
          <span title={TIMING_HELP} className="ml-2 font-mono normal-case tabular-nums text-slate-400">
            {timing}
          </span>
        )}
        {tokens && (
          <span className="ml-2 font-mono normal-case tabular-nums text-slate-300">{tokens}</span>
        )}
      </span>

      {turn.role === 'assistant' ? (
        <div className="mt-1">
          <Markdown>{turn.text}</Markdown>
          {turn.streaming && (
            <span
              aria-hidden="true"
              className="inline-block h-4 w-[2px] animate-pulse bg-slate-500 align-text-bottom"
            />
          )}
        </div>
      ) : (
        // The question as typed, and errors verbatim — neither is markdown.
        <p
          className={`mt-1 text-[13px] leading-relaxed whitespace-pre-wrap ${
            turn.role === 'error' ? 'font-mono text-red-600' : 'text-slate-500'
          }`}
        >
          {turn.text}
        </p>
      )}

      {turn.note && <p className="mt-1 text-xs text-red-600">{turn.note}</p>}
    </li>
  );
});

function ModelPanel({ model, turns, startedAt, onCopy, onRetry }) {
  const running = Boolean(startedAt);
  const asked = turns.some((turn) => turn.role === 'user');

  // Cloud models bill by the token, so the panel keeps a running total.
  const total = totalTokens(turns);
  const spent = total.promptTokens + total.completionTokens > 0;

  const scroller = useRef(null);
  // Whether the view should chase the output. A ref, not state: it changes on
  // every scroll event and nothing renders differently because of it.
  const following = useRef(true);

  // Asking a new question is a deliberate move to the present, so following
  // resumes even if the user had scrolled up to read something earlier.
  useEffect(() => {
    if (startedAt) following.current = true;
  }, [startedAt]);

  // Four models streaming at once means four panels that would each have to be
  // scrolled by hand. `turns` gets a new identity on every flush, which is
  // exactly when there is new text to reveal.
  useEffect(() => {
    const element = scroller.current;
    if (element && following.current) element.scrollTop = element.scrollHeight;
  }, [turns]);

  const onScroll = useCallback(() => {
    if (scroller.current) following.current = isAtBottom(scroller.current);
  }, []);

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-900">
          <span aria-hidden="true">{model.emoji}</span> {model.label}
        </h2>

        {running && <ElapsedTime startedAt={startedAt} label={model.label} />}

        {spent && (
          <span
            title="Tokens used by this conversation"
            className="font-mono text-[11px] tabular-nums text-slate-400"
          >
            {formatTokens(total)}
          </span>
        )}

        <button
          type="button"
          onClick={() => onRetry(model)}
          disabled={running || !asked}
          title={`Ask ${model.label} the last question again, replacing its answer. The other panels are not re-asked.`}
          className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Retry
        </button>

        <button
          type="button"
          onClick={() => onCopy(modelToMarkdown(model, turns))}
          disabled={turns.length === 0}
          title="Copy this conversation as Markdown"
          className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Copy
        </button>
      </div>

      <div
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
      >
        {turns.length === 0 ? (
          <p className="text-sm text-slate-400">Ask something to see {model.label}&rsquo;s answer.</p>
        ) : (
          <ol className="space-y-4">
            {turns.map((turn, index) => (
              <Turn key={index} turn={turn} />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

// A panel only re-renders for its own model: one model streaming should not
// re-render the three beside it.
export default memo(ModelPanel);
