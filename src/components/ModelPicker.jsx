import { useState } from 'react';
import { MAX_SELECTED } from '../lib/models.js';

/**
 * One row per provider. A cloud provider can offer dozens of models, so a row
 * shows the first few and expands on request — but anything already selected
 * stays visible, and pills keep their original position so they do not jump
 * around under the cursor when a row expands.
 */
const COLLAPSED_COUNT = 8;

export default function ModelPicker({ groups, selected, onToggle }) {
  const atLimit = selected.length >= MAX_SELECTED;

  return (
    <div className="flex flex-col gap-1.5">
      {groups.map((group) => (
        <ProviderRow
          key={group.id}
          group={group}
          selected={selected}
          atLimit={atLimit}
          onlyOne={selected.length === 1}
          onToggle={onToggle}
        />
      ))}

      <span className="text-xs text-slate-400">
        {selected.length}/{MAX_SELECTED} selected
      </span>
    </div>
  );
}

function ProviderRow({ group, selected, atLimit, onlyOne, onToggle }) {
  const [expanded, setExpanded] = useState(false);

  const visible = expanded
    ? group.models
    : group.models.filter((model, index) => index < COLLAPSED_COUNT || selected.includes(model.id));
  const hidden = group.models.length - visible.length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {group.label}
      </span>

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
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
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
          onClick={() => setExpanded(true)}
          className="rounded-full px-2 py-1 text-xs font-medium text-slate-500 underline-offset-2 transition hover:text-slate-900 hover:underline"
        >
          +{hidden} more
        </button>
      )}
      {expanded && group.models.length > COLLAPSED_COUNT && (
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="rounded-full px-2 py-1 text-xs font-medium text-slate-500 underline-offset-2 transition hover:text-slate-900 hover:underline"
        >
          Show fewer
        </button>
      )}

      {/* A provider whose live list failed still offers its fallback models. */}
      {group.error && (
        <span className="text-xs text-amber-600" title={group.error}>
          ⚠️ list may be incomplete
        </span>
      )}
    </div>
  );
}
