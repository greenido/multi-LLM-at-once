/**
 * A stand-in for the app's own API, installed as the global fetch. It answers
 * /query in the server's real NDJSON format, records every call, and can hold
 * a model's stream open so a test can act while an answer is still arriving.
 */
import { vi } from 'vitest';

export const MODELS = [
  { id: 'ollama:llama3:latest', provider: 'ollama', name: 'llama3:latest' },
  { id: 'openai:gpt-4o', provider: 'openai', name: 'gpt-4o' },
  { id: 'anthropic:claude-sonnet-4', provider: 'anthropic', name: 'claude-sonnet-4' },
];

const PROVIDERS = [
  { id: 'ollama', label: 'Ollama', keyless: true, configured: true, count: 1, error: null },
  { id: 'openai', label: 'OpenAI', keyless: false, configured: true, count: 1, error: null },
  { id: 'anthropic', label: 'Anthropic', keyless: false, configured: true, count: 1, error: null },
];

/** A model's canned answer. Names the provider only, so a check that a model's name never reaches the judge means something. */
export const answerFor = (model) => `Answer from ${model.split(':')[0]}`;

const encoder = new TextEncoder();
const line = (event) => encoder.encode(`${JSON.stringify(event)}\n`);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function fakeApi({ models = MODELS, comparisons = [] } = {}) {
  const calls = [];
  const saved = new Map(comparisons.map((comparison) => [comparison.id, comparison]));
  // Models whose next stream stays open until the test writes to it.
  const holding = new Set();
  // model id -> the open stream's controller.
  const open = new Map();
  // model id -> an error message its next request fails with.
  const failing = new Map();

  function queryResponse(body, signal) {
    const { model } = body;
    if (failing.has(model)) {
      const error = failing.get(model);
      failing.delete(model);
      return json({ error }, 502);
    }

    const stream = new ReadableStream({
      start(controller) {
        signal?.addEventListener('abort', () => {
          try {
            controller.error(new DOMException('The request was aborted.', 'AbortError'));
          } catch {
            // Already closed.
          }
        });
        if (holding.delete(model)) {
          open.set(model, controller);
          return;
        }
        controller.enqueue(line({ type: 'chunk', text: answerFor(model) }));
        controller.enqueue(line({ type: 'usage', promptTokens: 10, completionTokens: 5 }));
        controller.enqueue(line({ type: 'done' }));
        controller.close();
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } });
  }

  const fetch = vi.fn(async (url, options = {}) => {
    const method = options.method ?? 'GET';
    const body = options.body ? JSON.parse(options.body) : undefined;
    const path = String(url);
    calls.push({ path, method, body });

    if (path === '/api/models') return json({ models, providers: PROVIDERS });
    if (path === '/api/settings') return json({ providers: [] });
    if (path === '/api/prompts') return json({ prompts: [] });
    if (path.startsWith('/api/comparisons')) {
      const id = path.split('/')[3]?.split('?')[0];
      if (!id) {
        return json({ comparisons: [...saved.values()].map(({ transcripts: _t, ...summary }) => summary) });
      }
      if (method === 'PUT') {
        saved.set(id, { ...body, id });
        return json({ comparison: { id } });
      }
      if (method === 'DELETE') return json({ deleted: saved.delete(id) });
      return saved.has(id) ? json({ comparison: saved.get(id) }) : json({ error: 'No such comparison' }, 404);
    }
    if (path === '/query') return queryResponse(body, options.signal);
    return json({ error: `Unhandled ${method} ${path}` }, 404);
  });

  vi.stubGlobal('fetch', fetch);

  return {
    calls,
    saved,
    queries: () => calls.filter((call) => call.path === '/query'),
    saves: () => calls.filter((call) => call.path.startsWith('/api/comparisons/') && call.method === 'PUT'),
    /** Keep this model's next answer open; write to it with `write`. */
    hold: (model) => holding.add(model),
    isOpen: (model) => open.has(model),
    write: (model, event) => open.get(model).enqueue(line(event)),
    finish: (model) => {
      const controller = open.get(model);
      controller.enqueue(line({ type: 'done' }));
      controller.close();
      open.delete(model);
    },
    failNext: (model, message) => failing.set(model, message),
  };
}
