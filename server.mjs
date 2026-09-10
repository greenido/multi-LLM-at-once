/**
 * Express API for the Multi LLM tool. It exposes the models Ollama actually
 * has pulled and runs a query against any of them, and in production serves
 * the built React app out of dist/.
 *
 * Development: `npm run dev` runs Vite on :5173 (which proxies these routes)
 *              alongside this server on :3000.
 * Production:  `npm run build && npm start` serves everything from :3000.
 *
 * @author @greenido
 * @see ollama.js and langchain.js
 */
import { Ollama } from '@langchain/community/llms/ollama';
import express from 'express';

const app = express();
const port = process.env.PORT ?? 3000;
const isProduction = process.env.NODE_ENV === 'production';
const ollamaUrl = process.env.OLLAMA_URL ?? 'http://localhost:11434';

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

async function listModels() {
  if (tagCache.models && Date.now() - tagCache.at < TAG_TTL_MS) {
    return tagCache.models;
  }

  const response = await fetch(`${ollamaUrl}/api/tags`);
  if (!response.ok) {
    throw new Error(`Ollama /api/tags returned HTTP ${response.status}`);
  }

  const { models = [] } = await response.json();
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

/** Send one query to a local Ollama model and return its full response. */
async function runQuery(model, rawQuery) {
  const query = `context: ${context}. ${rawQuery}`;
  console.log(`☀️ Query for ${model}:`, query);

  const ollama = new Ollama({ baseUrl: ollamaUrl, model });
  const response = await ollama.invoke(query);

  console.log('== Response:', response);
  return response;
}

//
// One route for every model. The model id arrives in the body and is checked
// against the registry before it is used in an outbound request.
//
app.post('/query', async (req, res) => {
  const { model, query } = req.body ?? {};

  if (typeof model !== 'string' || !model.trim()) {
    return res.status(400).json({ error: 'A model id is required.' });
  }
  if (typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'A query is required.' });
  }

  try {
    const available = await listModels();
    if (!available.includes(model)) {
      return res.status(400).json({
        error: `"${model}" is not installed. Available: ${available.join(', ') || '(none)'}`,
      });
    }

    res.json({ response: await runQuery(model, query) });
  } catch (error) {
    console.error('🚨 Error:', error);
    res.status(500).json({ error: describeError(error, model) });
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
