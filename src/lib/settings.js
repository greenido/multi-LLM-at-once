/**
 * The settings API. Keys live on the server and are written here but never read
 * back: a provider comes back as { configured, hint, source }, where hint is a
 * masked fragment like "sk-…4f2a" and source says whether the key came from the
 * database or from the server's environment.
 */
import { asJson, request } from './api.js';

export async function fetchSettings() {
  const { providers = [] } = await request('/api/settings');
  return providers;
}

export async function saveKey(provider, apiKey) {
  const { provider: updated } = await request(`/api/settings/${provider}`, asJson('PUT', { apiKey }));
  return updated;
}

export async function clearKey(provider) {
  const { provider: updated } = await request(`/api/settings/${provider}`, { method: 'DELETE' });
  return updated;
}

/**
 * Ask the provider whether a key works, by listing its models. Resolves to
 * { ok, count } or { ok: false, error } — a rejected key is an answer, not a
 * failure, so it does not throw.
 */
export function testKey(provider, apiKey) {
  return request(`/api/settings/${provider}/test`, asJson('POST', { apiKey }));
}
