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
  const [busy, setBusy] = useState({});

  const anyBusy = MODELS.some((model) => busy[model.id]);

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
    setBusy((prev) => ({ ...prev, [model.id]: true }));
    try {
      const response = await fetch(model.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: text }),
      });
      const data = await response.json();
      if (data.response) {
        appendTurn(model.id, { role: 'assistant', text: data.response });
      } else {
        appendTurn(model.id, { role: 'error', text: 'An error occurred' });
      }
    } catch (error) {
      console.error(`${model.label} request failed:`, error);
      appendTurn(model.id, { role: 'error', text: 'An error occurred' });
    } finally {
      setBusy((prev) => ({ ...prev, [model.id]: false }));
    }
  }

  async function send() {
    const text = query.trim();
    if (!text) return;
    setQuery('');
    MODELS.forEach((model) => appendTurn(model.id, { role: 'user', text }));

    // One model at a time, which is what the pre-React client did. The
    // parallel fan-out this app is named for is a separate change.
    for (const model of MODELS) {
      await ask(model, text);
    }
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
              busy={Boolean(busy[model.id])}
              onCopy={copy}
            />
          ))}
        </div>

        <QueryBar value={query} onChange={setQuery} onSend={send} disabled={anyBusy} />
      </main>
    </div>
  );
}
