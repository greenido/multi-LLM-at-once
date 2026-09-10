/**
 * OpenAI's chat completions API, and everyone who speaks it: Grok, Groq,
 * Mistral, DeepSeek and OpenRouter. They are built from one factory. What
 * differs is the base URL, the label, which listed models can hold a
 * conversation, and a few small departures from OpenAI's original, each noted
 * where the provider is defined.
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
 * OpenAI's GET /models returns the whole catalogue — embeddings, image, audio
 * and moderation models included — and asking one of those to hold a
 * conversation just fails. Names are the only signal that endpoint gives, so
 * the filter is a name filter: take the chat families, then drop the non-chat
 * variants built on top of them (gpt-4o-audio, gpt-4o-transcribe, and so on).
 */
const NOT_CHAT =
  /audio|realtime|transcribe|\btts\b|image|search-preview|instruct|moderation|embedding|dall-e|whisper|babbage|davinci|codex/i;

/** A chat model by name alone: in the family, and not a non-chat variant of it. */
const byName = (family) => (entry) => family.test(entry.id) && !NOT_CHAT.test(entry.id);

/**
 * Token counts, with reasoning counted as the output it is billed as.
 *
 * OpenAI counts a reasoning model's hidden tokens inside completion_tokens.
 * Grok counts them beside it — total = prompt + completion + reasoning — while
 * billing them the same way. The total says which convention a response
 * followed, so completionTokens always means everything the model wrote, and
 * reasoningTokens says how much of that was reasoning.
 *
 * Two providers add something worth keeping: Groq times its own decoding, in
 * seconds, and OpenRouter says what the answer actually cost.
 */
export function readUsage(usage) {
  const prompt = usage.prompt_tokens ?? 0;
  const completion = usage.completion_tokens ?? 0;
  const reasoning = usage.completion_tokens_details?.reasoning_tokens ?? 0;
  const countedBeside = reasoning > 0 && usage.total_tokens === prompt + completion + reasoning;

  return {
    promptTokens: prompt,
    completionTokens: countedBeside ? completion + reasoning : completion,
    ...(reasoning > 0 ? { reasoningTokens: reasoning } : {}),
    ...(usage.completion_time > 0 ? { evalMs: Math.round(usage.completion_time * 1000) } : {}),
    ...(typeof usage.cost === 'number' && usage.cost >= 0 ? { costUsd: usage.cost } : {}),
  };
}

/**
 * @param isChat       which entries of GET /models can hold a conversation
 * @param pricing      where a listing publishes prices: an entry's USD per
 *                     token as { prompt, completion }, or null
 * @param includeUsage whether to ask for token counts with stream_options
 * @param extraBody    anything else the provider wants on every request
 */
export function openAiCompatible({
  id,
  label,
  defaultBaseUrl,
  baseUrlEnv,
  isChat,
  pricing,
  includeUsage = true,
  extraBody = {},
  fallbackModels,
}) {
  const baseUrl = () => (process.env[baseUrlEnv] ?? defaultBaseUrl).replace(/\/$/, '');

  return {
    id,
    label,
    fallbackModels,

    /** Names — or, where the listing publishes prices, { name, pricing }. */
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
      const chat = data.filter((entry) => typeof entry?.id === 'string' && isChat(entry));
      if (!pricing) return sortModels(chat.map((entry) => entry.id));

      const prices = new Map(chat.map((entry) => [entry.id, pricing(entry)]));
      return sortModels([...prices.keys()]).map((name) =>
        prices.get(name) ? { name, pricing: prices.get(name) } : { name },
      );
    },

    async *chat({ key, model, messages, system, signal }) {
      // Unlike Anthropic, the system prompt is just a message with a role.
      const body = {
        model,
        messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
        stream: true,
        // Without this OpenAI's final frame carries no token counts.
        ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
        ...extraBody,
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

      // Token counts can arrive on more than one frame — Groq repeats them
      // under x_groq — so the last seen is kept and reported once, at the end.
      let usage = null;

      for await (const payload of sseEvents(response.body)) {
        if (payload === '[DONE]') break;

        const event = parseEvent(payload);
        if (!event) continue;

        // An error can also arrive mid-stream, after a 200.
        if (event.error) throw new Error(event.error.message ?? `${label} failed mid-stream.`);

        const text = event.choices?.[0]?.delta?.content;
        if (text) yield { text };

        const reported = event.usage ?? event.x_groq?.usage;
        if (reported) usage = readUsage(reported);
      }

      if (usage) yield { usage };
    },
  };
}

