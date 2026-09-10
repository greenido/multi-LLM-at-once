/**
 * Express API for the Multi LLM tool. It exposes every model the user can
 * actually reach — local Ollama models plus whichever cloud providers have an
 * API key configured — streams a query's tokens back as they are produced, and
 * in production serves the built React app out of dist/.
 *
 * API keys are held server-side in SQLite (see server/keystore.mjs) and are
 * never sent to the browser: the settings routes return a masked hint only.
 *
 * Development: `npm run dev` runs Vite on :5173 (which proxies these routes)
 *              alongside this server on :3000.
 * Production:  `npm run build && npm start` serves everything from :3000.
 *
 * @author @greenido
 * @see https://github.com/ollama/ollama-js
 */
import express from 'express';
import { deleteKey, getKey, keyStatus, setKey } from './server/keystore.mjs';
import {
  KEYED_PROVIDERS,
  getProvider,
  invalidate,
  checkAvailability,
  listAll,
  parseModelId,
  settingsStatus,
} from './server/registry.mjs';

const app = express();
const port = process.env.PORT ?? 3000;
// Loopback by default. This server holds API keys and will spend them for
// anyone who can reach it, so exposing it to a network is opt-in: set HOST to
// 0.0.0.0 (behind TLS, and something that authenticates) when you mean it.
const host = process.env.HOST ?? '127.0.0.1';
const isProduction = process.env.NODE_ENV === 'production';
const queryTimeoutMs = Number(process.env.QUERY_TIMEOUT_MS ?? 120_000);

// A transcript of twenty turns is bigger than the 100kb default.
//
// JSON only, deliberately. A form-encoded body is a CORS *simple request*: the
// browser sends it cross-origin with no preflight and no opt-in from us, so
// parsing one would let any page the user happens to visit post a query
// through this server and spend their credits. Nothing here sends a form, and
// requiring JSON means every route is preflighted — a preflight a cross-site
// caller cannot pass.
app.use(express.json({ limit: '1mb' }));

