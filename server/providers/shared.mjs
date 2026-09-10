/**
 * Pieces every cloud adapter needs: reading a Server-Sent Events body, and
 * turning a failed provider response into a message worth showing a user.
 *
 * The adapters speak the providers' REST APIs over `fetch` rather than through
 * four vendor SDKs. The wire formats are small, it keeps the dependency count
 * at zero, and a base URL that can be pointed elsewhere makes them testable.
 */

/**
 * Yields the `data:` payload of each SSE event.
 *
 * Events are framed on a blank line and a payload may span several `data:`
 * lines, which the spec says to join with newlines. Every provider here happens
 * to send single-line JSON, but decoding what SSE actually specifies costs a
 * few lines and removes the question.
 */
export async function* sseEvents(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let data = [];

  const readLine = (line) => {
    // A blank line ends the event; anything collected is now one payload.
    if (line === '') {
      if (data.length === 0) return null;
      const payload = data.join('\n');
      data = [];
      return payload;
    }
    // ":" alone is a keep-alive comment; id/event/retry do not carry content.
    if (line.startsWith('data:')) {
      data.push(line.slice(5).replace(/^ /, ''));
    }
    return null;
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        // Trailing \r for servers that send CRLF.
        const payload = readLine(buffer.slice(0, newline).replace(/\r$/, ''));
        if (payload !== null) yield payload;
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    }
    // A stream that ends without its final blank line still has an event in it.
    const payload = readLine(buffer.replace(/\r$/, '')) ?? (data.length ? data.join('\n') : null);
    if (payload !== null) yield payload;
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** Parse a payload, returning null rather than throwing on a partial frame. */
export function parseEvent(payload) {
  try {
    return JSON.parse(payload);
  } catch {
    console.warn('Skipping unparseable provider frame:', payload.slice(0, 120));
    return null;
  }
}

/**
 * All four providers report failures as {"error": {"message": "..."}}, so one
 * reader covers them. Falls back to the status line when the body is not JSON,
 * which is what a gateway or a proxy in the way tends to return.
 */
export async function describeResponseError(response, label) {
  const body = await response.text().catch(() => '');
  let message = '';
  try {
    message = JSON.parse(body)?.error?.message ?? '';
  } catch {
    message = body.slice(0, 200);
  }

  if (response.status === 401 || response.status === 403) {
    return `${label} rejected the API key${message ? `: ${message}` : '.'}`;
  }
  if (response.status === 429) {
    return `${label} rate limit reached${message ? `: ${message}` : '.'}`;
  }
  return message || `${label} returned HTTP ${response.status}.`;
}

/** Network-level failures say nothing useful on their own. */
export function describeNetworkError(error, label) {
  const message = error?.message ?? String(error);
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(message)) {
    return `Cannot reach ${label}. Check the network connection.`;
  }
  return message;
}

/** Trim a provider's model list to the ones a chat request can actually use. */
export function sortModels(names) {
  return [...new Set(names)].filter(Boolean).sort((a, b) => a.localeCompare(b));
}

const OPEN = '<think>';
const CLOSE = '</think>';

/** How many characters at the end of `text` could be the start of `tag`. */
function partialTag(text, tag) {
  for (let length = Math.min(tag.length - 1, text.length); length > 0; length -= 1) {
    if (tag.startsWith(text.slice(-length))) return length;
  }
  return 0;
}

/**
 * Some models write their reasoning into the answer itself, between <think>
 * tags at the very start — Qwen on Groq does by default, and so does a model
 * whose template does not set it apart. This splits it back out.
 *
 * Returns a function that takes each chunk of streamed text and returns the
 * parts in it, { reasoning } or { text }. A tag can arrive in pieces, so text
 * that could still turn out to be one is held back until the next chunk
 * settles it; call the function with no chunk at the end for anything held.
 */
export function thinkTags() {
  let state = 'start';
  let held = '';

  return (chunk) => {
    const done = chunk === undefined;
    held += chunk ?? '';
    const parts = [];

    if (state === 'start') {
      const leading = held.trimStart();
      if (leading.startsWith(OPEN)) {
        state = 'thinking';
        held = leading.slice(OPEN.length);
      } else if (!done && OPEN.startsWith(leading)) {
        return parts;
      } else {
        state = 'answer';
      }
    }

    if (state === 'thinking') {
      const end = held.indexOf(CLOSE);
      if (end === -1) {
        const reasoning = held.slice(0, held.length - (done ? 0 : partialTag(held, CLOSE)));
        // Whitespace waits for something visible, so an empty block shows nothing.
        if (reasoning.trim()) {
          parts.push({ reasoning });
          held = held.slice(reasoning.length);
        }
        return parts;
      }
      const reasoning = held.slice(0, end);
      if (reasoning.trim()) parts.push({ reasoning });
      held = held.slice(end + CLOSE.length).trimStart();
      state = 'answer';
    }

    if (held) parts.push({ text: held });
    held = '';
    return parts;
  };
}
