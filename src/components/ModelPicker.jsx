import { MAX_SELECTED } from '../lib/models.js';

export default function ModelPicker({ models, selected, onToggle }) {
  const atLimit = selected.length >= MAX_SELECTED;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        Models
      </span>

      {models.map((model) => {
        const isOn = selected.includes(model.id);
        // Keep at least one panel, and cap how many run at once.
        const locked = (isOn && selected.length === 1) || (!isOn && atLimit);

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

      <span className="text-xs text-slate-400">
        {selected.length}/{MAX_SELECTED}
      </span>
    </div>
  );
}
