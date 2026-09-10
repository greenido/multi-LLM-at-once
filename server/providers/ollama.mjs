/**
 * The local Ollama daemon, behind the same adapter interface as the cloud
 * providers so nothing above this layer has to special-case it.
 *
 * It is the one provider that needs no API key, and the one that can be absent
 * entirely — a user with only cloud keys never starts it.
 */
import { Ollama } from 'ollama';

const LABEL = 'Ollama';

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

export const ollama = {
  id: 'ollama',
  label: LABEL,
  // No credential to configure, so it never appears in the settings modal.
  keyless: true,
  fallbackModels: [],

  async listModels() {
    try {
      const { models = [] } = await new Ollama({ host: ollamaUrl() }).list();
      return models
        .map((entry) => entry.name)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    } catch (error) {
      throw new Error(describeOllamaError(error));
    }
  },

  async *chat({ model, messages, system, signal }) {
    // A client per request, so aborting this stream leaves other in-flight
    // requests alone. The client exposes abort() rather than taking a signal,
    // so the signal is bridged to it.
    const client = new Ollama({ host: ollamaUrl() });
    const onAbort = () => client.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const stream = await client.chat({
        model,
        messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
        stream: true,
      });

      for await (const part of stream) {
        if (part.message?.content) yield { text: part.message.content };
        if (part.done) {
          yield {
            usage: {
              promptTokens: part.prompt_eval_count ?? 0,
              completionTokens: part.eval_count ?? 0,
            },
          };
        }
      }
    } catch (error) {
      // An abort arrives here as an ordinary error, but the caller needs to be
      // able to tell a cancellation apart from a failure.
      if (signal?.aborted) {
        const aborted = new Error('The request was aborted.');
        aborted.name = 'AbortError';
        throw aborted;
      }
      throw new Error(describeOllamaError(error, model));
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  },
};
