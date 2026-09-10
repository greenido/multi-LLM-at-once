import { useEffect, useRef } from 'react';
import DeleteButton from './DeleteButton.jsx';
import { formatWhen } from '../lib/history.js';
import { parseModelId, toModel } from '../lib/models.js';

/** "🧠 gpt-4o", or the raw id for a provider this build does not know. */
function modelName(id) {
  const parsed = parseModelId(id);
  if (!parsed) return id;
  const model = toModel({ id, ...parsed });
  return `${model.emoji} ${model.label}`;
}

/**
 * Every saved comparison, newest first, as a sheet down the left edge.
 * Opening one puts its panels back as they were, and asking a question
 * carries it on.
 *
 * Built on <dialog>, like the settings, for the focus trap, the inert
 * background and Escape-to-close.
 */
export default function HistoryPanel({ open, items, loading, error, activeId, query, onQuery, onOpen, onDelete, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => event.target === ref.current && onClose()}
      aria-labelledby="history-title"
      className="m-0 h-dvh max-h-none w-[min(24rem,100vw)] border-r border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/30"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <h2 id="history-title" className="text-sm font-semibold text-slate-900">
            History
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close history"
            className="ml-auto rounded-md px-2 py-1 text-sm text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
          >
            ✕
          </button>
        </div>

        <div className="border-b border-slate-200 px-4 py-3">
          <input
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search questions and answers…"
            aria-label="Search saved comparisons"
            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
          />
        </div>

        {error && <p className="px-4 py-3 text-xs text-red-600">{error}</p>}

        <ol className="min-h-0 flex-1 overflow-y-auto">
          {items.map((item) => (
            <li
              key={item.id}
              className={`flex items-start gap-1 border-b border-slate-100 px-2 py-1 ${
                item.id === activeId ? 'bg-slate-100' : ''
              }`}
            >
              <button
                type="button"
                onClick={() => onOpen(item.id)}
                aria-current={item.id === activeId ? 'true' : undefined}
                className="min-w-0 flex-1 rounded-md px-2 py-2 text-left transition hover:bg-slate-50"
              >
                <span className="block truncate text-sm font-medium text-slate-900">{item.title}</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {formatWhen(item.updatedAt)} · {item.questions} question{item.questions === 1 ? '' : 's'}
                </span>
                <span className="mt-0.5 block truncate text-xs text-slate-400">
                  {item.models.map(modelName).join(' · ')}
                </span>
              </button>
              <div className="pt-2">
                <DeleteButton label={item.title} onDelete={() => onDelete(item.id)} />
              </div>
            </li>
          ))}
        </ol>

        {!loading && !error && items.length === 0 && (
          <p className="px-4 py-6 text-center text-xs leading-relaxed text-slate-400">
            {query.trim()
              ? 'Nothing saved matches that.'
              : 'Nothing saved yet. A comparison is saved as soon as its first answers are in.'}
          </p>
        )}
      </div>
    </dialog>
  );
}
