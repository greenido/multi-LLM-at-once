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
