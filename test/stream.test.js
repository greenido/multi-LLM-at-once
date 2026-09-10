import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { streamQuery } from '../src/lib/stream.js';

const encoder = new TextEncoder();

/** A Response whose body emits exactly the given byte slices, in order. */
function streamed(slices, { status = 200 } = {}) {
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const slice of slices) controller.enqueue(encoder.encode(slice));
        controller.close();
      },
    }),
    { status, headers: { 'Content-Type': 'application/x-ndjson' } },
  );
}

const frames = (...events) => events.map((e) => `${JSON.stringify(e)}\n`).join('');

function stubFetch(response) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return typeof response === 'function' ? response() : response;
  };
  return calls;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function collect(response) {
  const chunks = [];
  const calls = stubFetch(response);
  await streamQuery({
    model: 'llama3:latest',
    messages: [{ role: 'user', content: 'hi' }],
    system: 'be terse',
    onChunk: (text) => chunks.push(text),
  });
  return { chunks, calls };
}

describe('streamQuery', () => {
  it('sends the model, messages and system prompt to /query', async () => {
    const { calls } = await collect(() =>
      streamed([frames({ type: 'chunk', text: 'hi' }, { type: 'done' })]),
    );
    assert.equal(calls[0].url, '/query');
    assert.deepEqual(calls[0].body, {
      model: 'llama3:latest',
      messages: [{ role: 'user', content: 'hi' }],
      system: 'be terse',
    });
  });

  it('emits each chunk in order', async () => {
    const { chunks } = await collect(() =>
      streamed([frames({ type: 'chunk', text: 'one ' }, { type: 'chunk', text: 'two' }, { type: 'done' })]),
    );
    assert.deepEqual(chunks, ['one ', 'two']);
  });

  it('reassembles a frame split across reads', async () => {
    // The classic streaming bug: a JSON object arriving in two TCP reads.
    const whole = frames({ type: 'chunk', text: 'split me' }, { type: 'done' });
    const cut = Math.floor(whole.length / 3);
    const { chunks } = await collect(() => streamed([whole.slice(0, cut), whole.slice(cut)]));
    assert.deepEqual(chunks, ['split me']);
  });

  it('handles several frames arriving in one read', async () => {
    const { chunks } = await collect(() =>
      streamed([frames({ type: 'chunk', text: 'a' }, { type: 'chunk', text: 'b' }, { type: 'chunk', text: 'c' }, { type: 'done' })]),
    );
    assert.deepEqual(chunks, ['a', 'b', 'c']);
  });

  it('reads a final frame with no trailing newline', async () => {
    const { chunks } = await collect(() =>
      streamed([`${JSON.stringify({ type: 'chunk', text: 'no newline' })}`]),
    );
    assert.deepEqual(chunks, ['no newline']);
  });

  it('does not split multi-byte characters across reads', async () => {
    const whole = encoder.encode(frames({ type: 'chunk', text: 'café 🦙' }, { type: 'done' }));
    // Cut mid-emoji, which a naive per-read decode would corrupt.
    const at = whole.indexOf(0xf0);
    const decoder = new TextDecoder();
    const chunks = [];
    stubFetch(() =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(whole.slice(0, at + 2));
            controller.enqueue(whole.slice(at + 2));
            controller.close();
          },
        }),
        { status: 200 },
      ),
    );
    await streamQuery({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
      onChunk: (text) => chunks.push(text),
    });
    assert.deepEqual(chunks, ['café 🦙']);
    assert.ok(!decoder.decode(whole).includes('�'));
  });

  it('throws the server error on a non-2xx response', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: 'not installed' }), { status: 400 }));
    await assert.rejects(
      streamQuery({ model: 'm', messages: [{ role: 'user', content: 'x' }], onChunk: () => {} }),
      /not installed/,
    );
  });

  it('throws on an in-band error frame, keeping the chunks that arrived first', async () => {
    const chunks = [];
    stubFetch(() =>
      streamed([frames({ type: 'chunk', text: 'partial' }, { type: 'error', error: 'daemon died' })]),
    );
    await assert.rejects(
      streamQuery({ model: 'm', messages: [{ role: 'user', content: 'x' }], onChunk: (t) => chunks.push(t) }),
      /daemon died/,
    );
    assert.deepEqual(chunks, ['partial']);
  });

  it('skips an unparseable frame rather than aborting the stream', async () => {
    const { chunks } = await collect(() =>
      streamed([`{not json\n${frames({ type: 'chunk', text: 'survived' }, { type: 'done' })}`]),
    );
    assert.deepEqual(chunks, ['survived']);
  });

  it('rethrows AbortError so a cancel is distinguishable from a failure', async () => {
    const controller = new AbortController();
    globalThis.fetch = async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    };
    controller.abort();
    await assert.rejects(
      streamQuery({
        model: 'm',
        messages: [{ role: 'user', content: 'x' }],
        signal: controller.signal,
        onChunk: () => {},
      }),
      (error) => error.name === 'AbortError',
    );
  });
});
