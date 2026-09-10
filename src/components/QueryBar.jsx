export default function QueryBar({ value, onChange, onSend, disabled }) {
  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyUp={(event) => event.key === 'Enter' && onSend()}
        placeholder="Your request..."
        aria-label="Your request"
        className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm shadow-sm outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
      />
      <button
        type="button"
        onClick={onSend}
        disabled={disabled}
        className="rounded-lg bg-slate-900 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-slate-700 active:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Send
      </button>
    </div>
  );
}
