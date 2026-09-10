import GrowingTextarea from './GrowingTextarea.jsx';
import PromptMenu from './PromptMenu.jsx';
import { isSubmitKey } from '../lib/keyboard.js';

export default function QueryBar({ value, onChange, onSend, onStop, running, disabled, prompts, onSavePrompt, onDeletePrompt }) {
  return (
    <div className="flex items-end gap-2">
      <GrowingTextarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (!isSubmitKey(event)) return;
          // Enter sends rather than breaking the line — and does nothing while
          // an answer is still streaming, rather than queueing a question.
          event.preventDefault();
          if (!running) onSend();
        }}
        placeholder="Your request… (Shift+Enter for a new line)"
        aria-label="Your request"
        className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
      />
      <PromptMenu
        kind="question"
        placement="up"
        prompts={prompts}
        current={value}
        onPick={onChange}
        onSave={(name, text) => onSavePrompt('question', name, text)}
        onDelete={onDeletePrompt}
      />
      {running ? (
        <button
          type="button"
          onClick={onStop}
          className="rounded-lg bg-red-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-red-700 active:bg-red-800"
        >
          Stop
        </button>
      ) : (
        <button
          type="button"
          onClick={onSend}
          disabled={disabled}
          className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 active:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      )}
    </div>
  );
}
