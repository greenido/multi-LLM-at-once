import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

/**
 * Boots the real server and exercises everything that needs no network:
 * request validation, the settings routes, and the registry's behaviour when
 * a provider is unreachable. OLLAMA_URL points at a closed port so
 * "unreachable" is deterministic rather than dependent on whether the machine
 * happens to be running ollama, and KEYS_DB points at a throwaway file so a
 * test run never touches the real key database.
 *
 * The provider adapters themselves are covered in providers.test.js.
 */
const PORT = 3987;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = join(tmpdir(), `multi-llm-test-${process.pid}.db`);
const HISTORY = join(tmpdir(), `multi-llm-test-history-${process.pid}.db`);

// Invented values — never a real credential.
const KEY = 'sk-test-000000000000000000000000004f2a';

let server;

/**
 * A stand-in for OpenRouter, so a query can be followed all the way through:
 * one model, listed as taking the reasoning request, which reasons and then
 * answers. It keeps the last request body it was sent.
 */
let stub;
let received = null;

function startStub() {
  const sse = (...values) => values.map((value) => `data: ${JSON.stringify(value)}\n\n`).join('');
  stub = createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        data: [{ id: 'deepseek/deepseek-r1', architecture: { output_modalities: ['text'] }, supported_parameters: ['reasoning'] }],
      }));
    }
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      received = JSON.parse(raw);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`${sse(
        { choices: [{ delta: { reasoning_details: [{ type: 'reasoning.text', text: 'First, add.' }] } }] },
        { choices: [{ delta: { content: 'Four.' } }] },
        { choices: [], usage: { prompt_tokens: 9, completion_tokens: 20 } },
      )}data: [DONE]\n\n`);
    });
  });
  return new Promise((resolve) => stub.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${stub.address().port}`)));
}

before(async () => {
  rmSync(DB, { force: true });
  rmSync(HISTORY, { force: true });
  const openrouter = await startStub();
  server = spawn(process.execPath, ['server.mjs'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      KEYS_DB: DB,
      HISTORY_DB: HISTORY,
      HOST: '127.0.0.1',
      ALLOWED_HOSTS: 'llm.test',
      OLLAMA_URL: 'http://127.0.0.1:1',
      NODE_ENV: 'test',
      // Cloud providers must be unconfigured at the start of the run.
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY: '',
      GEMINI_API_KEY: '',
      XAI_API_KEY: '',
      OPENROUTER_API_KEY: '',
      GROQ_API_KEY: '',
      MISTRAL_API_KEY: '',
      DEEPSEEK_API_KEY: '',
      OPENROUTER_BASE_URL: openrouter,
    },
    stdio: 'ignore',
  });

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await fetch(`${BASE}/api/settings`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('server did not start');
});

after(() => {
  server?.kill();
  stub?.close();
  rmSync(DB, { force: true });
  rmSync(HISTORY, { force: true });
});

const post = (body) =>
  fetch(`${BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const putKey = (provider, apiKey) =>
  fetch(`${BASE}/api/settings/${provider}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });

const settings = async () => (await (await fetch(`${BASE}/api/settings`)).json()).providers;

const MODEL = 'ollama:llama3:latest';
const ask = [{ role: 'user', content: 'hi' }];

describe('POST /query validation', () => {
  it('rejects a missing model', async () => {
    const res = await post({ messages: ask });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /model id is required/i);
  });

  it('rejects a blank model', async () => {
    assert.equal((await post({ model: '   ', messages: ask })).status, 400);
  });

  it('rejects missing or empty messages', async () => {
    assert.equal((await post({ model: MODEL })).status, 400);
    assert.equal((await post({ model: MODEL, messages: [] })).status, 400);
  });

  it('rejects a role the chat API does not accept', async () => {
    const res = await post({ model: MODEL, messages: [{ role: 'system', content: 'x' }] });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /role of user or assistant/i);
  });

  it('rejects blank or non-string content', async () => {
    assert.equal((await post({ model: MODEL, messages: [{ role: 'user', content: '  ' }] })).status, 400);
    assert.equal((await post({ model: MODEL, messages: [{ role: 'user', content: 42 }] })).status, 400);
  });

  it('rejects a conversation that does not end with the user', async () => {
    const res = await post({
      model: MODEL,
      messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }],
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /last message must be from the user/i);
  });

  it('rejects a think that is not true or false', async () => {
    const res = await post({ model: MODEL, messages: ask, think: 'yes' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /think must be true or false/);
  });

  it('rejects a non-string system prompt', async () => {
    const res = await post({ model: MODEL, messages: ask, system: 42 });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /system must be a string/i);
  });

  it('validates before reaching any provider, so these never 502', async () => {
    // Every provider is deliberately unreachable here; a 400 proves ordering.
    assert.equal((await post({ messages: ask })).status, 400);
  });
});

describe('model ids are namespaced', () => {
  it('rejects a bare Ollama name, which used to be a whole id', async () => {
    const res = await post({ model: 'llama3:latest', messages: ask });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /provider:model/);
  });

  it('rejects a provider nobody implements', async () => {
    assert.equal((await post({ model: 'deepmind:alpha', messages: ask })).status, 400);
  });
});

describe('an unreachable Ollama', () => {
  it('no longer empties the catalogue — cloud models could still be there', async () => {
    const res = await fetch(`${BASE}/api/models`);
    assert.equal(res.status, 200);
  });

  it('reports itself as failed, with the daemon hint, so the UI can say why', async () => {
    const { providers } = await (await fetch(`${BASE}/api/models`)).json();
    const ollama = providers.find((provider) => provider.id === 'ollama');
    assert.equal(ollama.count, 0);
    assert.match(ollama.error, /ollama serve/);
  });

  it('fails a well-formed query with the same hint, not a stream', async () => {
    const res = await post({ model: MODEL, messages: ask });
    assert.equal(res.status, 503);
    assert.match(res.headers.get('content-type'), /application\/json/);
  });
});

describe('a provider with no key', () => {
  it('offers no models', async () => {
    const { models } = await (await fetch(`${BASE}/api/models`)).json();
    assert.equal(models.filter((model) => model.provider === 'openai').length, 0);
  });

  it('sends the user to Settings rather than failing obscurely', async () => {
    const res = await post({ model: 'openai:gpt-4o', messages: ask });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /No API key is set for OpenAI\. Add one in Settings\./);
  });
});

describe('the settings routes', () => {
  it('lists the providers that take a key, and only those', async () => {
    const providers = await settings();
    assert.deepEqual(providers.map((provider) => provider.id), [
      'openai', 'anthropic', 'gemini', 'xai', 'openrouter', 'groq', 'mistral', 'deepseek',
    ]);
  });

  it('stores a key and reports it as configured', async () => {
    const res = await putKey('openai', KEY);
    assert.equal(res.status, 200);
    const { provider } = await res.json();
    assert.equal(provider.configured, true);
    assert.equal(provider.source, 'database');
  });

  it('never sends the key back, in any response', async () => {
    const responses = await Promise.all([
      (await fetch(`${BASE}/api/settings`)).text(),
      (await fetch(`${BASE}/api/models`)).text(),
    ]);
    for (const body of responses) assert.ok(!body.includes(KEY), 'a response contained the key');
  });

  it('shows a masked hint instead', async () => {
    const openai = (await settings()).find((provider) => provider.id === 'openai');
    assert.equal(openai.hint, 'sk-…4f2a');
  });

  it('rejects a key containing a newline, which would be a header injection', async () => {
    const res = await putKey('openai', 'sk-test\nx-injected: yes');
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /control characters/i);
  });

  it('rejects an empty or absurdly long key', async () => {
    assert.equal((await putKey('openai', '   ')).status, 400);
    assert.equal((await putKey('openai', 'k'.repeat(513))).status, 400);
  });

  it('rejects a key that is not a string', async () => {
    assert.equal((await putKey('openai', 42)).status, 400);
  });

  it('404s a provider that does not exist, or one that needs no key', async () => {
    assert.equal((await putKey('nope', KEY)).status, 404);
    assert.equal((await putKey('ollama', KEY)).status, 404);
  });

  it('removes a stored key', async () => {
    await putKey('gemini', KEY);
    const res = await fetch(`${BASE}/api/settings/gemini`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).provider.configured, false);
  });

  it('reports a key it cannot reach the provider to check as not working', async () => {
    // The base URL is unreachable in this run, so this exercises the failure
    // path rather than asserting anything about a real provider.
    const res = await fetch(`${BASE}/api/settings/anthropic/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: KEY }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(typeof body.ok, 'boolean');
  });

  it('refuses to test a provider with nothing to test', async () => {
    const res = await fetch(`${BASE}/api/settings/xai/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /No key is set/i);
  });
});

describe('saved comparisons', () => {
  const ID = 'cmp00000000000000000000000000042';
  const comparison = {
    title: 'Why is the sky blue?',
    system: 'Be terse.',
    models: ['openai:gpt-4o'],
    transcripts: {
      'openai:gpt-4o': [
        { role: 'user', text: 'Why is the sky blue?' },
        { role: 'assistant', text: 'Rayleigh scattering.', ms: 900 },
      ],
    },
  };
  const put = (id, body, headers = {}) =>
    fetch(`${BASE}/api/comparisons/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  it('saves one under the id the browser chose, and lists it', async () => {
    const res = await put(ID, comparison);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).comparison.questions, 1);

    const { comparisons } = await (await fetch(`${BASE}/api/comparisons`)).json();
    assert.deepEqual(comparisons.map((item) => item.id), [ID]);
  });

  it('opens it again exactly as it was saved', async () => {
    const { comparison: saved } = await (await fetch(`${BASE}/api/comparisons/${ID}`)).json();
    assert.deepEqual(saved.transcripts, comparison.transcripts);
    assert.equal(saved.system, 'Be terse.');
  });

  it('finds it by what was asked or answered', async () => {
    const hits = async (q) =>
      (await (await fetch(`${BASE}/api/comparisons?q=${encodeURIComponent(q)}`)).json()).comparisons.length;
    assert.equal(await hits('Rayleigh'), 1);
    assert.equal(await hits('nothing like it'), 0);
  });

  it('takes a comparison far bigger than a query is allowed to be', async () => {
    const long = { role: 'assistant', text: 'x'.repeat(3 * 1024 * 1024) };
    const res = await put('cmp-big-0000000000', {
      ...comparison,
      transcripts: { 'openai:gpt-4o': [comparison.transcripts['openai:gpt-4o'][0], long] },
    });
    assert.equal(res.status, 200);
  });

  it('refuses a malformed one, saying why', async () => {
    const res = await put(ID, { ...comparison, transcripts: { m: [{ role: 'system', text: 'x' }] } });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /role of user, assistant or error/);
  });

  it('refuses an id that is not one', async () => {
    assert.equal((await put('no', comparison)).status, 400);
    assert.equal((await fetch(`${BASE}/api/comparisons/..%2F..%2Fetc`)).status, 400);
  });

  it('404s one that does not exist', async () => {
    assert.equal((await fetch(`${BASE}/api/comparisons/cmp-missing-000000`)).status, 404);
  });

  it('will not let another site write one', async () => {
    assert.equal((await put(ID, comparison, { Origin: 'https://evil.example' })).status, 403);
  });

  it('deletes one', async () => {
    const res = await fetch(`${BASE}/api/comparisons/${ID}`, { method: 'DELETE' });
    assert.deepEqual(await res.json(), { deleted: true });
    assert.equal((await fetch(`${BASE}/api/comparisons/${ID}`)).status, 404);
  });
});

