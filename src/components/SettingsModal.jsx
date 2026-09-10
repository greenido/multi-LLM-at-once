import { useEffect, useRef, useState } from 'react';

/**
 * Where API keys are entered. Keys are written to the server and never come
 * back — a configured provider shows only a masked hint, so this dialog can
 * tell you *which* key is loaded without being able to show you the key.
 *
 * Built on <dialog> for the focus trap, the inert background and Escape-to-close
 * that the element gives for free.
 */
export default function SettingsModal({ open, providers, onClose, onSave, onClear, onTest }) {
  const ref = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      // Escape closes the dialog directly, so state has to follow it back.
      onClose={onClose}
      // The dialog fills its own backdrop, so a click that lands on the element
      // itself rather than on its content is a click outside the panel.
      onClick={(event) => event.target === ref.current && onClose()}
      aria-labelledby="settings-title"
      className="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-xl border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
    >
      <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-3.5">
        <h2 id="settings-title" className="text-sm font-semibold text-slate-900">
          API keys
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="ml-auto rounded-md px-2 py-1 text-sm text-slate-400 transition hover:bg-slate-100 hover:text-slate-900"
        >
          ✕
        </button>
      </div>

      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
        <p className="mb-4 text-xs leading-relaxed text-slate-500">
          Keys are stored on the server, not in this browser, and are never sent back to it — a
          saved key shows only as a masked hint. Ollama runs locally and needs no key.
        </p>

        <div className="space-y-3">
          {providers.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              onSave={onSave}
              onClear={onClear}
              onTest={onTest}
            />
          ))}
        </div>
      </div>
    </dialog>
  );
}

const RESULT_STYLE = {
  ok: 'text-emerald-600',
  error: 'text-red-600',
};

function ProviderRow({ provider, onSave, onClear, onTest }) {
  const [value, setValue] = useState('');
  // Which action is in flight, so only that button shows a pending label.
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);

  // A key injected through the server's environment is not ours to delete.
  const fromEnvironment = provider.source === 'environment';

  /** Run one action, reporting whatever it says back in the row. */
  async function run(action, work) {
    setBusy(action);
    setResult(null);
    try {
      setResult(await work());
    } catch (error) {
      setResult({ tone: 'error', message: error.message });
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    run('save', async () => {
      await onSave(provider.id, value);
      setValue('');
      return { tone: 'ok', message: 'Saved.' };
    });

  const test = () =>
    run('test', async () => {
      const { ok, count, error } = await onTest(provider.id, value);
      return ok
        ? { tone: 'ok', message: `Works — ${count} model${count === 1 ? '' : 's'} available.` }
        : { tone: 'error', message: error };
    });

  const clear = () =>
    run('clear', async () => {
      await onClear(provider.id);
      setValue('');
      return { tone: 'ok', message: 'Removed.' };
    });

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium text-slate-900">{provider.label}</span>

        {provider.configured ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-mono text-[11px] text-emerald-700">
            {provider.hint}
          </span>
        ) : (
          <span className="text-xs text-slate-400">Not configured</span>
        )}

        {fromEnvironment && (
          <span className="text-[11px] text-slate-400" title="Set through the server's environment">
            from environment
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          type="password"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyUp={(event) => event.key === 'Enter' && value.trim() && save()}
          placeholder={provider.configured ? 'Replace key…' : 'Paste API key…'}
          aria-label={`${provider.label} API key`}
          autoComplete="off"
          spellCheck="false"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 font-mono text-xs shadow-sm outline-none transition placeholder:font-sans placeholder:text-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
        />

        <button
          type="button"
          onClick={save}
          disabled={!value.trim() || busy !== null}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === 'save' ? 'Saving…' : 'Save'}
        </button>

        <button
          type="button"
          onClick={test}
          // With an empty box this re-checks the stored key, so it needs one or
          // the other to be present.
          disabled={busy !== null || (!value.trim() && !provider.configured)}
          title="Ask the provider whether this key works"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === 'test' ? 'Testing…' : 'Test'}
        </button>

        <button
          type="button"
          onClick={clear}
          disabled={!provider.configured || fromEnvironment || busy !== null}
          title={
            fromEnvironment
              ? 'This key comes from the server environment — unset it there'
              : 'Remove the stored key'
          }
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-red-300 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === 'clear' ? 'Removing…' : 'Remove'}
        </button>
      </div>

      {result && (
        <p className={`mt-2 text-xs ${RESULT_STYLE[result.tone]}`} role="status">
          {result.message}
        </p>
      )}
    </div>
  );
}
