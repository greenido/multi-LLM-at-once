import { useState } from 'react';
import Navbar from './components/Navbar.jsx';
import ContextBar from './components/ContextBar.jsx';
import ModelPanel from './components/ModelPanel.jsx';
import QueryBar from './components/QueryBar.jsx';
import { MODELS } from './lib/models.js';
import { buildExport, downloadText, exportFilename } from './lib/transcript.js';

const emptyTranscripts = () => Object.fromEntries(MODELS.map((model) => [model.id, []]));

export default function App() {
  const [context, setContext] = useState('');
  const [contextSaved, setContextSaved] = useState(false);
  const [query, setQuery] = useState('');
  const [transcripts, setTranscripts] = useState(emptyTranscripts);
  // modelId -> timestamp the in-flight request started, or undefined when idle.
  const [startedAt, setStartedAt] = useState({});

  const anyRunning = MODELS.some((model) => startedAt[model.id]);

  function appendTurn(modelId, turn) {
    setTranscripts((prev) => ({ ...prev, [modelId]: [...prev[modelId], turn] }));
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
      const response = await fetch(model.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text }),
      });
      const data = await response.json().catch(() => ({}));

      // Surface what the server actually said instead of a generic string.
      if (!response.ok || data.error) {
        throw new Error(data.error || `Request failed with HTTP ${response.status}`);
      }
      if (typeof data.response !== 'string') {
        throw new Error('The server returned no response text.');
      }

      appendTurn(model.id, {
        role: 'assistant',
        text: data.response,
        ms: Date.now() - begunAt,
      });
    } catch (error) {
      appendTurn(model.id, {
        role: 'error',
        text: error.message,
        ms: Date.now() - begunAt,
      });
    } finally {
      // In finally, so a throw anywhere above still clears the spinner.
      setStartedAt((prev) => ({ ...prev, [model.id]: undefined }));
    }
  }

  async function send() {
    const text = query.trim();
    if (!text) return;
    setQuery('');
    MODELS.forEach((model) => appendTurn(model.id, { role: 'user', text }));

    // Every model starts now. Wall time is the slowest model, not the sum of
    // all of them, and one model failing does not hold up the others.
    await Promise.allSettled(MODELS.map((model) => ask(model, text)));
  }

  function copy(text) {
    navigator.clipboard.writeText(text).catch((error) => {
      console.error('Failed to copy text:', error);
    });
  }

  return (
    <div className="flex h-full flex-col">
      <Navbar
        onExport={() => downloadText(exportFilename(), buildExport(MODELS, transcripts))}
        onCopyAll={() => copy(buildExport(MODELS, transcripts))}
      />

      <main className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-4 p-4">
        <ContextBar
          value={context}
          onChange={setContext}
          onSave={saveContext}
          saved={contextSaved}
        />

        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-2">
          {MODELS.map((model) => (
            <ModelPanel
              key={model.id}
              model={model}
              turns={transcripts[model.id]}
              startedAt={startedAt[model.id]}
              onCopy={copy}
            />
          ))}
        </div>

        <QueryBar value={query} onChange={setQuery} onSend={send} disabled={anyRunning} />
      </main>
    </div>
  );
}
