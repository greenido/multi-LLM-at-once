import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Navbar from './components/Navbar.jsx';
import ContextBar from './components/ContextBar.jsx';
import HistoryPanel from './components/HistoryPanel.jsx';
import ModelPanel from './components/ModelPanel.jsx';
import ModelPicker from './components/ModelPicker.jsx';
import QueryBar from './components/QueryBar.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import {
  createPrompt,
  deleteComparison,
  deletePrompt,
  getComparison,
  listComparisons,
  listPrompts,
  newId,
  saveComparison,
  toSaved,
} from './lib/history.js';
import { MAX_SELECTED, defaultSelection, fetchModels, groupByProvider } from './lib/models.js';
import { clearKey, fetchSettings, saveKey, testKey } from './lib/settings.js';
import { load, save } from './lib/storage.js';
import { streamQuery } from './lib/stream.js';
import { buildMarkdown, downloadText, exportFilename, toMessages } from './lib/transcript.js';

const SELECTION_KEY = 'multi-llm.selected-models';
const SYSTEM_KEY = 'multi-llm.system-prompt';

// Tokens can arrive faster than it is worth re-rendering for, so chunks are
// coalesced into at most one state update per this many milliseconds.
const FLUSH_INTERVAL_MS = 60;

// One shared empty array, so a panel with no transcript yet keeps a stable
// prop and stays memoized like the rest.
const NO_TURNS = [];

// Searching history waits for a pause in typing rather than asking per key.
const SEARCH_DELAY_MS = 200;

// Static strings so Tailwind keeps these classes; four models read best as 2x2.
const GRID_COLUMNS = {
  1: 'grid-cols-1',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-2 xl:grid-cols-3',
  4: 'md:grid-cols-2',
};