describe('saved prompts', () => {
  const create = (body) =>
    fetch(`${BASE}/api/prompts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('starts with a few of each kind', async () => {
    const { prompts } = await (await fetch(`${BASE}/api/prompts`)).json();
    assert.ok(prompts.some((prompt) => prompt.kind === 'system'));
    assert.ok(prompts.some((prompt) => prompt.kind === 'question'));
  });

  it('saves a new one and deletes it again', async () => {
    const res = await create({ kind: 'question', name: 'Haiku', text: 'Write a haiku about SQLite.' });
    assert.equal(res.status, 201);
    const { prompt } = await res.json();

    const removed = await fetch(`${BASE}/api/prompts/${prompt.id}`, { method: 'DELETE' });
    assert.deepEqual(await removed.json(), { deleted: true });
  });

  it('refuses one that is missing its text', async () => {
    const res = await create({ kind: 'system', name: 'Empty', text: '   ' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /cannot be empty/);
  });
});

/**
 * DNS rebinding: a page can re-point its own name at 127.0.0.1, which makes
 * this server its origin — the Origin check passes and responses are readable.
 * The Host header still carries the page's name, so that is what is checked.
 * fetch will not set Host, so these go through node:http.
 */
describe('requests addressed to another name', () => {
  const statusFor = (hostHeader) =>
    new Promise((resolve, reject) => {
      const req = request(
        { host: '127.0.0.1', port: PORT, path: '/api/comparisons', headers: { Host: hostHeader } },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode));
        },
      );
      req.on('error', reject);
      req.end();
    });

  it('refuses a name that is not this machine, even for a read', async () => {
    assert.equal(await statusFor(`evil.example:${PORT}`), 403);
  });

  it('answers to the loopback names', async () => {
    assert.equal(await statusFor(`localhost:${PORT}`), 200);
    assert.equal(await statusFor(`127.0.0.1:${PORT}`), 200);
    assert.equal(await statusFor(`[::1]:${PORT}`), 200);
    assert.equal(await statusFor(`app.localhost:${PORT}`), 200);
  });

  it('answers to a name listed in ALLOWED_HOSTS', async () => {
    assert.equal(await statusFor(`llm.test:${PORT}`), 200);
  });
});

describe('routes that no longer exist', () => {
  for (const path of ['/query2', '/set-context']) {
    it(`${path} is gone`, async () => {
      const res = await fetch(`${BASE}${path}`, { method: 'POST' });
      assert.equal(res.status, 404);
    });
  }
});

/**
 * A form-encoded body is a CORS "simple request": a browser sends it
 * cross-origin with no preflight, so a page the user merely visits could once
 * post a query through this server and spend their credits. Two things stop it
 * now — only JSON is parsed, and a state-changing request from an origin that
 * is not ours is refused — and both are worth holding onto.
 */
describe('cross-site requests', () => {
  const EVIL = 'https://evil.example';
  const SELF = BASE;

  const send = (path, { origin, type = 'application/json', body } = {}) =>
    fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': type, ...(origin ? { Origin: origin } : {}) },
      body,
    });

  const form = 'model=ollama:llama3:latest&messages[0][role]=user&messages[0][content]=hi';
  const json = JSON.stringify({ model: MODEL, messages: ask });

  it('blocks the form post that used to reach a provider', async () => {
    const res = await send('/query', {
      origin: EVIL,
      type: 'application/x-www-form-urlencoded',
      body: form,
    });
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /cross-site/i);
  });

  it('blocks a JSON query from another site', async () => {
    const res = await send('/query', { origin: EVIL, body: json });
    assert.equal(res.status, 403);
  });

  it('blocks another site from writing an API key', async () => {
    const res = await fetch(`${BASE}/api/settings/openai`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: EVIL },
      body: JSON.stringify({ apiKey: KEY }),
    });
    assert.equal(res.status, 403);
  });

  it('blocks another site from deleting one', async () => {
    const res = await fetch(`${BASE}/api/settings/openai`, {
      method: 'DELETE',
      headers: { Origin: EVIL },
    });
    assert.equal(res.status, 403);
  });

  it('stops parsing form bodies at all, whoever sends them', async () => {
    const res = await send('/query', {
      origin: SELF,
      type: 'application/x-www-form-urlencoded',
      body: form,
    });
    // Not a 403 — this one is allowed through and simply has no body to read.
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /model id is required/i);
  });

  it('lets the app itself through', async () => {
    const res = await send('/query', { origin: SELF, body: json });
    assert.notEqual(res.status, 403);
  });

  it('lets the Vite dev server through', async () => {
    const res = await send('/query', { origin: 'http://localhost:5173', body: json });
    assert.notEqual(res.status, 403);
  });

  it('lets a request with no Origin through — curl is not a cross-site attack', async () => {
    const res = await send('/query', { body: json });
    assert.notEqual(res.status, 403);
  });

  it('leaves reads alone: they change nothing and return no key', async () => {
    const res = await fetch(`${BASE}/api/models`, { headers: { Origin: EVIL } });
    assert.equal(res.status, 200);
  });
});

/**
 * The Thinking switch end to end: from the request, through what the model's
 * listing said about it, to what the provider is sent — and the reasoning back
 * out as events of its own.
 */
describe('a model that reasons', () => {
  const R1 = 'openrouter:deepseek/deepseek-r1';
  const lines = async (res) => (await res.text()).trim().split('\n').map((line) => JSON.parse(line));

  before(() => putKey('openrouter', KEY));
  after(() => fetch(`${BASE}/api/settings/openrouter`, { method: 'DELETE' }));

  it('streams its reasoning ahead of the answer, as events of their own', async () => {
    const res = await post({ model: R1, messages: ask });
    assert.equal(res.status, 200);
    assert.deepEqual((await lines(res)).filter((event) => event.type !== 'usage'), [
      { type: 'reasoning', text: 'First, add.' },
      { type: 'chunk', text: 'Four.' },
      { type: 'done' },
    ]);
  });

  it('is asked to reason only when the switch is on', async () => {
    await lines(await post({ model: R1, messages: ask }));
    assert.equal('reasoning' in received, false);
    await lines(await post({ model: R1, messages: ask, think: true }));
    assert.deepEqual(received.reasoning, { enabled: true });
  });
});
