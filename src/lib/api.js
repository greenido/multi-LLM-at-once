/**
 * JSON over fetch, for the app's own API. A non-2xx response throws with the
 * server's error message, which is written to be shown to a user as it is.
 */
export async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed with HTTP ${response.status}`);
  }
  return data;
}

export const asJson = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
