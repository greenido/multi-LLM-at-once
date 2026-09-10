import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';

import { anthropic } from '../server/providers/anthropic.mjs';
import { gemini } from '../server/providers/gemini.mjs';
import { openai, xai } from '../server/providers/openai.mjs';

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
    // misbehaves, so a test can point a base URL at one.
    const dialect = segment.replace(/-(401|stall)$/, '');

    if (segment.endsWith('-401')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'Incorrect API key provided.' } }));
    }

    if (req.method === 'GET' && path.startsWith('/models')) {
      seen = { headers: req.headers };
      if (dialect === 'gemini') {
        return json(res, {
          models: [
            { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/gemini-2.5-flash-tts', supportedGenerationMethods: ['generateContent'] },
            { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
            { name: 'models/imagen-3.0', supportedGenerationMethods: ['predict'] },
          ],
        });
      }
      if (dialect === 'anthropic') {
        return json(res, { data: [{ id: 'claude-sonnet-4-5' }, { id: 'claude-haiku-4-5' }] });
      }
      if (dialect === 'xai') {
        return json(res, { data: [{ id: 'grok-3' }, { id: 'grok-3-mini' }, { id: 'grok-2-image' }] });
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
      return res.end(sse([
        `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 111 } } })}`,
        // The model's scratchpad, which must not reach the user.
        `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'SCRATCHPAD' } })}`,
        `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } })}`,
        `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'there' } })}`,
        `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 222 } })}`,
        `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}`,
      ]));
    }

    if (dialect === 'gemini') {
      return res.end(sse([
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hello ' }, { text: 'there' }] } }] })}`,
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '' }] } }], usageMetadata: { promptTokenCount: 111, candidatesTokenCount: 222 } })}`,
      ]));
    }

    return res.end(sse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello ' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'there' } }] })}`,
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 111, completion_tokens: 222 } })}`,
      'data: [DONE]',
    ]));
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.OPENAI_BASE_URL = `${base}/openai`;
  process.env.ANTHROPIC_BASE_URL = `${base}/anthropic`;
  process.env.GEMINI_BASE_URL = `${base}/gemini`;
  process.env.XAI_BASE_URL = `${base}/xai`;
});

after(() => server?.close());

/** Drain an adapter's stream into the text and usage it produced. */
async function drain(provider, options = {}) {
  let text = '';
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
    if (part.usage) usage = part.usage;
  }
  return { text, usage };
}

describe('listing models', () => {
  it('OpenAI keeps chat models and drops audio, image, embedding and instruct ones', async () => {
    assert.deepEqual(await openai.listModels(KEY), [
      'chatgpt-4o-latest', 'gpt-4o', 'gpt-4o-mini', 'o3-mini',
    ]);
  });

  it('Gemini asks the listing what each model can do, rather than guessing', async () => {
    assert.deepEqual(await gemini.listModels(KEY), ['gemini-2.5-flash', 'gemini-2.5-pro']);
  });

  it('Grok drops the image model', async () => {
    assert.deepEqual(await xai.listModels(KEY), ['grok-3', 'grok-3-mini']);
  });

  it('Anthropic keeps everything, since that endpoint lists only chat models', async () => {
    assert.deepEqual(await anthropic.listModels(KEY), ['claude-haiku-4-5', 'claude-sonnet-4-5']);
  });
});

describe('authenticating', () => {
  it('OpenAI and Grok use a bearer token', async () => {
    await openai.listModels(KEY);
    assert.equal(seen.headers.authorization, `Bearer ${KEY}`);
    await xai.listModels(KEY);
    assert.equal(seen.headers.authorization, `Bearer ${KEY}`);
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
  for (const [name, provider] of [['OpenAI', openai], ['Grok', xai], ['Anthropic', anthropic], ['Gemini', gemini]]) {
    it(`${name} yields the text and the token counts`, async () => {
      const { text, usage } = await drain(provider);
      assert.equal(text, 'Hello there');
      assert.deepEqual(usage, { promptTokens: 111, completionTokens: 222 });
    });
  }

  it('Anthropic does not leak a thinking block into the answer', async () => {
    const { text } = await drain(anthropic);
    assert.ok(!text.includes('SCRATCHPAD'));
  });

  it('Gemini joins several parts within one frame', async () => {
    const { text } = await drain(gemini);
    assert.equal(text, 'Hello there');
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
