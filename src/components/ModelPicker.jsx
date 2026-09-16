import { useRef, useState } from 'react';
import { MAX_SELECTED } from '../lib/models.js';
import { COLLAPSED_COUNT, visibleForGroup } from '../lib/picker.js';
import ModelBrowseModal from './ModelBrowseModal.jsx';

/**
 * One row per provider. Rows stay collapsed so the answer panels keep the
 * main screen: the first few pills show, anything selected stays visible, and
 * "+N more" opens a browse dialog for the rest — with list prices where the
 * provider publishes them.
 */
export default function ModelPicker({ groups, selected, onToggle }) {
  const [filter, setFilter] = useState('');
  const [browse, setBrowse] = useState(null);
  const searchRef = useRef(null);
  const atLimit = selected.length >= MAX_SELECTED;
  const filtering = filter.trim() !== '';

  // Search earns its space once some provider offers more than fit in a row —
  // OpenRouter alone lists hundreds.
  const searchable = groups.some((group) => group.models.length > COLLAPSED_COUNT);

  const shown = groups
    .map((group) => {
      const slice = visibleForGroup(group.models, { selectedIds: selected, filter });
      return { ...group, ...slice };
    })
    .filter((group) => !filtering || group.matchCount > 0);

  const openBrowse = (group) => {
    setBrowse({
      group,
      // Carry a live filter into the dialog so "+N more matches" continues it.
      initialFilter: filtering ? filter.trim() : '',
    });
  };

  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-slate-400">
          {selected.length}/{MAX_SELECTED} selected
        </span>
        {searchable && (
          <input
            ref={searchRef}
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Find a model…"
            aria-label="Find a model"
            className="w-56 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
          />
        )}
        {filtering && shown.length === 0 && (
          <span className="text-xs text-slate-400">No model matches that.</span>
        )}
      </div>

      {shown.map((group) => (
        <ProviderRow
          key={group.id}
          group={group}
          selected={selected}
          atLimit={atLimit}
          onlyOne={selected.length === 1}
          onToggle={onToggle}
          onBrowse={() => openBrowse(group)}
        />
      ))}

      <ModelBrowseModal
        open={Boolean(browse)}
        group={browse?.group ?? null}
        selected={selected}
        initialFilter={browse?.initialFilter ?? ''}
        onToggle={onToggle}
        onClose={() => setBrowse(null)}
      />
    </div>
  );
}

function ProviderRow({ group, selected, atLimit, onlyOne, onToggle, onBrowse }) {
  const { visible, hidden, filtering } = group;

  // One horizontal row per provider — never wrap into the answer panels' space.
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {group.label}
      </span>

      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
        {visible.map((model) => {
          const isOn = selected.includes(model.id);
          // Keep at least one panel, and cap how many run at once.
          const locked = (isOn && onlyOne) || (!isOn && atLimit);

          return (
            <button
              key={model.id}
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
              className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition ${
                isOn
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-900'
              } ${locked ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <span aria-hidden="true">{model.emoji}</span> {model.label}
            </button>
          );
        })}

        {hidden > 0 && (
          <button
            type="button"
            onClick={onBrowse}
            title="Browse every model from this provider"
            className="shrink-0 rounded-full px-2 py-1 text-xs font-medium text-slate-500 underline-offset-2 transition hover:text-slate-900 hover:underline"
          >
            {filtering ? `+${hidden} more matches` : `+${hidden} more`}
          </button>
        )}

        {/* A provider whose live list failed still offers its fallback models. */}
        {group.error && (
          <span className="shrink-0 text-xs text-amber-600" title={group.error}>
            ⚠️ list may be incomplete
          </span>
        )}
      </div>
    </div>
  );
}
