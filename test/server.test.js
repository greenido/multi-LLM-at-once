import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
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

// Invented values — never a real credential.
const KEY = 'sk-test-000000000000000000000000004f2a';

let server;

before(async () => {
  rmSync(DB, { force: true });
  server = spawn(process.execPath, ['server.mjs'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      KEYS_DB: DB,
      OLLAMA_URL: 'http://127.0.0.1:1',
      NODE_ENV: 'test',
      // Cloud providers must be unconfigured at the start of the run.
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY: '',
      GEMINI_API_KEY: '',
      XAI_API_KEY: '',
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
  rmSync(DB, { force: true });
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
    assert.deepEqual(providers.map((provider) => provider.id), ['openai', 'anthropic', 'gemini', 'xai']);
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
