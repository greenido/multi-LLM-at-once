import GrowingTextarea from './GrowingTextarea.jsx';
import PromptMenu from './PromptMenu.jsx';

export default function ContextBar({ value, onChange, onClear, canClear, prompts, onSavePrompt, onDeletePrompt }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <GrowingTextarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          maxHeight={160}
          placeholder="System prompt… e.g. You are a world class expert. Answer in bullet points."
          aria-label="System prompt"
          className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
        />
      </div>
      <PromptMenu
        kind="system"
        prompts={prompts}
        current={value}
        onPick={onChange}
        onSave={(name, text) => onSavePrompt('system', name, text)}
        onDelete={onDeletePrompt}
      />
      <button
        type="button"
        onClick={onClear}
        disabled={!canClear}
        title="Start a fresh conversation in every panel"
        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
      >
        New chat
      </button>
    </div>
  );
}
