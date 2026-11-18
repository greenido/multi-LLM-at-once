/**
 * The local Ollama daemon, behind the same adapter interface as the cloud
 * providers so nothing above this layer has to special-case it.
 *
 * It is the one provider that needs no API key, and the one that can be absent
 * entirely — a user with only cloud keys never starts it.
 *
 * Plain fetch, like every other adapter: the three routes used here are small,
 * and the answer streams as newline-delimited JSON.
 */
import { stoppedEarly, thinkTags } from './shared.mjs';

const LABEL = 'Ollama';

/** Why an answer ended: "length" is num_predict, or the context filling up. */
const DONE = { normal: ['stop', 'load', 'unload'], limit: ['length'] };

export const ollamaUrl = () => process.env.OLLAMA_URL ?? 'http://localhost:11434';

/**
 * Ollama's raw errors are unhelpful: an unreachable daemon surfaces only as
 * "fetch failed", which tells a user nothing about what to do next.
 */
export function describeOllamaError(error, model) {
  const message = error?.message ?? String(error);
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|socket hang up/i.test(message)) {
    return `Cannot reach Ollama at ${ollamaUrl()} — is \`ollama serve\` running?`;
  }
  if (model && /not found|no such model|try pulling/i.test(message)) {
    return `Ollama does not have "${model}" pulled. Run: ollama pull ${model}`;
  }
  return message;
}

/** POST a JSON body to Ollama; a non-2xx answer throws with Ollama's own message. */
async function post(path, body, signal) {
  const response = await fetch(`${ollamaUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let message;
    try {
      message = JSON.parse(text).error;
    } catch {
      message = text.slice(0, 200);
    }
    throw new Error(message || `Ollama returned HTTP ${response.status}.`);
  }
  return response;
}

/** Each line of a newline-delimited JSON body, parsed. */
async function* ndjson(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const parse = (line) => (line.trim() ? JSON.parse(line) : null);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const part = parse(buffer.slice(0, newline));
        if (part) yield part;
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    }
    const part = parse(buffer);
    if (part) yield part;
  } finally {
    reader.cancel().catch(() => {});
  }
}

//
// What a model can do — whether it can be asked to think — is fixed for a given
// pull, so it is asked for once rather than before every question. The cache
// is keyed by the digest the listing reported, which changes when the model is
// pulled again under the same name.
//
const digests = new Map();
const capabilities = new Map();

function capabilitiesOf(model) {
  const key = `${model}@${digests.get(model) ?? ''}`;
  if (!capabilities.has(key)) {
    const asked = post('/api/show', { model }).then(
      async (response) => (await response.json()).capabilities ?? [],
      (error) => {
        // A failure is not an answer: the next question asks again.
        capabilities.delete(key);
        throw error;
      },
    );
    capabilities.set(key, asked);
  }
  return capabilities.get(key);
}

const nanosToMs = (field, nanos) => (nanos > 0 ? { [field]: Math.round(nanos / 1e6) } : {});

export const ollama = {
  id: 'ollama',
  label: LABEL,
  // No credential to configure, so it never appears in the settings modal.
  keyless: true,
  fallbackModels: [],

  async listModels() {
    try {
      const response = await fetch(`${ollamaUrl()}/api/tags`);
      if (!response.ok) throw new Error(`Ollama returned HTTP ${response.status}.`);
      const { models = [] } = await response.json();
      for (const { name, digest } of models) if (name) digests.set(name, digest);
      return models
        .map((entry) => entry.name)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    } catch (error) {
      throw new Error(describeOllamaError(error), { cause: error });
    }
  },

  async *chat({ model, messages, system, think, signal }) {
    try {
      // A thinking model thinks by default, and its reasoning arrives apart
      // from the answer. Asked to, though, a model that cannot think fails the
      // request outright, so only one whose capabilities say it can is asked.
      const canThink = think && (await capabilitiesOf(model)).includes('thinking');

      const response = await post(
        '/api/chat',
        {
          model,
          messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
          stream: true,
          ...(canThink ? { think: true } : {}),
        },
        signal,
      );

      // A model whose template does not set its reasoning apart writes it into
      // the answer, in <think> tags.
      const split = thinkTags();

      for await (const part of ndjson(response.body)) {
        // A failure after the stream began arrives as a line of its own.
        if (part.error) throw new Error(part.error);
        if (part.message?.thinking) yield { reasoning: part.message.thinking };
        if (part.message?.content) yield* split(part.message.content);
        if (part.done) {
          yield* split();
          yield {
            usage: {
              promptTokens: part.prompt_eval_count ?? 0,
              completionTokens: part.eval_count ?? 0,
              // Ollama times itself, in nanoseconds. Decode time gives an exact
              // speed, and load time separates a cold start — the weights coming
              // off disk — from the model actually being slow.
              ...nanosToMs('loadMs', part.load_duration),
              ...nanosToMs('evalMs', part.eval_duration),
            },
          };
          const truncated = stoppedEarly(part.done_reason, DONE);
          if (truncated) yield { truncated };
        }
      }
    } catch (error) {
      // However the abort surfaced, the caller needs to be able to tell a
      // cancellation apart from a failure.
      if (signal?.aborted) {
        const aborted = new Error('The request was aborted.');
        aborted.name = 'AbortError';
        throw aborted;
      }
      throw new Error(describeOllamaError(error, model), { cause: error });
    }
  },
};
