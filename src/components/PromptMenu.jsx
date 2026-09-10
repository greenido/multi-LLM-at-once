import { useEffect, useRef, useState } from 'react';
import DeleteButton from './DeleteButton.jsx';

const LABELS = {
  system: { title: 'Saved system prompts', noun: 'system prompt' },
  question: { title: 'Saved questions', noun: 'question' },
};

/** Up to the first line break, for a one-line preview. */
const firstLine = (text) => text.trim().split('\n')[0];

/**
 * Saved prompts of one kind, beside the box they go into. Picking one puts its
 * text in the box — a question is not sent until you send it — and whatever is
 * in the box can be saved under a name.
 *
 * `placement` is which way it opens: down from the top of the page, up from
 * the bottom.
 */
export default function PromptMenu({ kind, prompts, current, onPick, onSave, onDelete, placement = 'down' }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(null);
  const [error, setError] = useState(null);
  const root = useRef(null);

  const { title, noun } = LABELS[kind];
  const mine = prompts.filter((prompt) => prompt.kind === kind);

  function close() {
    setOpen(false);
    setName(null);
    setError(null);
  }

  // A click anywhere else, or Escape, closes it.
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => root.current?.contains(event.target) || close();
    const onKey = (event) => event.key === 'Escape' && close();
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function save(event) {
    event.preventDefault();
    try {
      await onSave(name.trim(), current);
      setName(null);
      setError(null);
    } catch (failure) {
      setError(failure.message);
    }
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={title}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:border-slate-400 hover:text-slate-900"
      >
        Prompts
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={title}
          className={`absolute right-0 z-20 w-80 rounded-lg border border-slate-200 bg-white shadow-lg ${
            placement === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          <p className="px-3 pt-2.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</p>

          <ul className="max-h-64 overflow-y-auto py-1">
            {mine.map((prompt) => (
              <li key={prompt.id} className="flex items-center gap-1 pr-2">
                <button
                  type="button"
                  onClick={() => {
                    onPick(prompt.text);
                    close();
                  }}
                  title={prompt.text}
                  className="min-w-0 flex-1 px-3 py-1.5 text-left transition hover:bg-slate-50"
                >
                  <span className="block truncate text-sm text-slate-900">{prompt.name}</span>
                  <span className="block truncate text-xs text-slate-400">{firstLine(prompt.text)}</span>
                </button>
                <DeleteButton label={prompt.name} onDelete={() => onDelete(prompt.id)} />
              </li>
            ))}
            {mine.length === 0 && <li className="px-3 py-2 text-xs text-slate-400">None saved yet.</li>}
          </ul>

          <div className="border-t border-slate-200 px-3 py-2">
            {name === null ? (
              <button
                type="button"
                onClick={() => setName(firstLine(current).slice(0, 40))}
                disabled={!current.trim()}
                title={current.trim() ? undefined : `Type a ${noun} first`}
                className="text-xs font-medium text-slate-600 transition hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Save the current {noun}…
              </button>
            ) : (
              <form onSubmit={save} className="flex gap-2">
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                  placeholder="Name"
                  aria-label={`Name for this ${noun}`}
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1 text-xs outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                />
                <button
                  type="submit"
                  disabled={!name.trim()}
                  className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Save
                </button>
              </form>
            )}
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
