import { useEffect, useRef } from 'react';
import { ElapsedTime, Turn } from './ModelPanel.jsx';
import { LETTERS } from '../lib/verdict.js';
import { isAtBottom } from '../lib/scroll.js';

const BUTTON =
  'rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40';

/**
 * Under the panels, once two or more of them have answered: one model reads
 * the answers — by letter, not by name — and says where they agree, where
 * they differ and what is wrong, then merges them into one. The key to the
 * letters sits above what it wrote.
 *
 * Hidden while there is nothing to compare and no verdict to show.
 */
export default function VerdictPanel({
  verdict,
  canCompare,
  startedAt,
  groups,
  judgeId,
  onJudgeChange,
  onCompare,
  onCopy,
  onRemove,
}) {
  const running = Boolean(startedAt);

  // Follows its own output while it streams, as the panels do.
  const scroller = useRef(null);
  const following = useRef(true);
  useEffect(() => {
    if (startedAt) following.current = true;
  }, [startedAt]);
  useEffect(() => {
    const element = scroller.current;
    if (element && following.current) element.scrollTop = element.scrollHeight;
  }, [verdict]);

  if (!verdict && !canCompare) return null;

  const named = new Map(groups.flatMap((group) => group.models.map((model) => [model.id, model])));
  const nameOf = (id) => {
    const model = named.get(id);
    return model ? `${model.emoji} ${model.label}` : id;
  };

  return (
    <section className="flex shrink-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-slate-900">
          <span aria-hidden="true">⚖️</span> Verdict
        </h2>
        {running && <ElapsedTime startedAt={startedAt} label="the verdict" />}
        {!verdict && (
          <span className="text-xs text-slate-400">
            One model compares the answers: where they agree, where they differ, what is wrong.
          </span>
        )}

        <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
          Judged by
          <select
            value={judgeId ?? ''}
            onChange={(event) => onJudgeChange(event.target.value)}
            disabled={running}
            className="max-w-56 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none focus:border-slate-400 disabled:opacity-40"
          >
            {groups.map((group) => (
              <optgroup key={group.id} label={group.label}>
                {group.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={onCompare}
          disabled={!canCompare}
          title="Send the question and every answer, labelled by letter rather than by model, to the judging model"
          className="rounded-md bg-slate-900 px-3 py-1 text-xs font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {verdict ? 'Compare again' : 'Compare answers'}
        </button>
        {verdict && (
          <>
            <button type="button" onClick={onCopy} disabled={running} title="Copy the verdict as Markdown" className={BUTTON}>
              Copy
            </button>
            <button
              type="button"
              onClick={onRemove}
              aria-label="Remove the verdict"
              title="Remove the verdict"
              className={BUTTON}
            >
              ✕
            </button>
          </>
        )}
      </div>

      {verdict && (
        // The key stays in view while what the judge wrote scrolls beneath it.
        <p className="border-t border-slate-200 px-4 pt-2 text-xs text-slate-500">
          {nameOf(verdict.judge)} read the answers as{' '}
          {verdict.labels.map((id, index) => (
            <span key={id} className="mr-2 whitespace-nowrap">
              <span className="font-semibold text-slate-700">{LETTERS[index]}</span> {nameOf(id)}
            </span>
          ))}
        </p>
      )}
      {verdict && (
        <div
          ref={scroller}
          onScroll={() => {
            if (scroller.current) following.current = isAtBottom(scroller.current);
          }}
          className="max-h-[35vh] overflow-y-auto px-4 pt-2 pb-3"
        >
          <ol>
            <Turn turn={verdict.turn} />
          </ol>
        </div>
      )}
    </section>
  );
}
