import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';

/**
 * Only OpenRouter publishes prices in its listing. For models reached
 * directly — OpenAI, Anthropic, Gemini, Grok, Mistral, DeepSeek — the list
 * price comes from OpenRouter's public catalogue, which charges what each lab
 * charges. A stub stands in for it; nothing here reaches the network.
 */
let server;
let requests = 0;
let failing = false;
let prices;

const CATALOGUE = [
  { id: 'openai/gpt-4o', pricing: { prompt: '0.0000025', completion: '0.00001' } },
  { id: 'anthropic/claude-sonnet-4.5', pricing: { prompt: '0.000003', completion: '0.000015' } },
  { id: 'anthropic/claude-3.5-haiku', pricing: { prompt: '0.0000008', completion: '0.000004' } },
  { id: 'google/gemini-2.5-flash', pricing: { prompt: '0.0000003', completion: '0.0000025' } },
  { id: 'mistralai/mistral-large', pricing: { prompt: '0.000002', completion: '0.000006' } },
  { id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } },
];

before(async () => {
  server = createServer((req, res) => {
    requests += 1;
    if (failing) {
      res.writeHead(503);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: CATALOGUE }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.PRICES_URL = `http://127.0.0.1:${server.address().port}/models`;
  prices = await import('../server/prices.mjs');
});

after(() => server?.close());

beforeEach(() => {
  prices.clearPrices();
  failing = false;
});

describe('the price catalogue', () => {
  it('is read once and kept', async () => {
    const before = requests;
    await prices.priceCatalogue();
    await Promise.all([prices.priceCatalogue(), prices.priceCatalogue()]);
    assert.equal(requests, before + 1);
  });

  it('skips a price that varies, which OpenRouter writes as a negative number', async () => {
    assert.equal((await prices.priceCatalogue()).has('openrouter/auto'), false);
  });

  it('keeps the last prices it had when a refresh a day later fails', async (t) => {
    let now = Date.now();
    t.mock.method(Date, 'now', () => now);
    assert.ok((await prices.priceCatalogue()).has('openai/gpt-4o'));

    failing = true;
    now += 25 * 60 * 60_000;
    const before = requests;
    assert.ok((await prices.priceCatalogue()).has('openai/gpt-4o'));
    assert.equal(requests, before + 1);
  });

  it('is empty when it has never been read', async () => {
    failing = true;
    assert.equal((await prices.priceCatalogue()).size, 0);
  });

  it('is not asked at all when PRICES_URL is empty', async () => {
    const saved = process.env.PRICES_URL;
    process.env.PRICES_URL = '';
    const before = requests;
    try {
      assert.equal((await prices.priceCatalogue()).size, 0);
      assert.equal(requests, before);
    } finally {
      process.env.PRICES_URL = saved;
    }
  });
});

describe('a model reached directly', () => {
  const priceOf = async (provider, name) => prices.listPrice(provider, name, await prices.priceCatalogue());

  it('gets its list price, marked as an estimate', async () => {
    assert.deepEqual(await priceOf('openai', 'gpt-4o'), { prompt: 0.0000025, completion: 0.00001, estimated: true });
    assert.deepEqual(await priceOf('gemini', 'gemini-2.5-flash'), {
      prompt: 0.0000003,
      completion: 0.0000025,
      estimated: true,
    });
  });

  it('reads past the date and the hyphenated version in an Anthropic id', async () => {
    assert.equal((await priceOf('anthropic', 'claude-sonnet-4-5-20250929')).prompt, 0.000003);
    assert.equal((await priceOf('anthropic', 'claude-3-5-haiku-20241022')).prompt, 0.0000008);
  });

  it('reads past Mistral\'s -latest', async () => {
    assert.equal((await priceOf('mistral', 'mistral-large-latest')).prompt, 0.000002);
  });

  it('does not guess for a dated OpenAI snapshot, which can be priced apart from its alias', async () => {
    assert.equal(await priceOf('openai', 'gpt-4o-2024-05-13'), null);
  });

  it('has no price for a model the catalogue does not list, or a provider it does not cover', async () => {
    assert.equal(await priceOf('openai', 'gpt-nonexistent'), null);
    assert.equal(await priceOf('groq', 'llama-3.3-70b-versatile'), null);
    assert.equal(await priceOf('ollama', 'llama3:latest'), null);
  });
});
