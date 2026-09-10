import { useCallback, useEffect, useMemo, useState } from 'react';
import Navbar from './components/Navbar.jsx';
import ContextBar from './components/ContextBar.jsx';
import ModelPanel from './components/ModelPanel.jsx';
import ModelPicker from './components/ModelPicker.jsx';
import QueryBar from './components/QueryBar.jsx';
import { MAX_SELECTED, defaultSelection, fetchModels } from './lib/models.js';
import { load, save } from './lib/storage.js';
import { buildExport, downloadText, exportFilename } from './lib/transcript.js';

const SELECTION_KEY = 'multi-llm.selected-models';

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
    setStartedAt((prev) => ({ ...prev, [model.id]: begunAt }));
    try {
      const response = await fetch('/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: model.id, query: text }),
      });
      const data = await response.json().catch(() => ({}));

      // Surface what the server actually said instead of a generic string.
      if (!response.ok || data.error) {
        throw new Error(data.error || `Request failed with HTTP ${response.status}`);
      }
      if (typeof data.response !== 'string') {
        throw new Error('The server returned no response text.');
      }

      appendTurn(model.id, { role: 'assistant', text: data.response, ms: Date.now() - begunAt });
    } catch (error) {
      appendTurn(model.id, { role: 'error', text: error.message, ms: Date.now() - begunAt });
    } finally {
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
          disabled={anyRunning || selected.length === 0}
        />
      </main>
    </div>
  );
}