/** OpenRouter's prices are strings of USD per token; a negative one means it varies. */
function readPricing(entry) {
  const prompt = Number(entry.pricing?.prompt);
  const completion = Number(entry.pricing?.completion);
  return prompt >= 0 && completion >= 0 ? { prompt, completion } : null;
}

export const openai = openAiCompatible({
  id: 'openai',
  label: 'OpenAI',
  defaultBaseUrl: 'https://api.openai.com/v1',
  baseUrlEnv: 'OPENAI_BASE_URL',
  isChat: byName(/^(gpt-|o[134]-|o[134]$|chatgpt-)/i),
  fallbackModels: ['gpt-4o', 'gpt-4o-mini'],
});

export const xai = openAiCompatible({
  id: 'xai',
  label: 'Grok (xAI)',
  defaultBaseUrl: 'https://api.x.ai/v1',
  baseUrlEnv: 'XAI_BASE_URL',
  isChat: byName(/^grok-/i),
  fallbackModels: ['grok-3', 'grok-3-mini'],
});

/**
 * Groq serves open-weight models on its own chips, which makes it worth having
 * in a speed comparison. Its list mixes in speech models and Llama Guard, which
 * classifies messages rather than answering them. "instruct" is not a sign of
 * a non-chat model here the way it is at OpenAI — Llama 4 Scout is one.
 */
export const groq = openAiCompatible({
  id: 'groq',
  label: 'Groq',
  defaultBaseUrl: 'https://api.groq.com/openai/v1',
  baseUrlEnv: 'GROQ_BASE_URL',
  isChat: (entry) => entry.active !== false && !/whisper|\btts\b|guard/i.test(entry.id),
  fallbackModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
});

/**
 * Mistral's listing says what each model can do, so it is asked rather than
 * guessed. stream_options is not in its documented request body, and its API
 * is strict about fields it does not know, so it is left off — the last frame
 * carries the token counts regardless.
 */
export const mistral = openAiCompatible({
  id: 'mistral',
  label: 'Mistral',
  defaultBaseUrl: 'https://api.mistral.ai/v1',
  baseUrlEnv: 'MISTRAL_BASE_URL',
  isChat: (entry) => entry.capabilities?.completion_chat === true,
  includeUsage: false,
  fallbackModels: ['mistral-large-latest', 'mistral-small-latest'],
});

/** DeepSeek lists only its chat models. */
export const deepseek = openAiCompatible({
  id: 'deepseek',
  label: 'DeepSeek',
  defaultBaseUrl: 'https://api.deepseek.com',
  baseUrlEnv: 'DEEPSEEK_BASE_URL',
  isChat: () => true,
  fallbackModels: ['deepseek-chat', 'deepseek-reasoner'],
});

/**
 * OpenRouter resells hundreds of models from every lab behind one key. Its
 * listing publishes a price per token for each, so an answer's cost can be
 * worked out, and asked for, it also reports what an answer actually cost,
 * which beats the list price when a request was cached or routed elsewhere.
 * The list includes image generators; only models that write text are kept.
 */
export const openrouter = openAiCompatible({
  id: 'openrouter',
  label: 'OpenRouter',
  defaultBaseUrl: 'https://openrouter.ai/api/v1',
  baseUrlEnv: 'OPENROUTER_BASE_URL',
  isChat: (entry) => (entry.architecture?.output_modalities ?? ['text']).includes('text'),
  pricing: readPricing,
  extraBody: { usage: { include: true } },
  fallbackModels: ['openai/gpt-4o-mini', 'meta-llama/llama-3.3-70b-instruct'],
});
