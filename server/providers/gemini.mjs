/**
 * Google's Gemini API. The odd one out: the model id goes in the URL, the
 * conversation is `contents` with `parts` rather than `messages` with strings,
 * and the assistant's role is called "model".
 *
 *   POST /models/{model}:streamGenerateContent?alt=sse
 *   data: {"candidates":[{"content":{"parts":[{"text":"Hi"}]}}],"usageMetadata":{…}}
 */
import {
  describeNetworkError,
  describeResponseError,
  parseEvent,
  sortModels,
  sseEvents,
} from './shared.mjs';

const LABEL = 'Google Gemini';

// Listed models that answer generateContent but are not chat models.
const NOT_CHAT = /embedding|aqa|imagen|veo|tts|native-audio|live-/i;

const baseUrl = () =>
  (process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');

/** Our transcript shape into Gemini's: "assistant" is "model", text is a part. */
function toContents(messages) {
  return messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  }));
}

export const gemini = {
  id: 'gemini',
  label: LABEL,
  fallbackModels: ['gemini-2.5-flash', 'gemini-2.5-pro'],

  async listModels(key) {
    let response;
    try {
      response = await fetch(`${baseUrl()}/models?pageSize=200`, {
        headers: { 'x-goog-api-key': key },
      });
    } catch (error) {
      throw new Error(describeNetworkError(error, LABEL));
    }
    if (!response.ok) throw new Error(await describeResponseError(response, LABEL));

    const { models = [] } = await response.json();
    return sortModels(
      models
        // The listing says what each model can do, so ask it rather than guess.
        .filter((entry) => entry.supportedGenerationMethods?.includes('generateContent'))
        .map((entry) => entry.name?.replace(/^models\//, ''))
        .filter((name) => typeof name === 'string' && !NOT_CHAT.test(name)),
    );
  },

  async *chat({ key, model, messages, system, signal }) {
    const body = {
      contents: toContents(messages),
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    };

    let response;
    try {
      response = await fetch(`${baseUrl()}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new Error(describeNetworkError(error, LABEL));
    }
    if (!response.ok) throw new Error(await describeResponseError(response, LABEL));

    // Usage is repeated on every frame as a running total, so the last one wins.
    // A thinking model's reasoning is counted apart from the answer, in
    // thoughtsTokenCount, but billed as output all the same — so it is added
    // in, or Gemini would look cheaper than it is next to the others.
    let usage = null;

    for await (const payload of sseEvents(response.body)) {
      const event = parseEvent(payload);
      if (!event) continue;

      if (event.error) throw new Error(event.error.message ?? `${LABEL} failed mid-stream.`);

      // A candidate can be split across several parts within one frame.
      const text = (event.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('');
      if (text) yield { text };

      if (event.usageMetadata) {
        const thoughts = event.usageMetadata.thoughtsTokenCount ?? 0;
        usage = {
          promptTokens: event.usageMetadata.promptTokenCount ?? 0,
          completionTokens: (event.usageMetadata.candidatesTokenCount ?? 0) + thoughts,
          ...(thoughts > 0 ? { reasoningTokens: thoughts } : {}),
        };
      }
    }

    if (usage) yield { usage };
  },
};
