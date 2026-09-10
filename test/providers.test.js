import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';

import { anthropic } from '../server/providers/anthropic.mjs';
import { gemini } from '../server/providers/gemini.mjs';
import { ollama } from '../server/providers/ollama.mjs';
import { deepseek, groq, mistral, openai, openrouter, xai } from '../server/providers/openai.mjs';

/**
 * Each cloud provider speaks a different dialect, and the adapters exist to
 * flatten those into one shape. This suite stands a stub in front of them that
 * answers in each provider's real wire format and records what it was sent, so
 * both directions are checked: that we parse their frames, and that we put the
 * system prompt, the history and the API key where each one expects them.
 *
 * Nothing here reaches a real provider, and the key is invented.
 */
const KEY = 'sk-test-000000000000000000000000004f2a';

/** What the stub last received, for asserting on the outbound request. */
let seen = null;
/** How many times Ollama was asked what a model can do. */
let shows = 0;
let server;

const sse = (lines) => lines.map((line) => `${line}\n\n`).join('');
const json = (res, body) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => resolve(raw ? JSON.parse(raw) : {}));
  });

before(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const [, segment, ...rest] = url.pathname.split('/');
    const path = `/${rest.join('/')}`;
    // openai-401 and openai-stall are the same dialect on a route that
    // misbehaves, so a test can point a base URL at one; openai-reasoning
    // answers as a reasoning model would, and ollama-tags as one that writes
    // its reasoning into the answer between <think> tags.
    const dialect = segment.replace(/-(401|stall|reasoning|tags)$/, '');
    const reasoning = segment.endsWith('-reasoning');
    const tags = segment.endsWith('-tags');

    if (segment.endsWith('-401')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Incorrect API key provided.' } }));
    }

    if (req.method === 'GET' && path.startsWith('/models')) {
      seen = { headers: req.headers };
      if (dialect === 'gemini') {
        return json(res, {
          models: [
            { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'], thinking: true },
            { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'], thinking: true },
            { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-2.5-flash-tts', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
            { name: 'models/imagen-3.0', supportedGenerationMethods: ['predict'] },
          ],
        });
      }
      if (dialect === 'anthropic') {
        // Which kinds of thinking each model takes, as Anthropic lists them.
        const thinks = ({ enabled = false, adaptive = false }) => ({
          thinking: {
            supported: enabled || adaptive,
            types: { enabled: { supported: enabled }, adaptive: { supported: adaptive } },
          },
        });
        return json(res, {
          data: [
            { id: 'claude-opus-5', capabilities: thinks({ adaptive: true }) },
            { id: 'claude-opus-4-6', capabilities: thinks({ enabled: true, adaptive: true }) },
            { id: 'claude-haiku-4-5', capabilities: thinks({ enabled: true }) },
            { id: 'claude-3-haiku-20240307', capabilities: thinks({}) },
          ],
        });
      }
      if (dialect === 'xai') {
        return json(res, { data: [{ id: 'grok-3' }, { id: 'grok-3-mini' }, { id: 'grok-2-image' }] });
      }
      if (dialect === 'groq') {
        return json(res, {
          data: [
            { id: 'llama-3.3-70b-versatile', active: true },
            // "instruct" does not mean what it means at OpenAI: this one chats.
            { id: 'meta-llama/llama-4-scout-17b-16e-instruct', active: true },
            { id: 'whisper-large-v3', active: true },
            { id: 'playai-tts', active: true },
            { id: 'meta-llama/llama-guard-4-12b', active: true },
            { id: 'retired-model', active: false },
          ],
        });
      }
      if (dialect === 'mistral') {
        return json(res, {
          data: [
            { id: 'mistral-large-latest', capabilities: { completion_chat: true } },
            { id: 'mistral-small-latest', capabilities: { completion_chat: true } },
            { id: 'mistral-embed', capabilities: { completion_chat: false } },
            { id: 'mistral-ocr-latest', capabilities: { completion_chat: false } },
          ],
        });
      }
      if (dialect === 'deepseek') {
        return json(res, { data: [{ id: 'deepseek-reasoner' }, { id: 'deepseek-chat' }] });
      }
      if (dialect === 'openrouter') {
        return json(res, {
          data: [
            { id: 'openai/gpt-4o', pricing: { prompt: '0.0000025', completion: '0.00001' }, architecture: { output_modalities: ['text'] }, supported_parameters: ['max_tokens', 'temperature'] },
            { id: 'deepseek/deepseek-r1', pricing: { prompt: '0.0000004', completion: '0.000002' }, architecture: { output_modalities: ['text'] }, supported_parameters: ['max_tokens', 'reasoning', 'include_reasoning'] },
            { id: 'meta-llama/llama-3.3-70b-instruct:free', pricing: { prompt: '0', completion: '0' }, architecture: { output_modalities: ['text'] } },
            // A router whose price depends on where it sends you.
            { id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' }, architecture: { output_modalities: ['text'] } },
            { id: 'black-forest-labs/flux-pro', pricing: { prompt: '0', completion: '0.04' }, architecture: { output_modalities: ['image'] } },
          ],
        });
      }
      return json(res, {
        data: [
          'gpt-4o', 'gpt-4o-mini', 'o3-mini', 'chatgpt-4o-latest',
          // None of these can hold a conversation.
          'gpt-4o-audio-preview', 'gpt-4o-transcribe', 'gpt-3.5-turbo-instruct',
          'text-embedding-3-small', 'dall-e-3', 'whisper-1', 'tts-1', 'omni-moderation-latest',
        ].map((id) => ({ id })),
      });
    }

    const body = await readBody(req);
    seen = { headers: req.headers, body, path, query: url.search };

    // Ollama says what a model can do. Here, any model named for it can think.
    if (dialect === 'ollama' && path === '/api/show') {
      shows += 1;
      return json(res, { capabilities: body.model.startsWith('thinker') ? ['completion', 'thinking'] : ['completion'] });
    }

    // Ollama streams newline-delimited JSON rather than SSE, and times itself
    // in nanoseconds on the final line.
    if (dialect === 'ollama') {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      const line = (value) => `${JSON.stringify({ model: 'test-model', ...value })}\n`;
      const says = (message) => line({ message: { role: 'assistant', content: '', ...message }, done: false });
      // A thinking model's reasoning has its own field; a model with no
      // template for it writes it into the answer instead.
      const thought = reasoning
        ? [says({ thinking: 'First, ' }), says({ thinking: 'add.' })]
        : tags ? [says({ content: '<think>First, ' }), says({ content: 'add.</think>\n\n' })] : [];
      return res.end([
        ...thought,
        line({ message: { role: 'assistant', content: 'Hello ' }, done: false }),
        line({ message: { role: 'assistant', content: 'there' }, done: false }),
        line({
          message: { role: 'assistant', content: '' },
          done: true,
          prompt_eval_count: 111,
          eval_count: 222,
          load_duration: 2_100_000_000,
          eval_duration: 800_000_000,
        }),
      ].join(''));
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream' });

    // A stream that never ends, for the cancellation test.
    if (segment.endsWith(`-stall`)) {
      const frame = dialect === 'gemini'
        ? `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'x' }] } }] })}`
        : `data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}`;
      const timer = setInterval(() => res.write(sse([frame])), 10);
      res.on('close', () => clearInterval(timer));
      return;
    }

    if (dialect === 'anthropic') {
      const event = (type, value) => `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}`;
      const usage = reasoning
        ? { output_tokens: 1222, output_tokens_details: { thinking_tokens: 1000 } }
        : { output_tokens: 222 };
      return res.end(sse([
        event('message_start', { message: { usage: { input_tokens: 111 } } }),
        // A summary of the model's thinking, closed by a signature that is
        // only for sending back.
        event('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }),
        event('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'SCRATCHPAD' } }),
        event('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'c2lnbmF0dXJl' } }),
        event('content_block_stop', { index: 0 }),
        event('content_block_delta', { index: 1, delta: { type: 'text_delta', text: 'Hello ' } }),
        event('content_block_delta', { index: 1, delta: { type: 'text_delta', text: 'there' } }),
        event('message_delta', { usage }),
        event('message_stop', {}),
      ]));
    }

    if (dialect === 'gemini') {
      const usageMetadata = { promptTokenCount: 111, candidatesTokenCount: 222 };
      // A thinking model's reasoning is counted apart from its answer.
      if (reasoning) usageMetadata.thoughtsTokenCount = 1000;
      return res.end(sse([
        // Asked for, a thinking model's thoughts come first, marked as such.
        ...(reasoning ? [`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'First, add.', thought: true }] } }] })}`] : []),
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hello ' }, { text: 'there' }] } }] })}`,
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '' }] } }], usageMetadata })}`,
      ]));
    }

    // Groq's counts, and its own timing, ride on the last frame under x_groq.
    // Its GPT-OSS models send their reasoning in a field; Qwen writes it into
    // the answer in <think> tags.
    if (dialect === 'groq') {
      const lead = reasoning
        ? [{ reasoning: 'First, add.' }]
        : tags ? [{ content: '<think>First, ' }, { content: 'add.</think>\n\n' }] : [];
      return res.end(sse([
        ...lead.map((delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}`),
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello ' } }] })}`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'there' } }], x_groq: { usage: { prompt_tokens: 111, completion_tokens: 222, completion_time: 0.5 } } })}`,
        'data: [DONE]',
      ]));
    }

    // OpenAI counts reasoning inside completion_tokens; Grok beside it.
    let usage = { prompt_tokens: 111, completion_tokens: 222 };
    // OpenRouter, asked, says what the answer cost.
    if (dialect === 'openrouter') usage = { ...usage, cost: 0.0042 };
    if (reasoning && dialect === 'openai') {
      usage = { prompt_tokens: 111, completion_tokens: 1222, total_tokens: 1333, completion_tokens_details: { reasoning_tokens: 1000 } };
    }
    if (reasoning && dialect === 'xai') {
      usage = { prompt_tokens: 111, completion_tokens: 222, total_tokens: 1333, completion_tokens_details: { reasoning_tokens: 1000 } };
    }

    // Where each provider puts the reasoning it sends ahead of the answer.
    const LEAD = {
      deepseek: [{ reasoning_content: 'First, ' }, { reasoning_content: 'add.' }],
      openrouter: [
        { reasoning_details: [{ type: 'reasoning.text', text: 'First, ' }, { type: 'reasoning.encrypted', data: 'b3BhcXVl' }] },
        { reasoning_details: [{ type: 'reasoning.summary', summary: 'add.' }] },
      ],
    };
    const deltas = reasoning && dialect === 'mistral'
      ? [
          { content: [{ type: 'thinking', thinking: [{ type: 'text', text: 'First, ' }] }] },
          // The frame where the thinking ends and the answer begins.
          { content: [{ type: 'thinking', thinking: [{ type: 'text', text: 'add.' }] }, { type: 'text', text: 'Hello ' }] },
          { content: 'there' },
        ]
      : [...(reasoning ? LEAD[dialect] ?? [] : []), { content: 'Hello ' }, { content: 'there' }];

    return res.end(sse([
      ...deltas.map((delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}`),
      `data: ${JSON.stringify({ choices: [], usage })}`,
      'data: [DONE]',
    ]));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.OPENAI_BASE_URL = `${base}/openai`;
  process.env.ANTHROPIC_BASE_URL = `${base}/anthropic`;
  process.env.GEMINI_BASE_URL = `${base}/gemini`;
  process.env.XAI_BASE_URL = `${base}/xai`;
  process.env.OLLAMA_URL = `${base}/ollama`;
  process.env.GROQ_BASE_URL = `${base}/groq`;
  process.env.MISTRAL_BASE_URL = `${base}/mistral`;
  process.env.DEEPSEEK_BASE_URL = `${base}/deepseek`;
  process.env.OPENROUTER_BASE_URL = `${base}/openrouter`;
});

after(() => server?.close());

/** Drain an adapter's stream into the text, reasoning and usage it produced. */
async function drain(provider, options = {}) {
  let text = '';
  let reasoning = '';
  let usage = null;
  for await (const part of provider.chat({
    key: KEY,
    model: 'test-model',
    messages: [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer' },
      { role: 'user', content: 'second' },
    ],
    system: 'Answer in haiku.',
    ...options,
  })) {
    if (part.text) text += part.text;
    if (part.reasoning) reasoning += part.reasoning;
    if (part.usage) usage = part.usage;
  }
  return { text, reasoning, usage };
}

/** Point a provider's base URL at one of the stub's variants while `run` runs. */
async function onVariant(envVar, variant, run) {
  const saved = process.env[envVar];
  process.env[envVar] = `${saved}-${variant}`;
  try {
    return await run();
  } finally {
    process.env[envVar] = saved;
  }
}

describe('listing models', () => {
  it('OpenAI keeps chat models and drops audio, image, embedding and instruct ones', async () => {
    assert.deepEqual(await openai.listModels(KEY), [
      'chatgpt-4o-latest', 'gpt-4o', 'gpt-4o-mini', 'o3-mini',
    ]);
  });

  it('Gemini asks the listing what each model can do, thinking included, rather than guessing', async () => {
    assert.deepEqual(await gemini.listModels(KEY), [
      { name: 'gemini-2.0-flash' },
      { name: 'gemini-2.5-flash', thinking: true },
      { name: 'gemini-2.5-pro', thinking: true },
    ]);
  });

  it('Grok drops the image model', async () => {
    assert.deepEqual(await xai.listModels(KEY), ['grok-3', 'grok-3-mini']);
  });

  it('Anthropic keeps everything, since that endpoint lists only chat models', async () => {
    assert.deepEqual(
      (await anthropic.listModels(KEY)).map((model) => model.name),
      ['claude-3-haiku-20240307', 'claude-haiku-4-5', 'claude-opus-4-6', 'claude-opus-5'],
    );
  });

  it('Anthropic says how each model thinks, preferring adaptive where it has both', async () => {
    assert.deepEqual(await anthropic.listModels(KEY), [
      { name: 'claude-3-haiku-20240307' },
      { name: 'claude-haiku-4-5', thinking: 'enabled' },
      { name: 'claude-opus-4-6', thinking: 'adaptive' },
      { name: 'claude-opus-5', thinking: 'adaptive' },
    ]);
  });

  it('Groq drops speech, safety and retired models, but keeps an instruct model', async () => {
    assert.deepEqual(await groq.listModels(KEY), [
      'llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct',
    ]);
  });

  it('Mistral asks the listing which models can chat', async () => {
    assert.deepEqual(await mistral.listModels(KEY), ['mistral-large-latest', 'mistral-small-latest']);
  });

  it('DeepSeek keeps everything it lists', async () => {
    assert.deepEqual(await deepseek.listModels(KEY), ['deepseek-chat', 'deepseek-reasoner']);
  });

  it('OpenRouter keeps text models with their price per token, and none where the price varies', async () => {
    assert.deepEqual(await openrouter.listModels(KEY), [
      { name: 'deepseek/deepseek-r1', pricing: { prompt: 0.0000004, completion: 0.000002 }, thinking: true },
      { name: 'meta-llama/llama-3.3-70b-instruct:free', pricing: { prompt: 0, completion: 0 } },
      { name: 'openai/gpt-4o', pricing: { prompt: 0.0000025, completion: 0.00001 } },
      { name: 'openrouter/auto' },
    ]);
  });
});

describe('authenticating', () => {
  it('OpenAI and everyone who speaks its API use a bearer token', async () => {
    for (const provider of [openai, xai, groq, mistral, deepseek, openrouter]) {
      await provider.listModels(KEY);
      assert.equal(seen.headers.authorization, `Bearer ${KEY}`, provider.label);
    }
  });

  it('Anthropic uses x-api-key, and pins the API version', async () => {
    await anthropic.listModels(KEY);
    assert.equal(seen.headers['x-api-key'], KEY);
    assert.equal(seen.headers['anthropic-version'], '2023-06-01');
  });

  it('Gemini uses x-goog-api-key, never a query parameter', async () => {
    await gemini.listModels(KEY);
    assert.equal(seen.headers['x-goog-api-key'], KEY);
  });
});

describe('streaming an answer', () => {
  for (const [name, provider] of [
    ['OpenAI', openai], ['Grok', xai], ['Anthropic', anthropic], ['Gemini', gemini], ['Mistral', mistral], ['DeepSeek', deepseek],
  ]) {
    it(`${name} yields the text and the token counts`, async () => {
      const { text, usage } = await drain(provider);
      assert.equal(text, 'Hello there');
      assert.deepEqual(usage, { promptTokens: 111, completionTokens: 222 });
    });
  }


  it('Gemini joins several parts within one frame', async () => {
    const { text } = await drain(gemini);
    assert.equal(text, 'Hello there');
  });

  it("Groq's counts arrive under x_groq, with its own decode time", async () => {
    const { text, usage } = await drain(groq);
    assert.equal(text, 'Hello there');
    assert.deepEqual(usage, { promptTokens: 111, completionTokens: 222, evalMs: 500 });
  });

  it('OpenRouter reports what the answer cost', async () => {
    const { usage } = await drain(openrouter);
    assert.deepEqual(usage, { promptTokens: 111, completionTokens: 222, costUsd: 0.0042 });
  });

  it('Ollama yields the text, the token counts and its own timings, in milliseconds', async () => {
    const { text, usage } = await drain(ollama);
    assert.equal(text, 'Hello there');
    assert.deepEqual(usage, { promptTokens: 111, completionTokens: 222, loadMs: 2100, evalMs: 800 });
  });
});

/**
 * A reasoning model's hidden tokens are billed as output, but each provider
 * reports them differently. Normalised, completionTokens is everything the
 * model wrote and reasoningTokens is how much of it was reasoning — which is
 * what lets tokens per second leave out the part that never streamed.
 */
describe('counting reasoning tokens', () => {
  const REASONED = { promptTokens: 111, completionTokens: 1222, reasoningTokens: 1000 };

  const drainReasoning = (provider, envVar) => onVariant(envVar, 'reasoning', () => drain(provider));

  it('OpenAI already counts them inside completion_tokens', async () => {
    assert.deepEqual((await drainReasoning(openai, 'OPENAI_BASE_URL')).usage, REASONED);
  });

  it('Grok counts them beside it, so they are added in', async () => {
    assert.deepEqual((await drainReasoning(xai, 'XAI_BASE_URL')).usage, REASONED);
  });

  it('Gemini counts them in thoughtsTokenCount, so they are added in', async () => {
    assert.deepEqual((await drainReasoning(gemini, 'GEMINI_BASE_URL')).usage, REASONED);
  });

  it('Anthropic counts them inside output_tokens, and says how many were thinking', async () => {
    assert.deepEqual((await drainReasoning(anthropic, 'ANTHROPIC_BASE_URL')).usage, REASONED);
  });

  it('reports no reasoning at all for a model that did none', async () => {
    const { usage } = await drain(openai);
    assert.equal('reasoningTokens' in usage, false);
  });
});

/**
 * The chat completions API has no field for reasoning, so each provider that
 * shows it picked its own place — and two write it into the answer. Every one
 * comes out as the same two streams: the reasoning, and the answer.
 */
describe('keeping reasoning apart from the answer', () => {
  const THOUGHT = 'First, add.';

  for (const [name, provider, envVar, variant] of [
    ['Gemini, asked, marks its thought parts', gemini, 'GEMINI_BASE_URL', 'reasoning'],
    ['Ollama sends it in a field of its own', ollama, 'OLLAMA_URL', 'reasoning'],
    ['Ollama, with no template for it, writes it in <think> tags, which come out', ollama, 'OLLAMA_URL', 'tags'],
    ['DeepSeek sends reasoning_content', deepseek, 'DEEPSEEK_BASE_URL', 'reasoning'],
    ['Groq sends reasoning, from GPT-OSS', groq, 'GROQ_BASE_URL', 'reasoning'],
    ["Groq's Qwen writes it in <think> tags, which come out", groq, 'GROQ_BASE_URL', 'tags'],
    ['OpenRouter sends reasoning_details, and the encrypted ones are skipped', openrouter, 'OPENROUTER_BASE_URL', 'reasoning'],
    ['Mistral sends typed chunks in place of the content string', mistral, 'MISTRAL_BASE_URL', 'reasoning'],
  ]) {
    it(name, async () => {
      const { text, reasoning } = await onVariant(envVar, variant, () => drain(provider));
      assert.equal(reasoning, THOUGHT);
      assert.equal(text, 'Hello there');
    });
  }

  it('Anthropic streams the summary of its thinking, and not the signature', async () => {
    const { text, reasoning } = await drain(anthropic);
    assert.equal(reasoning, 'SCRATCHPAD');
    assert.equal(text, 'Hello there');
  });

  it('a model that did not reason sends none', async () => {
    assert.equal((await drain(openai)).reasoning, '');
    assert.equal((await drain(ollama)).reasoning, '');
  });
});

/**
 * The Thinking switch. Each API asks for reasoning its own way, and asking a
 * model that cannot do it is at best ignored and at worst an error, so a model
 * is only asked when its listing says it can be.
 */
describe('asking a model to think', () => {
  const ROOM = 4096 + 16_000;

  it('Claude 4.6 and later think adaptively, and are asked for the summary', async () => {
    await drain(anthropic, { think: true, thinking: 'adaptive' });
    assert.deepEqual(seen.body.thinking, { type: 'adaptive', display: 'summarized' });
    assert.equal(seen.body.max_tokens, ROOM);
  });

  it('Claude 4.5 and earlier think to a budget, which max_tokens has to exceed', async () => {
    await drain(anthropic, { think: true, thinking: 'enabled' });
    assert.deepEqual(seen.body.thinking, { type: 'enabled', budget_tokens: 16_000 });
    assert.ok(seen.body.max_tokens > seen.body.thinking.budget_tokens);
  });

  it('a Claude that thinks unasked gets the room for it anyway', async () => {
    await drain(anthropic, { think: false, thinking: 'adaptive' });
    assert.equal('thinking' in seen.body, false);
    assert.equal(seen.body.max_tokens, ROOM);
  });

  it('a Claude that cannot think is not asked to', async () => {
    await drain(anthropic, { think: true });
    assert.equal('thinking' in seen.body, false);
    assert.equal(seen.body.max_tokens, 4096);
  });

  it('Gemini is asked for its thoughts only when it has them and the switch is on', async () => {
    await drain(gemini, { think: true, thinking: true });
    assert.deepEqual(seen.body.generationConfig, { thinkingConfig: { includeThoughts: true } });
    await drain(gemini, { think: true });
    assert.equal('generationConfig' in seen.body, false);
    await drain(gemini, { thinking: true });
    assert.equal('generationConfig' in seen.body, false);
  });

  it('Ollama checks what the model can do first, since think fails one that cannot', async () => {
    await drain(ollama, { model: 'thinker', think: true });
    assert.equal(seen.body.think, true);
    await drain(ollama, { think: true });
    assert.equal('think' in seen.body, false);
  });

  it('Ollama makes no extra round trip when the switch is off', async () => {
    const before = shows;
    await drain(ollama, { model: 'thinker' });
    assert.equal(shows, before);
    assert.equal('think' in seen.body, false);
  });

  it('OpenRouter asks for reasoning where the listing says the model takes it', async () => {
    await drain(openrouter, { think: true, thinking: true });
    assert.deepEqual(seen.body.reasoning, { enabled: true });
    assert.deepEqual(seen.body.usage, { include: true });
    await drain(openrouter, { think: true });
    assert.equal('reasoning' in seen.body, false);
  });

  it("nobody else is sent OpenRouter's reasoning request", async () => {
    for (const provider of [openai, xai, groq, mistral, deepseek]) {
      await drain(provider, { think: true, thinking: true });
      assert.equal('reasoning' in seen.body, false, provider.label);
    }
  });
});

describe('placing the system prompt where each API expects it', () => {
  it('OpenAI puts it at the front of the messages', async () => {
    await drain(openai);
    assert.deepEqual(seen.body.messages[0], { role: 'system', content: 'Answer in haiku.' });
    assert.equal(seen.body.messages.length, 4);
  });

  it('Anthropic puts it in a top-level field, not in the messages', async () => {
    await drain(anthropic);
    assert.equal(seen.body.system, 'Answer in haiku.');
    assert.equal(seen.body.messages.length, 3);
    assert.ok(!seen.body.messages.some((message) => message.role === 'system'));
  });

  it('Gemini puts it in systemInstruction', async () => {
    await drain(gemini);
    assert.equal(seen.body.systemInstruction.parts[0].text, 'Answer in haiku.');
  });

  it('is omitted entirely when there is none, rather than sent empty', async () => {
    await drain(anthropic, { system: null });
    assert.equal('system' in seen.body, false);
    await drain(gemini, { system: null });
    assert.equal('systemInstruction' in seen.body, false);
    await drain(openai, { system: null });
    assert.equal(seen.body.messages.length, 3);
  });
});

describe('sending the conversation', () => {
  it('OpenAI gets the history verbatim', async () => {
    await drain(openai);
    assert.deepEqual(
      seen.body.messages.slice(1).map((message) => message.role),
      ['user', 'assistant', 'user'],
    );
  });

  it('Gemini calls the assistant "model" and wraps content in parts', async () => {
    await drain(gemini);
    assert.deepEqual(seen.body.contents.map((entry) => entry.role), ['user', 'model', 'user']);
    assert.equal(seen.body.contents[0].parts[0].text, 'first');
  });

  it('Anthropic requires max_tokens, so it is always sent', async () => {
    await drain(anthropic);
    assert.equal(typeof seen.body.max_tokens, 'number');
    assert.ok(seen.body.max_tokens > 0);
  });

  it('OpenAI must opt in to usage or the counts never arrive', async () => {
    await drain(openai);
    assert.equal(seen.body.stream_options.include_usage, true);
  });

  it('Mistral is not sent stream_options, which its API does not document', async () => {
    await drain(mistral);
    assert.equal('stream_options' in seen.body, false);
  });

  it('OpenRouter is asked to report the cost', async () => {
    await drain(openrouter);
    assert.deepEqual(seen.body.usage, { include: true });
  });

  it('nobody else is sent OpenRouter\'s cost request', async () => {
    await drain(groq);
    assert.equal('usage' in seen.body, false);
  });

  it('Gemini asks for SSE explicitly, or the response is a JSON array', async () => {
    await drain(gemini);
    assert.match(seen.query, /alt=sse/);
  });
});

describe('when a provider says no', () => {
  it('turns a 401 into something a user can act on', async () => {
    const saved = process.env.OPENAI_BASE_URL;
    process.env.OPENAI_BASE_URL = `${saved}-401`;
    await assert.rejects(openai.listModels(KEY), /rejected the API key.*Incorrect API key provided/s);
    process.env.OPENAI_BASE_URL = saved;
  });

  it('names the provider when it cannot be reached at all', async () => {
    const saved = process.env.XAI_BASE_URL;
    process.env.XAI_BASE_URL = 'http://127.0.0.1:1';
    await assert.rejects(xai.listModels(KEY), /Cannot reach Grok \(xAI\)/);
    process.env.XAI_BASE_URL = saved;
  });
});

describe('cancelling mid-stream', () => {
  it('stops the request and reports an abort, not a failure', async () => {
    const saved = process.env.OPENAI_BASE_URL;
    process.env.OPENAI_BASE_URL = `${saved}-stall`;
    const controller = new AbortController();

    await assert.rejects(async () => {
      let chunks = 0;
      for await (const part of openai.chat({
        key: KEY,
        model: 'test-model',
        messages: [{ role: 'user', content: 'hi' }],
        system: null,
        signal: controller.signal,
      })) {
        if (part.text && ++chunks === 2) controller.abort();
      }
    }, (error) => error.name === 'AbortError');

    process.env.OPENAI_BASE_URL = saved;
  });
});
