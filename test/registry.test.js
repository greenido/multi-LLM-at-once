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

before(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url.startsWith('/openrouter/models')) {
      return res.end(JSON.stringify({
        data: [{ id: 'openai/gpt-4o', pricing: { prompt: '0.0000025', completion: '0.00001' } }],
      }));
    }
    res.end(JSON.stringify({ data: [{ id: 'llama-3.3-70b-versatile' }] }));
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

  it('finds a listed model either way when checking a request', async () => {
    assert.deepEqual(await registry.checkAvailability('openrouter:openai/gpt-4o'), { ok: true });
    assert.deepEqual(await registry.checkAvailability('groq:llama-3.3-70b-versatile'), { ok: true });
    assert.equal((await registry.checkAvailability('openrouter:openai/gpt-5')).status, 400);
  });
});
