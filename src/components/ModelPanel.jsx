import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import Markdown from './Markdown.jsx';
import { cutShortNote, modelToMarkdown, totalTokens } from '../lib/transcript.js';
import { formatDuration, useElapsed } from '../lib/duration.js';
import { formatSpend, turnStats } from '../lib/metrics.js';
import { isAtBottom } from '../lib/scroll.js';
import { MAX_ANSWER_TOKENS, describeSettings, maxTemperature } from '../lib/modelSettings.js';

const ROLE_LABELS = { user: 'Me', assistant: 'AI', error: 'Error' };

const TIMING_HELP =
  'Total time · model load (a cold local model only) · time to the first token, reasoning included · output speed once it started';

/**
 * The live timer ticks ten times a second. On its own that would re-render the
 * whole panel — and re-parse every answer in it — so it renders itself.
 */
export function ElapsedTime({ startedAt, label }) {
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
 * The reasoning ahead of an answer, kept apart from it. Open while it is all
 * that is arriving, so a model thinking for a minute is visibly doing
 * something; folded away once the answer starts, and there to open after.
 */
function Thinking({ turn }) {
  const thinking = turn.thinkingMs === undefined;
  return (
    <details
      open={thinking && Boolean(turn.streaming)}
      className="mb-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5"
    >
      <summary className="cursor-pointer select-none text-xs font-medium text-slate-500">
        {thinking ? 'Thinking…' : `Thought for ${formatDuration(turn.thinkingMs)}`}
      </summary>
      <Markdown className="mt-1.5 text-slate-500">{turn.reasoning}</Markdown>
    </details>
  );
}

/**
 * One turn. Memoized on the turn object, which is the whole point: a streaming
 * answer replaces only the last turn, so everything above it keeps its identity
 * and react-markdown does not re-parse an answer that has not changed. The
 * verdict renders its answer with it too, so it reads like any other.
 */
export const Turn = memo(function Turn({ turn }) {
  const { duration, load, firstToken, speed, tokens, settings } = turnStats(turn);
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
        {settings && (
          <span title="Asked with these settings" className="ml-2 font-mono normal-case text-slate-400">
            {settings}
          </span>
        )}
      </span>

      {turn.role === 'assistant' ? (
        <div className="mt-1">
          {turn.reasoning?.trim() && <Thinking turn={turn} />}
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

      {turn.truncated && <p className="mt-1 text-xs text-amber-700">{cutShortNote(turn.truncated)}</p>}
      {turn.note && <p className="mt-1 text-xs text-red-600">{turn.note}</p>}
    </li>
  );
});

/**
 * A panel's temperature and answer cap. Blank is the provider's default. A
 * value is kept as typed while it is being typed, and only a valid one is
 * passed on — "0." on the way to "0.5" is not an error.
 */
function PanelSettings({ model, settings, onChange }) {
  const id = useId();
  const highest = maxTemperature(model.provider);
  const [draft, setDraft] = useState(() => ({
    temperature: settings.temperature?.toString() ?? '',
    maxTokens: settings.maxTokens?.toString() ?? '',
  }));

  const commit = (field, text, valid) => {
    setDraft((current) => ({ ...current, [field]: text }));
    if (text.trim() === '') {
      onChange(model.id, (current) => {
        const { [field]: _dropped, ...rest } = current ?? {};
        return rest;
      });
      return;
    }
    const value = Number(text);
    if (valid(value)) onChange(model.id, (current) => ({ ...current, [field]: value }));
  };

  const input =
    'w-20 rounded-md border border-slate-300 bg-white px-2 py-1 font-mono text-xs text-slate-700 outline-none focus:border-slate-400 invalid:border-red-300';

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500">
      <label htmlFor={`${id}-temperature`} className="flex items-center gap-1.5">
        Temperature
        <input
          id={`${id}-temperature`}
          type="number"
          inputMode="decimal"
          min="0"
          max={highest}
          step="0.1"
          placeholder="default"
          value={draft.temperature}
          onChange={(event) =>
            commit('temperature', event.target.value, (value) => Number.isFinite(value) && value >= 0 && value <= highest)
          }
          className={input}
        />
        <span className="text-slate-400">0–{highest}</span>
      </label>
      <label htmlFor={`${id}-max`} className="flex items-center gap-1.5">
        Max answer tokens
        <input
          id={`${id}-max`}
          type="number"
          inputMode="numeric"
          min="1"
          max={MAX_ANSWER_TOKENS}
          step="1"
          placeholder="default"
          value={draft.maxTokens}
          onChange={(event) =>
            commit('maxTokens', event.target.value, (value) => Number.isInteger(value) && value >= 1 && value <= MAX_ANSWER_TOKENS)
          }
          className={input}
        />
      </label>
      <button
        type="button"
        onClick={() => {
          setDraft({ temperature: '', maxTokens: '' });
          onChange(model.id, () => ({}));
        }}
        className="ml-auto rounded-md px-2 py-1 font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
      >
        Use defaults
      </button>
    </div>
  );
}

function ModelPanel({ model, turns, startedAt, settings, onCopy, onRetry, onSettingsChange }) {
  const running = Boolean(startedAt);
  const [tuning, setTuning] = useState(false);
  const tuned = describeSettings(settings);
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

        {tuned && (
          <span title="This panel's own settings" className="font-mono text-[11px] text-slate-500">
            {tuned}
          </span>
        )}

        {spent && (
          <span
            title="Tokens used by this conversation, and their cost where the provider publishes prices"
            className="font-mono text-[11px] tabular-nums text-slate-400"
          >
            {formatSpend(total)}
          </span>
        )}

        <button
          type="button"
          onClick={() => setTuning((open) => !open)}
          aria-expanded={tuning}
          title={`Temperature and answer length for ${model.label}`}
          className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 aria-expanded:bg-slate-100 aria-expanded:text-slate-900"
        >
          Tune
        </button>

        <button
          type="button"
          onClick={() => onRetry(model)}
          disabled={running || !asked}
          title={`Ask ${model.label} the last question again, replacing its answer. The other panels are not re-asked.`}
          className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
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

      {tuning && <PanelSettings model={model} settings={settings} onChange={onSettingsChange} />}

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
