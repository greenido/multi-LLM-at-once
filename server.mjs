/**
 * Express API for the Multi LLM tool. It exposes the models Ollama actually
 * has pulled, streams a query's tokens back as they are produced, and in
 * production serves the built React app out of dist/.
 *
 * Development: `npm run dev` runs Vite on :5173 (which proxies these routes)
 *              alongside this server on :3000.
 * Production:  `npm run build && npm start` serves everything from :3000.
 *
 * @author @greenido
 * @see https://github.com/ollama/ollama-js
 */
import { Ollama } from 'ollama';
import express from 'express';

const app = express();
const port = process.env.PORT ?? 3000;
const isProduction = process.env.NODE_ENV === 'production';
const ollamaUrl = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const queryTimeoutMs = Number(process.env.QUERY_TIMEOUT_MS ?? 120_000);

// Placeholder for the context
let context = '';

// Middleware for parsing request body
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// In production the built React bundle is the whole UI. In development Vite
// serves it instead, so there is nothing to mount here.
if (isProduction) {
  app.use(express.static('dist'));
}

/**
 * Turn an Ollama failure into something a user can act on. The raw errors are
 * unhelpful: an unreachable daemon surfaces only as "fetch failed".
 */
function describeError(error, model) {
  const message = error?.message ?? String(error);
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|socket hang up/i.test(message)) {
    return `Cannot reach Ollama at ${ollamaUrl} — is \`ollama serve\` running?`;
  }
  if (model && /not found|no such model|try pulling/i.test(message)) {
    return `Ollama does not have "${model}" pulled. Run: ollama pull ${model}`;
  }
  return message;
}

//
// The model registry. Ollama is the source of truth for what can be queried,
// so the list is read from it rather than hardcoded here, and doubles as the
// allowlist for /query — a client cannot name a model that is not installed.
//
const TAG_TTL_MS = 10_000;
let tagCache = { at: 0, models: null };
const registry = new Ollama({ host: ollamaUrl });

async function listModels() {
  if (tagCache.models && Date.now() - tagCache.at < TAG_TTL_MS) {
    return tagCache.models;
  }

  const { models = [] } = await registry.list();
  const names = models
    .map((entry) => entry.name)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  tagCache = { at: Date.now(), models: names };
  return names;
}

// Route for listing the models available to query
app.get('/api/models', async (req, res) => {
  try {
    res.json({ models: await listModels() });
  } catch (error) {
    console.error('🚨 Could not list models:', error);
    res.status(503).json({ error: describeError(error) });
  }
});

// Route for setting the context
app.post('/set-context', (req, res) => {
  context = req.body.context;
  console.log('== Got Context:', context);
  res.json({ context });
});

//
// One route for every model. The model id arrives in the body and is checked
// against the registry before it is used in an outbound request.
//
// The response is newline-delimited JSON so the client can render tokens as
// they arrive instead of waiting out the whole completion:
//   {"type":"chunk","text":"..."}   zero or more
//   {"type":"done"}                 or {"type":"error","error":"..."}
//
app.post('/query', async (req, res) => {
  const { model, query } = req.body ?? {};

  if (typeof model !== 'string' || !model.trim()) {
    return res.status(400).json({ error: 'A model id is required.' });
  }
  if (typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'A query is required.' });
  }

  let available;
  try {
    available = await listModels();
  } catch (error) {
    return res.status(503).json({ error: describeError(error) });
  }
  if (!available.includes(model)) {
    return res.status(400).json({
      error: `"${model}" is not installed. Available: ${available.join(', ') || '(none)'}`,
    });
  }

  const prompt = `context: ${context}. ${query}`;
  console.log(`☀️ Query for ${model}:`, prompt);

  // A client per request, so aborting this stream leaves other in-flight
  // requests alone.
  const client = new Ollama({ host: ollamaUrl });
  let cancelled = false;
  const cancel = (reason) => {
    if (cancelled) return;
    cancelled = true;
    console.log(`✋ ${model}: ${reason}`);
    client.abort();
  };

  // The browser going away, and a model that never finishes, both need to stop
  // the work rather than leave it running against the daemon.
  res.on('close', () => {
    if (!res.writableEnded) cancel('client disconnected');
  });
  const timeout = setTimeout(() => cancel(`timed out after ${queryTimeoutMs}ms`), queryTimeoutMs);

  // Start the stream before writing headers, so a refused connection or a
  // missing model is still reported as a normal JSON error with a status.
  let stream;
  try {
    stream = await client.generate({ model, prompt, stream: true });
  } catch (error) {
    clearTimeout(timeout);
    console.error('🚨 Error:', error);
    return res.status(502).json({ error: describeError(error, model) });
  }

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Tell any proxy in between not to sit on the stream.
    'X-Accel-Buffering': 'no',
  });
  const send = (event) => res.write(`${JSON.stringify(event)}\n`);

  try {
    let characters = 0;
    for await (const part of stream) {
      if (part.response) {
        characters += part.response.length;
        send({ type: 'chunk', text: part.response });
      }
    }
    send({ type: 'done' });
    console.log(`== ${model} streamed ${characters} chars`);
  } catch (error) {
    // An abort is expected: either the user cancelled or we timed out.
    if (!cancelled) {
      console.error('🚨 Error mid-stream:', error);
      send({ type: 'error', error: describeError(error, model) });
    }
  } finally {
    clearTimeout(timeout);
    res.end();
  }
});

//
// 🥥 Start the server
//
app.listen(port, () => {
  console.log(`🥥 API running at: http://localhost:${port}`);
  console.log(`🦙 Talking to Ollama at: ${ollamaUrl}`);
  if (!isProduction) {
    console.log('🍋 UI dev server: http://localhost:5173');
  }
});
