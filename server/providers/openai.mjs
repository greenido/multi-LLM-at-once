/**
 * OpenAI's chat completions API, and xAI's Grok, which is a clone of it. Both
 * are built from the same factory: only the base URL, the label and which model
 * ids count as chat models differ.
 *
 * Streaming frames look like
 *   data: {"choices":[{"delta":{"content":"Hi"}}]}
 *   data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":4}}
 *   data: [DONE]
 */
import {
  describeNetworkError,
  describeResponseError,
  parseEvent,
  sortModels,
  sseEvents,
} from './shared.mjs';

/**
 * GET /models returns the whole catalogue — embeddings, image, audio and
 * moderation models included — and asking one of those to hold a conversation
 * just fails. Names are the only signal the endpoint gives, so the filter is a
 * name filter: take the chat families, then drop the non-chat variants built on
 * top of them (gpt-4o-audio, gpt-4o-transcribe, and so on).
 */
const NOT_CHAT =
  /audio|realtime|transcribe|\btts\b|image|search-preview|instruct|moderation|embedding|dall-e|whisper|babbage|davinci|codex/i;

export function openAiCompatible({ id, label, defaultBaseUrl, baseUrlEnv, chatFamily, fallbackModels }) {
  const baseUrl = () => (process.env[baseUrlEnv] ?? defaultBaseUrl).replace(/\/$/, '');

  return {
    id,
    label,
    fallbackModels,

    async listModels(key) {
      let response;
      try {
        response = await fetch(`${baseUrl()}/models`, {
          headers: { Authorization: `Bearer ${key}` },
        });
      } catch (error) {
        throw new Error(describeNetworkError(error, label));
      }
      if (!response.ok) throw new Error(await describeResponseError(response, label));

      const { data = [] } = await response.json();
      return sortModels(
        data
          .map((entry) => entry.id)
          .filter((name) => typeof name === 'string' && chatFamily.test(name) && !NOT_CHAT.test(name)),
      );
    },

    async *chat({ key, model, messages, system, signal }) {
      // Unlike Anthropic, the system prompt is just a message with a role.
      const body = {
        model,
        messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
        stream: true,
        // Without this the final frame carries no token counts.
        stream_options: { include_usage: true },
      };

      let response;
      try {
        response = await fetch(`${baseUrl()}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        throw new Error(describeNetworkError(error, label));
      }
      if (!response.ok) throw new Error(await describeResponseError(response, label));

      for await (const payload of sseEvents(response.body)) {
        if (payload === '[DONE]') break;

        const event = parseEvent(payload);
        if (!event) continue;

        // An error can also arrive mid-stream, after a 200.
        if (event.error) throw new Error(event.error.message ?? `${label} failed mid-stream.`);

        const text = event.choices?.[0]?.delta?.content;
        if (text) yield { text };

        if (event.usage) {
          yield {
            usage: {
              promptTokens: event.usage.prompt_tokens ?? 0,
              completionTokens: event.usage.completion_tokens ?? 0,
            },
          };
        }
      }
    },
  };
}

export const openai = openAiCompatible({
  id: 'openai',
  label: 'OpenAI',
  defaultBaseUrl: 'https://api.openai.com/v1',
  baseUrlEnv: 'OPENAI_BASE_URL',
  chatFamily: /^(gpt-|o[134]-|o[134]$|chatgpt-)/i,
  fallbackModels: ['gpt-4o', 'gpt-4o-mini'],
});

export const xai = openAiCompatible({
  id: 'xai',
  label: 'Grok (xAI)',
  defaultBaseUrl: 'https://api.x.ai/v1',
  baseUrlEnv: 'XAI_BASE_URL',
  chatFamily: /^grok-/i,
  fallbackModels: ['grok-3', 'grok-3-mini'],
});
