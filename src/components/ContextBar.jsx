import GrowingTextarea from './GrowingTextarea.jsx';
import PromptMenu from './PromptMenu.jsx';

const THINKING_HELP =
  'Ask Claude, Gemini, Ollama and OpenRouter models that can reason to think before answering, and show it. ' +
  'Models that reason on their own show their reasoning either way.';

export default function ContextBar({
  value,
  onChange,
  think,
  onThinkChange,
  onClear,
  canClear,
  prompts,
  onSavePrompt,
  onDeletePrompt,
}) {
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
        role="switch"
        aria-checked={think}
        onClick={() => onThinkChange(!think)}
        title={THINKING_HELP}
        className={`rounded-lg border px-4 py-2 text-sm font-medium shadow-sm transition ${
          think
            ? 'border-slate-900 bg-slate-900 text-white hover:bg-slate-700'
            : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400 hover:text-slate-900'
        }`}
      >
        <span aria-hidden="true">💭</span> Thinking
      </button>
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
