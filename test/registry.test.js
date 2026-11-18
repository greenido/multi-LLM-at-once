import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';

/**
 * The registry puts every provider's listing into one catalogue. A listing can
 * be plain names or, where a provider publishes prices, { name, pricing } —
 * this checks both shapes come out the same way, and that the availability
 * check reads either. One stub stands in for OpenRouter (priced) and Groq
 * (plain names); every other provider is unreachable or unconfigured.
 */
process.env.KEYS_DB = ':memory:';
process.env.OLLAMA_URL = 'http://127.0.0.1:1';
for (const name of ['OPENAI', 'ANTHROPIC', 'GEMINI', 'XAI', 'MISTRAL', 'DEEPSEEK']) {
  process.env[`${name}_API_KEY`] = '';
}
// Invented values — never a real credential.
process.env.OPENROUTER_API_KEY = 'sk-test-000000000000000000000000004f2a';
process.env.GROQ_API_KEY = 'sk-test-000000000000000000000000004f2a';

let server;
let registry;
/** How many times Groq was asked for its listing. */
let groqListings = 0;
/** Set to make Groq's listing fail, as a network blip would. */
let groqDown = false;

before(async () => {
  server = createServer((req, res) => {
    if (req.url.startsWith('/groq/')) {
      groqListings += 1;
      if (groqDown) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'Groq is having a moment.' } }));
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url.startsWith('/openrouter/models')) {
      return res.end(JSON.stringify({
        data: [{ id: 'openai/gpt-4o', pricing: { prompt: '0.0000025', completion: '0.00001' } }],
      }));
    }
    // The second is in no fallback list, so only a live listing offers it.
    res.end(JSON.stringify({ data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'live-only-model' }] }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.OPENROUTER_BASE_URL = `${base}/openrouter`;
  process.env.GROQ_BASE_URL = `${base}/groq`;
  registry = await import('../server/registry.mjs');
});

after(() => server?.close());

describe('the catalogue', () => {
  it('carries a price with each model whose provider publishes one', async () => {
    const { models } = await registry.listAll();
    assert.deepEqual(models.find((model) => model.id === 'openrouter:openai/gpt-4o'), {
      id: 'openrouter:openai/gpt-4o',
      provider: 'openrouter',
      name: 'openai/gpt-4o',
      pricing: { prompt: 0.0000025, completion: 0.00001 },
    });
  });

  it('adds no price where there is none', async () => {
    const { models } = await registry.listAll();
    assert.equal('pricing' in models.find((model) => model.provider === 'groq'), false);
  });

  it('finds a listed model either way when checking a request, and says what was listed', async () => {
    assert.deepEqual(await registry.checkAvailability('openrouter:openai/gpt-4o'), {
      ok: true,
      model: { name: 'openai/gpt-4o', pricing: { prompt: 0.0000025, completion: 0.00001 } },
    });
    assert.deepEqual(await registry.checkAvailability('groq:llama-3.3-70b-versatile'), {
      ok: true,
      model: { name: 'llama-3.3-70b-versatile' },
    });
    assert.equal((await registry.checkAvailability('openrouter:openai/gpt-5')).status, 400);
  });
});

describe('the listing cache', () => {
  it('asks a provider once when several requests need its listing at the same moment', async () => {
    registry.invalidate('groq');
    const before = groqListings;
    const checks = await Promise.all(
      Array.from({ length: 4 }, () => registry.checkAvailability('groq:llama-3.3-70b-versatile')),
    );
    assert.ok(checks.every((check) => check.ok));
    assert.equal(groqListings, before + 1);
  });

  it('tries a failed listing again within seconds, not minutes', async (t) => {
    let now = Date.now();
    t.mock.method(Date, 'now', () => now);

    registry.invalidate('groq');
    groqDown = true;
    try {
      assert.equal((await registry.checkAvailability('groq:live-only-model')).status, 503);
    } finally {
      groqDown = false;
    }

    // Still the cached failure a moment later...
    now += 1_000;
    assert.equal((await registry.checkAvailability('groq:live-only-model')).status, 503);

    // ...but not once the short error window has passed.
    now += registry.ERROR_TTL_MS;
    assert.equal((await registry.checkAvailability('groq:live-only-model')).ok, true);
  });

  it('keeps a good listing for its full time', async (t) => {
    let now = Date.now();
    t.mock.method(Date, 'now', () => now);

    registry.invalidate('groq');
    await registry.listAll();
    const before = groqListings;
    now += registry.ERROR_TTL_MS * 2;
    await registry.listAll();
    assert.equal(groqListings, before);
  });

  it('does not let a listing that was invalidated mid-flight land in the cache', async () => {
    registry.invalidate('groq');
    const stale = registry.checkAvailability('groq:llama-3.3-70b-versatile');
    registry.invalidate('groq');
    await stale;
    const before = groqListings;
    await registry.checkAvailability('groq:llama-3.3-70b-versatile');
    assert.equal(groqListings, before + 1);
  });
});
