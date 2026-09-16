import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_SELECTED } from '../lib/models.js';
import { formatListPrice } from '../lib/metrics.js';
import { groupByMaker, matchesFilter, shortModelName } from '../lib/picker.js';

/**
 * Full catalogue for one provider. Opened from "+N more" so the inline picker
 * can stay short: search, maker groups, and list prices where the provider
 * publishes them (OpenRouter).
 */
export default function ModelBrowseModal({
  open,
  group,
  selected,
  initialFilter = '',
  onToggle,
  onClose,
}) {
  const ref = useRef(null);
  const searchRef = useRef(null);
  const [filter, setFilter] = useState(initialFilter);
  const atLimit = selected.length >= MAX_SELECTED;
  const onlyOne = selected.length === 1;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Reset the search when a different provider (or a pre-filled query) opens.
  useEffect(() => {
    if (open) setFilter(initialFilter);
  }, [open, initialFilter, group?.id]);

  useEffect(() => {
    if (open) {
      // Let the dialog finish opening before focusing, or the caret lands nowhere.
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  const matched = useMemo(() => {
    if (!group) return [];
    return group.models.filter((model) => matchesFilter(model, filter));
  }, [group, filter]);

  const makers = useMemo(() => groupByMaker(matched), [matched]);
  const priced = matched.some((model) => model.pricing);
  const freeCount = matched.filter(
    (model) => model.pricing && model.pricing.prompt === 0 && model.pricing.completion === 0,
  ).length;

  if (!group) return null;

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(event) => event.target === ref.current && onClose()}
      aria-labelledby="browse-models-title"
      className="m-auto flex h-[min(40rem,calc(100vh-2rem))] w-[min(44rem,calc(100vw-2rem))] flex-col rounded-xl border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <h2 id="browse-models-title" className="text-sm font-semibold text-slate-900">
            {group.label}
          </h2>
          <p className="text-xs text-slate-500">
            {matched.length.toLocaleString()} model{matched.length === 1 ? '' : 's'}
            {priced && freeCount > 0 ? ` · ${freeCount} free` : ''}
            {' · '}
            {selected.length}/{MAX_SELECTED} selected
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close model list"
          className="rounded-md px-2 py-1 text-sm text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
        >
          ✕
        </button>
      </div>

      <div className="shrink-0 border-b border-slate-200 px-5 py-3">
        <input
          ref={searchRef}
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter models…"
          aria-label="Filter models"
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {makers.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-slate-400">No model matches that.</p>
        ) : (
          makers.map(({ maker, models }) => (
            <section key={maker} className="mb-3">
              {makers.length > 1 && (
                <h3 className="sticky top-0 z-10 bg-white/95 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 backdrop-blur">
                  {maker}
                  <span className="ml-1.5 font-normal normal-case tracking-normal text-slate-300">
                    {models.length}
                  </span>
                </h3>
              )}
              <ul className="flex flex-col">
                {models.map((model) => {
                  const isOn = selected.includes(model.id);
                  const locked = (isOn && onlyOne) || (!isOn && atLimit);
                  const price = formatListPrice(model.pricing);
                  const free = price === 'free';

                  return (
                    <li key={model.id}>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isOn}
                        disabled={locked}
                        onClick={() => onToggle(model.id)}
                        title={
                          locked
                            ? isOn
                              ? 'Keep at least one model selected'
                              : `Up to ${MAX_SELECTED} models at once`
                            : model.id
                        }
                        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition ${
                          isOn ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-50'
                        } ${locked ? 'cursor-not-allowed opacity-50' : ''}`}
                      >
                        <span aria-hidden="true" className="shrink-0 text-sm">
                          {model.emoji}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {shortModelName(model.name)}
                          </span>
                          {model.name.includes('/') && (
                            <span
                              className={`block truncate text-[11px] ${isOn ? 'text-slate-300' : 'text-slate-400'}`}
                            >
                              {model.name}
                            </span>
                          )}
                        </span>
                        {price && (
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              free
                                ? isOn
                                  ? 'bg-emerald-500/20 text-emerald-200'
                                  : 'bg-emerald-50 text-emerald-700'
                                : isOn
                                  ? 'bg-white/10 text-slate-200'
                                  : 'bg-slate-100 text-slate-500'
                            }`}
                          >
                            {price}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>

      {priced && (
        <p className="shrink-0 border-t border-slate-200 px-5 py-2 text-[11px] text-slate-400">
          Prices are list rates in USD per million tokens (prompt / completion).
        </p>
      )}
    </dialog>
  );
}
