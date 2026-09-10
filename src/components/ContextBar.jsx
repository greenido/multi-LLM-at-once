export default function ContextBar({ value, onChange, onSave, saved }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyUp={(event) => event.key === 'Enter' && onSave()}
        placeholder="Enter context here... You are a world class expert..."
        aria-label="Context"
        className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
      />
      <div className="flex items-center gap-3">
        {saved && (
          <span className="text-xs font-medium text-emerald-600" role="status">
            Context updated
          </span>
        )}
        <button
          type="button"
          onClick={onSave}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 active:bg-slate-800"
        >
          Update Context
        </button>
      </div>
    </div>
  );
}