//
// A second lock on the same door, for the day a route accepts something simple
// again.
//
// Browsers attach Origin to every state-changing request, so an Origin that is
// not ours is by definition cross-site. A request with no Origin at all is not
// from a browser — curl, a script, a test — and carries no ambient authority
// to abuse, so it passes.
//
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const allowedOrigins = new Set([
  ...(process.env.ALLOWED_ORIGINS?.split(',')
    .map((value) => value.trim())
    .filter(Boolean) ?? []),
  // In development the UI is served by Vite on another port, which makes the
  // browser's own requests cross-origin.
  ...(isProduction ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173']),
]);

/** The host:port the request arrived on, so a direct visit is always allowed. */
function isSameOrigin(req, origin) {
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

app.use((req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.headers.origin;
  if (!origin || allowedOrigins.has(origin) || isSameOrigin(req, origin)) return next();

  console.warn(`⛔️ Blocked ${req.method} ${req.path} from ${origin}`);
  res.status(403).json({
    error: 'Cross-site request blocked. Open the app directly rather than through another page.',
  });
});

// In production the built React bundle is the whole UI. In development Vite
// serves it instead, so there is nothing to mount here.
if (isProduction) {
  app.use(express.static('dist'));
}

// Route for listing the models available to query
app.get('/api/models', async (req, res) => {
  try {
    res.json(await listAll());
  } catch (error) {
    console.error('🚨 Could not list models:', error);
    res.status(503).json({ error: error.message });
  }
});

//
// Settings: which providers have a key, and setting or clearing one.
//
// Nothing here ever returns a key. A response says whether one is configured
// and shows a masked hint ("sk-…4f2a") so a user can tell which key is loaded.
//
app.get('/api/settings', (req, res) => {
  res.json({ providers: settingsStatus() });
});

/** Resolve :provider to a keyed provider, or answer 404 and return null. */
function keyedProvider(req, res) {
  const provider = getProvider(req.params.provider);
  if (!provider || provider.keyless) {
    res.status(404).json({
      error: `Unknown provider "${req.params.provider}". Expected one of: ${KEYED_PROVIDERS.map((p) => p.id).join(', ')}`,
    });
    return null;
  }
  return provider;
}

/**
 * A key is opaque, so the only checks worth making are structural. The
 * printable-ASCII rule matters: these values are used as HTTP header values,
 * and a newline in one is a header injection.
 */
function validateKey(apiKey) {
  if (typeof apiKey !== 'string') return 'An apiKey string is required.';
  const trimmed = apiKey.trim();
  if (!trimmed) return 'The API key cannot be empty.';
  if (trimmed.length > 512) return 'That does not look like an API key — it is over 512 characters.';
  if (!/^[\x21-\x7e]+$/.test(trimmed)) {
    return 'The API key contains spaces or control characters. Check it was pasted whole.';
  }
  return null;
}

app.put('/api/settings/:provider', (req, res) => {
  const provider = keyedProvider(req, res);
  if (!provider) return;

  const apiKey = req.body?.apiKey;
  const problem = validateKey(apiKey);
  if (problem) return res.status(400).json({ error: problem });

  setKey(provider.id, apiKey.trim());
  invalidate(provider.id);
  console.log(`🔑 ${provider.label}: key saved`);
  res.json({ provider: { id: provider.id, label: provider.label, ...keyStatus(provider.id) } });
});

app.delete('/api/settings/:provider', (req, res) => {
  const provider = keyedProvider(req, res);
  if (!provider) return;

  const removed = deleteKey(provider.id);
  invalidate(provider.id);
  if (removed) console.log(`🔑 ${provider.label}: key removed`);
  res.json({ provider: { id: provider.id, label: provider.label, ...keyStatus(provider.id) } });
});

/**
 * Check a key actually works, by asking the provider for its model list. Takes
 * a key in the body so the modal can test before saving, and falls back to the
 * stored one so a saved key can be re-checked later.
 */
app.post('/api/settings/:provider/test', async (req, res) => {
  const provider = keyedProvider(req, res);
  if (!provider) return;

  let apiKey = req.body?.apiKey;
  if (apiKey === undefined || apiKey === '') {
    apiKey = getKey(provider.id);
    if (!apiKey) return res.status(400).json({ error: `No key is set for ${provider.label}.` });
  } else {
    const problem = validateKey(apiKey);
    if (problem) return res.status(400).json({ error: problem });
    apiKey = apiKey.trim();
  }

  try {
    const models = await provider.listModels(apiKey);
    res.json({ ok: true, count: models.length });
  } catch (error) {
    res.json({ ok: false, error: error.message });
  }
});

//
// One route for every model, local or cloud. The model id arrives in the body
// as "provider:name" and is checked against the registry before it is used in
// an outbound request.
//
// The client owns the conversation and sends it whole on every request, so
// this server keeps no per-user state and two browser tabs cannot clobber
// each other's context.
//
// The response is newline-delimited JSON so the client can render tokens as
// they arrive instead of waiting out the whole completion:
//   {"type":"chunk","text":"..."}                          zero or more
//   {"type":"usage","promptTokens":9,"completionTokens":4}  at most one
//   {"type":"done"}                 or {"type":"error","error":"..."}
//
const ROLES = new Set(['user', 'assistant']);

app.post('/query', async (req, res) => {
  const { model, messages, system } = req.body ?? {};

  if (typeof model !== 'string' || !model.trim()) {
    return res.status(400).json({ error: 'A model id is required.' });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'A non-empty messages array is required.' });
  }
  if (messages.some((m) => !ROLES.has(m?.role) || typeof m?.content !== 'string' || !m.content.trim())) {
    return res.status(400).json({
      error: 'Every message needs a role of user or assistant and non-empty string content.',
    });
  }
  if (messages.at(-1).role !== 'user') {
    return res.status(400).json({ error: 'The last message must be from the user.' });
  }
  if (system !== undefined && typeof system !== 'string') {
    return res.status(400).json({ error: 'system must be a string when given.' });
  }

  const parsed = parseModelId(model);
  if (!parsed) {
    return res.status(400).json({ error: `"${model}" is not a known model id. Expected "provider:model".` });
  }
  const provider = getProvider(parsed.provider);

  const key = provider.keyless ? null : getKey(provider.id);
  if (!provider.keyless && !key) {
    return res.status(400).json({ error: `No API key is set for ${provider.label}. Add one in Settings.` });
  }

  const availability = await checkAvailability(model);
  if (!availability.ok) {
    return res.status(availability.status).json({ error: availability.error });
  }

  console.log(
    `☀️ ${model}: ${messages.length} message(s), system ${system?.trim() ? 'set' : 'unset'}`,
  );

  // The browser going away, and a model that never finishes, both need to stop
  // the work rather than leave it running against the provider — a cloud call
  // left running is also a call still being billed.
  const controller = new AbortController();
  let cancelled = false;
  const cancel = (reason) => {
    if (cancelled) return;
    cancelled = true;
    console.log(`✋ ${model}: ${reason}`);
    controller.abort();
  };

  res.on('close', () => {
    if (!res.writableEnded) cancel('client disconnected');
  });
  const timeout = setTimeout(() => cancel(`timed out after ${queryTimeoutMs}ms`), queryTimeoutMs);

  // Pull the first item before writing headers, so a refused key, an unreachable
  // provider or a missing model is still reported as a normal JSON error with a
  // status rather than as a 200 that immediately fails.
  const stream = provider.chat({
    key,
    model: parsed.name,
    messages,
    // The system prompt is a first-class field, not a string glued to the front
    // of the user's question, so the model weights it as an instruction. Each
    // adapter places it where its own API expects.
    system: system?.trim() || null,
    signal: controller.signal,
  })[Symbol.asyncIterator]();

  let first;
  try {
    first = await stream.next();
  } catch (error) {
    clearTimeout(timeout);
    if (cancelled) return res.end();
    console.error('🚨 Error:', error.message);
    return res.status(502).json({ error: error.message });
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
    let item = first;

    while (!item.done) {
      const { text, usage } = item.value;
      if (text) {
        characters += text.length;
        send({ type: 'chunk', text });
      }
      if (usage) send({ type: 'usage', ...usage });
      item = await stream.next();
    }

    send({ type: 'done' });
    console.log(`== ${model} streamed ${characters} chars`);
  } catch (error) {
    // An abort is expected: either the user cancelled or we timed out.
    if (!cancelled) {
      console.error('🚨 Error mid-stream:', error.message);
      send({ type: 'error', error: error.message });
    }
  } finally {
    clearTimeout(timeout);
    res.end();
  }
});

//
// 🥥 Start the server
//
app.listen(port, host, () => {
  console.log(`🥥 API running at: http://${host}:${port}`);
  const configured = settingsStatus().filter((provider) => provider.configured);
  console.log(
    configured.length > 0
      ? `🔑 Cloud providers ready: ${configured.map((p) => p.label).join(', ')}`
      : '🔑 No cloud providers configured yet — add a key in Settings.',
  );
  if (!isProduction) {
    console.log('🍋 UI dev server: http://localhost:5173');
  }
});
