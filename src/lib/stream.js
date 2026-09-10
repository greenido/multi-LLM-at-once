/**
 * Reads the newline-delimited JSON stream that POST /query returns, calling
 * onChunk for each piece of text as it arrives and onUsage with the token
 * counts the provider reported.
 *
 * Throws on a non-2xx response, on an in-band {"type":"error"} event, and
 * rethrows the AbortError when `signal` is aborted so the caller can tell a
 * cancellation apart from a failure.
 */
export async function streamQuery({ model, messages, system, signal, onChunk, onUsage }) {
  const response = await fetch('/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, system }),
    signal,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Request failed with HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error('This browser cannot read a streamed response.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      // A partial or malformed frame is not worth killing the stream over.
      console.warn('Skipping unparseable stream frame:', trimmed);
      return;
    }

    if (event.type === 'chunk' && event.text) onChunk(event.text);
    if (event.type === 'usage') {
      onUsage?.({
        promptTokens: event.promptTokens ?? 0,
        completionTokens: event.completionTokens ?? 0,
      });
    }
    if (event.type === 'error') throw new Error(event.error);
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        handleLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    }
    // Whatever is left when the stream closes without a trailing newline.
    handleLine(buffer);
  } finally {
    reader.cancel().catch(() => {});
  }
}
