import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, describe, it } from 'node:test';

/**
 * Boots the real server and exercises the routes that need no Ollama:
 * request validation, which runs before the registry is consulted, and the
 * registry's own behaviour when the daemon is unreachable. OLLAMA_URL points
 * at a closed port so "unreachable" is deterministic rather than dependent on
 * whether the machine happens to be running ollama.
 */
const PORT = 3987;
const BASE = `http://127.0.0.1:${PORT}`;
let server;

before(async () => {
  server = spawn(process.execPath, ['server.mjs'], {
    env: { ...process.env, PORT: String(PORT), OLLAMA_URL: 'http://127.0.0.1:1', NODE_ENV: 'test' },
    stdio: 'ignore',
  });

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await fetch(`${BASE}/api/models`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('server did not start');
});

after(() => {
  server?.kill();
});

const post = (body) =>
  fetch(`${BASE}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const MODEL = 'llama3:latest';
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

  it('validates before reaching Ollama, so these never 503', async () => {
    // Ollama is deliberately unreachable here; a 400 proves ordering.
    assert.equal((await post({ messages: ask })).status, 400);
  });
});

describe('an unreachable Ollama', () => {
  it('reports the registry as unavailable, with the daemon hint', async () => {
    const res = await fetch(`${BASE}/api/models`);
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /ollama serve/);
  });

  it('fails a well-formed query with the same hint, not a stream', async () => {
    const res = await post({ model: MODEL, messages: ask });
    assert.equal(res.status, 503);
    assert.match(res.headers.get('content-type'), /application\/json/);
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
