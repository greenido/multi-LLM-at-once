import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Navbar from './components/Navbar.jsx';
import ContextBar from './components/ContextBar.jsx';
import ModelPanel from './components/ModelPanel.jsx';
import ModelPicker from './components/ModelPicker.jsx';
import QueryBar from './components/QueryBar.jsx';
import { MAX_SELECTED, defaultSelection, fetchModels } from './lib/models.js';
import { load, save } from './lib/storage.js';
import { streamQuery } from './lib/stream.js';
import { buildExport, downloadText, exportFilename } from './lib/transcript.js';

const SELECTION_KEY = 'multi-llm.selected-models';

// Tokens can arrive faster than it is worth re-rendering for, so chunks are
// coalesced into at most one state update per this many milliseconds.
const FLUSH_INTERVAL_MS = 60;

// Static strings so Tailwind keeps these classes; four models read best as 2x2.
const GRID_COLUMNS = {
  1: 'grid-cols-1',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-2 xl:grid-cols-3',
  4: 'md:grid-cols-2',
};

export default function App() {
  const [available, setAvailable] = useState([]);
  const [registryError, setRegistryError] = useState(null);
  const [loadingRegistry, setLoadingRegistry] = useState(true);
  const [selectedIds, setSelectedIds] = useState([]);

  const [context, setContext] = useState('');
  const [contextSaved, setContextSaved] = useState(false);
  const [query, setQuery] = useState('');
  const [transcripts, setTranscripts] = useState({});
  // modelId -> timestamp the in-flight request started, or undefined when idle.
  const [startedAt, setStartedAt] = useState({});

  // modelId -> AbortController for the in-flight request.
  const controllers = useRef(new Map());

  const selected = useMemo(
    () => selectedIds.map((id) => available.find((model) => model.id === id)).filter(Boolean),
    [selectedIds, available],
  );
  const anyRunning = selected.some((model) => startedAt[model.id]);

  const loadRegistry = useCallback(async () => {
    setLoadingRegistry(true);
    setRegistryError(null);
    try {
      const models = await fetchModels();
      setAvailable(models);

      // Keep a remembered choice only for models that are still installed.
      const remembered = load(SELECTION_KEY, null);
      const stillValid = Array.isArray(remembered)
        ? remembered.filter((id) => models.some((model) => model.id === id))
        : [];
      setSelectedIds(stillValid.length > 0 ? stillValid.slice(0, MAX_SELECTED) : defaultSelection(models));
    } catch (error) {
      setRegistryError(error.message);
      setAvailable([]);
      setSelectedIds([]);
    } finally {
      setLoadingRegistry(false);
    }
  }, []);

  useEffect(() => {
    loadRegistry();
  }, [loadRegistry]);

  // Leaving the page should not leave requests running against the daemon.
  useEffect(() => () => {
    controllers.current.forEach((controller) => controller.abort());
    controllers.current.clear();
  }, []);

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

  async function saveContext() {
    await fetch('/set-context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ context }),
    });
    setContextSaved(true);
    setTimeout(() => setContextSaved(false), 2000);
  }

  async function ask(model, text) {
    const begunAt = Date.now();
    const controller = new AbortController();
    controllers.current.set(model.id, controller);
    setStartedAt((prev) => ({ ...prev, [model.id]: begunAt }));

    // The turn the tokens stream into.
    appendTurn(model.id, { role: 'assistant', text: '', streaming: true });

    let pending = '';
    let lastFlush = 0;
    const flush = () => {
      if (!pending) return;
      const chunk = pending;
      pending = '';
      patchLastTurn(model.id, (last) => ({ text: last.text + chunk }));
    };

    try {
      await streamQuery({
        model: model.id,
        query: text,
        signal: controller.signal,
        onChunk: (chunk) => {
          pending += chunk;
          const now = performance.now();
          if (now - lastFlush >= FLUSH_INTERVAL_MS) {
            lastFlush = now;
            flush();
          }
        },
      });
      flush();
      patchLastTurn(model.id, () => ({ streaming: false, ms: Date.now() - begunAt }));
    } catch (error) {
      flush();
      const cancelled = error.name === 'AbortError';
      patchLastTurn(model.id, (last) => ({
        streaming: false,
        ms: Date.now() - begunAt,
        // A cancelled answer keeps whatever streamed in; a failure with no
        // text at all becomes the error itself.
        role: cancelled || last.text ? last.role : 'error',
        text: cancelled
          ? `${last.text}${last.text ? '\n' : ''}[stopped]`
          : last.text || error.message,
        note: !cancelled && last.text ? error.message : undefined,
      }));
    } finally {
      controllers.current.delete(model.id);
      // In finally, so a throw anywhere above still clears the spinner.
      setStartedAt((prev) => ({ ...prev, [model.id]: undefined }));
    }
  }

  async function send() {
    const text = query.trim();
    if (!text || selected.length === 0) return;
    setQuery('');
    selected.forEach((model) => appendTurn(model.id, { role: 'user', text }));

    // Every model starts now. Wall time is the slowest model, not the sum of
    // all of them, and one model failing does not hold up the others.
    await Promise.allSettled(selected.map((model) => ask(model, text)));
  }

  function stop() {
    controllers.current.forEach((controller) => controller.abort());
  }

  function copy(text) {
    navigator.clipboard.writeText(text).catch((error) => {
      console.error('Failed to copy text:', error);
    });
  }

  return (
    <div className="flex h-full flex-col">
      <Navbar
        onExport={() => downloadText(exportFilename(), buildExport(selected, transcripts))}
        onCopyAll={() => copy(buildExport(selected, transcripts))}
      />

      <main className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-4 p-4">
        <ContextBar value={context} onChange={setContext} onSave={saveContext} saved={contextSaved} />

        {available.length > 0 && (
          <ModelPicker models={available} selected={selectedIds} onToggle={toggleModel} />
        )}

        {registryError ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-red-200 bg-red-50 p-8 text-center">
            <p className="text-sm font-medium text-red-700">{registryError}</p>
            <p className="max-w-md text-xs text-red-600">
              Start Ollama and pull at least one model, for example{' '}
              <code className="rounded bg-red-100 px-1 py-0.5 font-mono">ollama pull llama3</code>.
            </p>
            <button
              type="button"
              onClick={loadRegistry}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700"
            >
              Retry
            </button>
          </div>
        ) : loadingRegistry ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <p className="text-sm text-slate-400">Looking for installed models…</p>
          </div>
        ) : (
          <div className={`grid min-h-0 flex-1 gap-4 ${GRID_COLUMNS[selected.length] ?? GRID_COLUMNS[2]}`}>
            {selected.map((model) => (
              <ModelPanel
                key={model.id}
                model={model}
                turns={transcripts[model.id] ?? []}
                startedAt={startedAt[model.id]}
                onCopy={copy}
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
        />
      </main>
    </div>
  );
}
