/**
 * Express API for the Multi LLM tool. It exposes one route per local Ollama
 * model and, in production, serves the built React app out of dist/.
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

// Route for setting the context
app.post('/set-context', (req, res) => {
  context = req.body.context;
  console.log('== Got Context:', context);
  res.json({ context });
});

/**
 * Turn an Ollama failure into something a user can act on. The raw errors are
 * unhelpful: an unreachable daemon surfaces only as "fetch failed".
 */
function describeError(error, model) {
  const message = error?.message ?? String(error);
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|socket hang up/i.test(message)) {
    return 'Cannot reach Ollama at http://localhost:11434 — is `ollama serve` running?';
  }
  if (/not found|no such model|try pulling/i.test(message)) {
    return `Ollama does not have "${model}" pulled. Run: ollama pull ${model}`;
  }
  return message;
}

/** Send one query to a local Ollama model and return its full response. */
async function runQuery(model, rawQuery) {
  const query = `context: ${context}. ${rawQuery}`;
  console.log(`☀️ Query for ${model}:`, query);

  const ollama = new Ollama({ baseUrl: 'http://localhost:11434', model });
  const response = await ollama.invoke(query);

  console.log('== Response:', response);
  return response;
}

//
// Route for handling user queries with the llama 3 model
//
app.post('/query', async (req, res) => {
  try {
    res.json({ response: await runQuery('llama3', req.body.query) });
  } catch (error) {
    console.error('🚨 Error:', error);
    res.status(500).json({ error: describeError(error, 'llama3') });
  }
});

//
// Route for handling user queries with the phi3 model
//
app.post('/query2', async (req, res) => {
  try {
    res.json({ response: await runQuery('phi3', req.body.query) });
  } catch (error) {
    console.error('🚨 Error:', error);
    res.status(500).json({ error: describeError(error, 'phi3') });
  }
});

//
// 🥥 Start the server
//
app.listen(port, () => {
  console.log(`🥥 API running at: http://localhost:${port}`);
  if (!isProduction) {
    console.log('🍋 UI dev server: http://localhost:5173');
  }
});