export default function App() {
  const [available, setAvailable] = useState([]);
  const [providers, setProviders] = useState([]);
  const [registryError, setRegistryError] = useState(null);
  const [loadingRegistry, setLoadingRegistry] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keySettings, setKeySettings] = useState([]);
  const [dismissed, setDismissed] = useState([]);

  const [system, setSystem] = useState(() => load(SYSTEM_KEY, ''));
  const [query, setQuery] = useState('');
  const [transcripts, setTranscripts] = useState({});
  // modelId -> timestamp the in-flight request started, or undefined when idle.
  const [startedAt, setStartedAt] = useState({});

  // modelId -> AbortController for the in-flight request.
  const controllers = useRef(new Map());

  // The conversation on screen is saved under this id, which a new chat or an
  // opened comparison replaces.
  const [comparisonId, setComparisonId] = useState(newId);
  // Bumped whenever the panels start holding a different conversation. A
  // request from the one before may still be settling, and must not write its
  // last words into this one.
  const conversation = useRef(0);
  // The transcripts as last saved or opened, so an unchanged conversation is
  // not saved again — opening one from history would otherwise bump it.
  const lastSaved = useRef(null);
  // Saves run one at a time, in order, so an older snapshot never lands last.
  const saveQueue = useRef(Promise.resolve());

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [prompts, setPrompts] = useState([]);
  // A one-off message above the panels: a save that failed, or models a
  // reopened comparison had that are not available now.
  const [notice, setNotice] = useState(null);
  // When a save last landed, so an open history list can re-read itself.
  const [savedAt, setSavedAt] = useState(0);

  const selected = useMemo(
    () => selectedIds.map((id) => available.find((model) => model.id === id)).filter(Boolean),
    [selectedIds, available],
  );
  const groups = useMemo(() => groupByProvider(available, providers), [available, providers]);
  const anyRunning = selected.some((model) => startedAt[model.id]);
  // Anything in flight at all, a panel since deselected included.
  const busy = Object.values(startedAt).some(Boolean);

  // A provider that failed and has nothing to offer would otherwise vanish from
  // the picker without saying why — the usual case being Ollama not running.
  const warnings = providers.filter(
    (provider) => provider.error && provider.count === 0 && !dismissed.includes(provider.id),
  );

  /**
   * `quiet` refreshes the list without blanking the panels, for when a key
   * changed and the catalogue needs re-reading underneath a live conversation.
   */
  const loadRegistry = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoadingRegistry(true);
    setRegistryError(null);
    try {
      const { models, providers: found } = await fetchModels();
      setAvailable(models);
      setProviders(found);

      // Keep a remembered choice only for models that are still available.
      setSelectedIds((current) => {
        const remembered = current.length > 0 ? current : load(SELECTION_KEY, null);
        const stillValid = Array.isArray(remembered)
          ? remembered.filter((id) => models.some((model) => model.id === id))
          : [];
        return stillValid.length > 0 ? stillValid.slice(0, MAX_SELECTED) : defaultSelection(models);
      });
    } catch (error) {
      setRegistryError(error.message);
      setAvailable([]);
      setProviders([]);
      setSelectedIds([]);
    } finally {
      if (!quiet) setLoadingRegistry(false);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      setKeySettings(await fetchSettings());
    } catch (error) {
      console.error('Could not read settings:', error);
    }
  }, []);

  useEffect(() => {
    loadRegistry();
    loadSettings();
  }, [loadRegistry, loadSettings]);

  // Leaving the page should not leave requests running against a provider.
  useEffect(() => () => {
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
  }, []);

  useEffect(() => {
    listPrompts()
      .then(setPrompts)
      .catch((error) => console.error('Could not read saved prompts:', error));
  }, []);

  //
  // History.
  //
  // Searches can overlap, and the answer to an older one must not land last.
  const latestSearch = useRef(0);
  const refreshHistory = useCallback(async (query) => {
    const search = ++latestSearch.current;
    setHistoryLoading(true);
    try {
      const items = await listComparisons(query);
      if (search !== latestSearch.current) return;
      setHistoryItems(items);
      setHistoryError(null);
    } catch (error) {
      if (search === latestSearch.current) setHistoryError(error.message);
    } finally {
      if (search === latestSearch.current) setHistoryLoading(false);
    }
  }, []);

  // The conversation is saved each time an exchange settles — never
  // mid-stream — and only when it changed. The system prompt and the panels
  // are saved along with it, but changing them is not a reason to save.
  useEffect(() => {
    if (busy) return;
    const snapshot = toSaved({ id: comparisonId, system, models: selectedIds, transcripts });
    if (!snapshot) return;
    const saved = JSON.stringify(snapshot.transcripts);
    if (saved === lastSaved.current) return;
    lastSaved.current = saved;

    saveQueue.current = saveQueue.current
      .then(() => saveComparison(snapshot))
      .then(() => {
        setSavedAt(Date.now());
        setNotice((current) => (current?.saveFailed ? null : current));
      })
      .catch((error) => {
        // Not marked saved, so the next exchange tries again with everything.
        lastSaved.current = null;
        setNotice({ saveFailed: true, text: `Could not save this comparison: ${error.message}` });
      });
  }, [busy, transcripts, comparisonId]);

  // The list is read when the sheet opens and as the search changes, and
  // again after a save lands while it is open.
  useEffect(() => {
    if (!historyOpen) return undefined;
    // Loading from the start, so the sheet does not flash "nothing saved".
    setHistoryLoading(true);
    const timer = setTimeout(() => refreshHistory(historyQuery), historyQuery ? SEARCH_DELAY_MS : 0);
    return () => clearTimeout(timer);
  }, [historyOpen, historyQuery, refreshHistory, savedAt]);

  /** Put a saved comparison back in the panels, to read or to carry on. */
  async function openComparison(id) {
    let comparison;
    try {
      comparison = await getComparison(id);
    } catch (error) {
      setHistoryError(error.message);
      return;
    }

    stop();
    conversation.current += 1;
    lastSaved.current = JSON.stringify(toSaved(comparison)?.transcripts ?? null);
    setComparisonId(comparison.id);
    setTranscripts(comparison.transcripts);
    updateSystem(comparison.system);

    // Its panels come back where their models still exist. The rest keep their
    // answers, and show again if that model comes back.
    const reachable = comparison.models.filter((modelId) => available.some((model) => model.id === modelId));
    if (reachable.length > 0) {
      const next = reachable.slice(0, MAX_SELECTED);
      setSelectedIds(next);
      save(SELECTION_KEY, next);
    }
    const missing = comparison.models.filter((modelId) => !reachable.includes(modelId));
    setNotice(
      missing.length > 0
        ? { text: `Not available right now: ${missing.join(', ')}. Their answers are kept, and show again when they are back.` }
        : null,
    );
    setHistoryOpen(false);
  }

  async function removeComparison(id) {
    try {
      await deleteComparison(id);
    } catch (error) {
      setHistoryError(error.message);
      return;
    }
    // Deleting the one on screen clears it, or the next answer would save it
    // straight back.
    if (id === comparisonId) newChat();
    setHistoryItems((items) => items.filter((item) => item.id !== id));
  }

  //
  // Saved prompts.
  //
  async function savePrompt(kind, name, text) {
    const prompt = await createPrompt({ kind, name, text });
    // In the order the server lists them, so nothing moves on the next load.
    setPrompts((current) =>
      [...current, prompt].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    );
  }

  async function removePrompt(id) {
    try {
      await deletePrompt(id);
      setPrompts((current) => current.filter((prompt) => prompt.id !== id));
    } catch (error) {
      console.error('Could not delete the prompt:', error);
    }
  }

  function toggleModel(id) {
    setSelectedIds((prev) => {
      const next = prev.includes(id)
        ? prev.filter((current) => current !== id)
        : [...prev, id].slice(0, MAX_SELECTED);
      save(SELECTION_KEY, next);
      return next;
    });
  }

  function appendTurn(modelId, turn) {
    setTranscripts((prev) => ({ ...prev, [modelId]: [...(prev[modelId] ?? []), turn] }));
  }

  /** Patch the newest turn of a transcript, used to grow a streaming answer. */
  function patchLastTurn(modelId, patch) {
    setTranscripts((prev) => {
      const turns = prev[modelId] ?? [];
      if (turns.length === 0) return prev;
      const last = turns[turns.length - 1];
      return {
        ...prev,
        [modelId]: [...turns.slice(0, -1), { ...last, ...patch(last) }],
      };
    });
  }

  function updateSystem(next) {
    setSystem(next);
    save(SYSTEM_KEY, next);
  }

  function newChat() {
    stop();
    conversation.current += 1;
    lastSaved.current = null;
    setComparisonId(newId());
    setTranscripts({});
    setNotice(null);
  }

  //
  // Settings. A key change can add or remove a whole provider's worth of
  // models, so the catalogue is re-read quietly afterwards.
  //
  function applyProvider(updated) {
    setKeySettings((prev) => prev.map((provider) => (provider.id === updated.id ? updated : provider)));
    loadRegistry({ quiet: true });
  }

  async function handleSaveKey(provider, apiKey) {
    applyProvider(await saveKey(provider, apiKey));
  }

  async function handleClearKey(provider) {
    applyProvider(await clearKey(provider));
  }

  async function ask(model, messages) {
    const begunAt = Date.now();
    const controller = new AbortController();
    controllers.current.set(model.id, controller);
    setStartedAt((prev) => ({ ...prev, [model.id]: begunAt }));

    // Writes go to this conversation only. After New chat, or opening a saved
    // one, the panels hold something else, and a request still settling from
    // before would otherwise append "[stopped]" to the wrong answer.
    const generation = conversation.current;
    const patch = (update) => {
      if (conversation.current === generation) patchLastTurn(model.id, update);
    };

    // The turn the tokens stream into.
    appendTurn(model.id, { role: 'assistant', text: '', streaming: true });

    let pending = '';
    let lastFlush = 0;
    // When the first token arrived, which splits waiting for a model from
    // watching it write. Kept even for an answer that fails or is stopped.
    let firstTokenAt;
    const timings = () => ({
      ms: Date.now() - begunAt,
      ...(firstTokenAt === undefined ? {} : { ttftMs: firstTokenAt - begunAt }),
    });
    const flush = () => {
      if (!pending) return;
      const chunk = pending;
      pending = '';
      patch((last) => ({ text: last.text + chunk }));
    };

    try {
      await streamQuery({
        model: model.id,
        messages,
        system,
        signal: controller.signal,
        onChunk: (chunk) => {
          firstTokenAt ??= Date.now();
          pending += chunk;
          const now = performance.now();
          if (now - lastFlush >= FLUSH_INTERVAL_MS) {
            lastFlush = now;
            flush();
          }
        },
        onUsage: (usage) => patch(() => ({ usage })),
      });
      flush();
      patch(() => ({ streaming: false, ...timings() }));
    } catch (error) {
      flush();
      const cancelled = error.name === 'AbortError';
      patch((last) => ({
        streaming: false,
        ...timings(),
        // A cancelled answer keeps whatever streamed in; a failure with no
        // text at all becomes the error itself.
        role: cancelled || last.text ? last.role : 'error',
        text: cancelled
          ? `${last.text}${last.text ? '\n' : ''}[stopped]`
          : last.text || error.message,
        note: !cancelled && last.text ? error.message : undefined,
      }));
    } finally {
      // In finally, so a throw anywhere above still clears the spinner — but
      // only this request's: the same model may already be answering again.
      if (controllers.current.get(model.id) === controller) controllers.current.delete(model.id);
      setStartedAt((prev) => (prev[model.id] === begunAt ? { ...prev, [model.id]: undefined } : prev));
    }
  }

  async function send() {
    const text = query.trim();
    if (!text || selected.length === 0) return;
    setQuery('');

    // Snapshot each panel's history before the new turn is appended, so the
    // request carries the conversation up to this question. Every model keeps
    // its own thread — it should only ever see what it said itself.
    const histories = new Map(
      selected.map((model) => [
        model.id,
        [...toMessages(transcripts[model.id] ?? []), { role: 'user', content: text }],
      ]),
    );

    selected.forEach((model) => appendTurn(model.id, { role: 'user', text }));

    // Every model starts now. Wall time is the slowest model, not the sum of
    // all of them, and one model failing does not hold up the others.
    await Promise.allSettled(selected.map((model) => ask(model, histories.get(model.id))));
  }

  /**
   * Ask one model its last question again, in place of the answer it gave —
   * after a rate limit, a timeout or a stopped answer, or for a second try. The
   * panels beside it are left alone, and are not billed a second time.
   */
  function retry(model) {
    const turns = transcripts[model.id] ?? [];
    const question = turns.findLastIndex((turn) => turn.role === 'user');
    if (question === -1 || startedAt[model.id]) return;

    const kept = turns.slice(0, question + 1);
    setTranscripts((prev) => ({ ...prev, [model.id]: kept }));
    ask(model, toMessages(kept));
  }

  // Panels are memoized, so a handler passed to one has to keep its identity
  // from render to render, yet still see the latest transcripts when it runs.
  const latestRetry = useRef(retry);
  useLayoutEffect(() => {
    latestRetry.current = retry;
  });
  const onRetry = useCallback((model) => latestRetry.current(model), []);

  function stop() {
    controllers.current.forEach((controller) => controller.abort());
  }

  // Stable, so a panel streaming tokens does not re-render the ones beside it.
  const copy = useCallback((text) => {
    navigator.clipboard.writeText(text).catch((error) => {
      console.error('Failed to copy text:', error);
    });
  }, []);

  return (
    <div className="flex h-full flex-col">
      <Navbar
        onOpenHistory={() => setHistoryOpen(true)}
        onExport={() => downloadText(exportFilename(), buildMarkdown(selected, transcripts, system))}
        onCopyAll={() => copy(buildMarkdown(selected, transcripts, system))}
        onOpenSettings={() => {
          loadSettings();
          setSettingsOpen(true);
        }}
      />

      <main className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-4 p-4">
        {warnings.map((provider) => (
          <div
            key={provider.id}
            className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
          >
            <span aria-hidden="true">⚠️</span>
            <span className="flex-1">{provider.error}</span>
            <button
              type="button"
              onClick={() => setDismissed((prev) => [...prev, provider.id])}
              aria-label={`Dismiss ${provider.label} warning`}
              className="rounded px-1 text-amber-500 transition hover:text-amber-900"
            >
              ✕
            </button>
          </div>
        ))}

        {notice && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <span aria-hidden="true">⚠️</span>
            <span className="flex-1">{notice.text}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Dismiss"
              className="rounded px-1 text-amber-500 transition hover:text-amber-900"
            >
              ✕
            </button>
          </div>
        )}

        <ContextBar
          value={system}
          onChange={updateSystem}
          onClear={newChat}
          canClear={Object.values(transcripts).some((turns) => turns.length > 0)}
          prompts={prompts}
          onSavePrompt={savePrompt}
          onDeletePrompt={removePrompt}
        />

        {groups.length > 0 && (
          <ModelPicker groups={groups} selected={selectedIds} onToggle={toggleModel} />
        )}

        {registryError ? (
          <CenteredNotice
            tone="error"
            message={registryError}
            hint="The API server is not answering. Check that it is running."
            action={{ label: 'Retry', onClick: () => loadRegistry() }}
          />
        ) : loadingRegistry ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <p className="text-sm text-slate-400">Looking for available models…</p>
          </div>
        ) : available.length === 0 ? (
          <CenteredNotice
            tone="empty"
            message="No models available yet."
            hint="Start Ollama for local models, or add a cloud API key in Settings."
            action={{ label: 'Open Settings', onClick: () => setSettingsOpen(true) }}
          />
        ) : (
          <div className={`grid min-h-0 flex-1 gap-4 ${GRID_COLUMNS[selected.length] ?? GRID_COLUMNS[2]}`}>
            {selected.map((model) => (
              <ModelPanel
                key={model.id}
                model={model}
                turns={transcripts[model.id] ?? NO_TURNS}
                startedAt={startedAt[model.id]}
                onCopy={copy}
                onRetry={onRetry}
              />
            ))}
          </div>
        )}

        <QueryBar
          value={query}
          onChange={setQuery}
          onSend={send}
          onStop={stop}
          running={anyRunning}
          disabled={selected.length === 0}
          prompts={prompts}
          onSavePrompt={savePrompt}
          onDeletePrompt={removePrompt}
        />
      </main>

      <HistoryPanel
        open={historyOpen}
        items={historyItems}
        loading={historyLoading}
        error={historyError}
        activeId={comparisonId}
        query={historyQuery}
        onQuery={setHistoryQuery}
        onOpen={openComparison}
        onDelete={removeComparison}
        onClose={() => setHistoryOpen(false)}
      />

      <SettingsModal
        open={settingsOpen}
        providers={keySettings}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveKey}
        onClear={handleClearKey}
        onTest={testKey}
      />
    </div>
  );
}

const TONE = {
  error: 'border-red-200 bg-red-50 text-red-700',
  empty: 'border-slate-200 bg-slate-50 text-slate-600',
};

function CenteredNotice({ tone, message, hint, action }) {
  return (
    <div
      className={`flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-xl border p-8 text-center ${TONE[tone]}`}
    >
      <p className="text-sm font-medium">{message}</p>
      <p className="max-w-md text-xs opacity-80">{hint}</p>
      <button
        type="button"
        onClick={action.onClick}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
      >
        {action.label}
      </button>
    </div>
  );
}
