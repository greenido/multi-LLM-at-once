/**
 * Anthropic's Messages API. It differs from the OpenAI shape in three ways that
 * matter here: the system prompt is a top-level field rather than a message,
 * `max_tokens` is required, and the stream is a sequence of typed events rather
 * than deltas on one object.
 *
 *   event: message_start        → input token count
 *   event: content_block_delta  → {"delta":{"type":"thinking_delta","thinking":"…"}}
 *   event: content_block_delta  → {"delta":{"type":"text_delta","text":"Hi"}}
 *   event: message_delta        → output token count, and how much was thinking
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

// Thinking counts against max_tokens, so a model that may think gets this much
// room on top of the answer's. An older model is also given it as its budget.
const THINKING_TOKENS = 16_000;

/**
 * What asks a model to think and show it. Claude 4.6 and later decide for
 * themselves how much to think; 4.5 and earlier think to a fixed budget. A
 * summary of the thinking comes back by default up to 4.6, and from 4.7 on
 * only when it is asked for.
 */
const THINKING = {
  adaptive: { type: 'adaptive', display: 'summarized' },
  enabled: { type: 'enabled', budget_tokens: THINKING_TOKENS },
};

/** Which of those a model takes, as the listing reports it — or null if neither. */
function thinkingMode(entry) {
  const types = entry.capabilities?.thinking?.types;
  if (types?.adaptive?.supported) return 'adaptive';
  if (types?.enabled?.supported) return 'enabled';
  return null;
}

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
    // It also says how each one thinks, so that is asked rather than guessed.
    const { data = [] } = await response.json();
    const modes = new Map(
      data.filter((entry) => typeof entry.id === 'string').map((entry) => [entry.id, thinkingMode(entry)]),
    );
    return sortModels([...modes.keys()]).map((name) =>
      modes.get(name) ? { name, thinking: modes.get(name) } : { name },
    );
  },

  async *chat({ key, model, messages, system, think, thinking, signal }) {
    // Claude Opus 5, Sonnet 5 and Fable think unasked, silently, so every model
    // that thinks adaptively gets the room, not only one asked to show it.
    const asked = think ? THINKING[thinking] : undefined;
    const body = {
      model,
      messages,
      max_tokens: asked || thinking === 'adaptive' ? MAX_TOKENS + THINKING_TOKENS : MAX_TOKENS,
      stream: true,
      ...(system ? { system } : {}),
      ...(asked ? { thinking: asked } : {}),
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
    let reasoningTokens = 0;

    for await (const payload of sseEvents(response.body)) {
      const event = parseEvent(payload);
      if (!event) continue;

      switch (event.type) {
        case 'message_start':
          promptTokens = event.message?.usage?.input_tokens ?? 0;
          break;

        case 'content_block_delta':
          if (event.delta?.type === 'text_delta' && event.delta.text) {
            yield { text: event.delta.text };
          }
          // A summary of the model's reasoning, which is not part of the answer.
          if (event.delta?.type === 'thinking_delta' && event.delta.thinking) {
            yield { reasoning: event.delta.thinking };
          }
          break;

        case 'message_delta':
          // Thinking is billed as output, and counted in it.
          completionTokens = event.usage?.output_tokens ?? completionTokens;
          reasoningTokens = event.usage?.output_tokens_details?.thinking_tokens ?? reasoningTokens;
          break;

        case 'error':
          throw new Error(event.error?.message ?? `${LABEL} failed mid-stream.`);
      }
    }

    if (promptTokens || completionTokens) {
      yield {
        usage: { promptTokens, completionTokens, ...(reasoningTokens > 0 ? { reasoningTokens } : {}) },
      };
    }
  },
};
