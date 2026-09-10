import { transcriptToText } from '../lib/transcript.js';
import { formatDuration, useElapsed } from '../lib/duration.js';

const ROLE_STYLES = {
  user: 'text-slate-500',
  assistant: 'text-slate-900',
  error: 'text-red-600',
};

const ROLE_LABELS = { user: 'Me', assistant: 'AI', error: 'Error' };

export default function ModelPanel({ model, turns, startedAt, onCopy }) {
  const elapsed = useElapsed(startedAt);
  const running = Boolean(startedAt);

  return (
    <section className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-900">
          <span aria-hidden="true">{model.emoji}</span> {model.label}
        </h2>

        {running && (
          <>
            <span
              role="status"
              aria-label={`Waiting for ${model.label}`}
              className="inline-block size-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600"
            />
            <span className="font-mono text-xs tabular-nums text-slate-500">
              {formatDuration(elapsed)}
            </span>
          </>
        )}

        <button
          type="button"
          onClick={() => onCopy(transcriptToText(turns))}
          disabled={turns.length === 0}
          title="Copy to clipboard"
          className="ml-auto rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Copy
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {turns.length === 0 ? (
          <p className="text-sm text-slate-400">Ask something to see {model.label}&rsquo;s answer.</p>
        ) : (
          <ol className="space-y-4">
            {turns.map((turn, index) => (
              <li key={index} className="text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {ROLE_LABELS[turn.role]}
                  {turn.ms !== undefined && (
                    <span className="ml-2 font-mono normal-case tabular-nums text-slate-400">
                      {formatDuration(turn.ms)}
                    </span>
                  )}
                </span>
                <p className={`mt-1 font-mono text-[13px] leading-relaxed whitespace-pre-wrap ${ROLE_STYLES[turn.role]}`}>
                  {turn.text}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
