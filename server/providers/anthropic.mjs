/**
 * Anthropic's Messages API. It differs from the OpenAI shape in three ways that
 * matter here: the system prompt is a top-level field rather than a message,
 * `max_tokens` is required, and the stream is a sequence of typed events rather
 * than deltas on one object.
 *
 *   event: message_start        → input token count
 *   event: content_block_delta  → {"delta":{"type":"text_delta","text":"Hi"}}
 *   event: message_delta        → output token count
 */
import {
  describeNetworkError,
  describeResponseError,
  parseEvent,
  sortModels,
  sseEvents,
} from './shared.mjs';

const LABEL = 'Anthropic';
const API_VERSION = '2023-06-01';

// Required by the API. Large enough not to truncate a normal answer, and every
// current model accepts it.
const MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS ?? 4096);

const baseUrl = () => (process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com/v1').replace(/\/$/, '');

const headers = (key) => ({
  'x-api-key': key,
  'anthropic-version': API_VERSION,
  'Content-Type': 'application/json',
});

export const anthropic = {
  id: 'anthropic',
  label: LABEL,
  fallbackModels: ['claude-sonnet-4-5', 'claude-haiku-4-5'],

  async listModels(key) {
    let response;
    try {
      response = await fetch(`${baseUrl()}/models?limit=100`, { headers: headers(key) });
    } catch (error) {
      throw new Error(describeNetworkError(error, LABEL));
    }
    if (!response.ok) throw new Error(await describeResponseError(response, LABEL));

    // This endpoint lists only conversational models, so nothing to filter out.
    const { data = [] } = await response.json();
    return sortModels(data.map((entry) => entry.id).filter((id) => typeof id === 'string'));
  },

  async *chat({ key, model, messages, system, signal }) {
    const body = {
      model,
      messages,
      max_tokens: MAX_TOKENS,
      stream: true,
      ...(system ? { system } : {}),
    };

    let response;
    try {
      response = await fetch(`${baseUrl()}/messages`, {
        method: 'POST',
        headers: headers(key),
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new Error(describeNetworkError(error, LABEL));
    }
    if (!response.ok) throw new Error(await describeResponseError(response, LABEL));

    // Input tokens arrive at the start and output tokens at the end, so they
    // are held here and reported together once the stream closes.
    let promptTokens = 0;
    let completionTokens = 0;

    for await (const payload of sseEvents(response.body)) {
      const event = parseEvent(payload);
      if (!event) continue;

      switch (event.type) {
        case 'message_start':
          promptTokens = event.message?.usage?.input_tokens ?? 0;
          break;

        case 'content_block_delta':
          // Only text. A thinking_delta is the model's scratchpad, not an answer.
          if (event.delta?.type === 'text_delta' && event.delta.text) {
            yield { text: event.delta.text };
          }
          break;

        case 'message_delta':
          completionTokens = event.usage?.output_tokens ?? completionTokens;
          break;

        case 'error':
          throw new Error(event.error?.message ?? `${LABEL} failed mid-stream.`);
      }
    }

    if (promptTokens || completionTokens) yield { usage: { promptTokens, completionTokens } };
  },
};
