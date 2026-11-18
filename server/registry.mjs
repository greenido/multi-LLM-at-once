/**
 * Every model the app can query, from every provider, under one list.
 *
 * A model id is namespaced as "provider:name" — "openai:gpt-4o",
 * "ollama:llama3:latest" — because two providers can name a model the same
 * thing, and because a request has to know who to send itself to. Ollama's own
 * names contain a colon, so the split takes the first one only.
 *
 * The list doubles as the allowlist for /query: a client cannot name a model
 * that is not actually available.
 */
import { anthropic } from './providers/anthropic.mjs';
import { gemini } from './providers/gemini.mjs';
import { ollama } from './providers/ollama.mjs';
import { deepseek, groq, mistral, openai, openrouter, xai } from './providers/openai.mjs';
import { getKey, keyStatus } from './keystore.mjs';
import { listPrice, priceCatalogue } from './prices.mjs';

export const PROVIDERS = [ollama, openai, anthropic, gemini, xai, openrouter, groq, mistral, deepseek];
const BY_ID = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

export const getProvider = (id) => BY_ID.get(id) ?? null;

/** Providers that take an API key, in the order the settings modal shows them. */
export const KEYED_PROVIDERS = PROVIDERS.filter((provider) => !provider.keyless);

export function parseModelId(id) {
  if (typeof id !== 'string') return null;
  const separator = id.indexOf(':');
  if (separator <= 0) return null;

  const provider = id.slice(0, separator);
  const name = id.slice(separator + 1);
  if (!name || !BY_ID.has(provider)) return null;
  return { provider, name };
}

export const modelId = (providerId, name) => `${providerId}:${name}`;

/**
 * A listing is a list of names, or of { name, … } where it says more about a
 * model: its price, or how it thinks. Held in the second shape either way.
 */
const toEntry = (model) => (typeof model === 'string' ? { name: model } : model);

//
// A model list costs a round trip, and the picker asks for one on every load.
// Ollama is cached briefly so a freshly pulled model turns up quickly; the
// cloud catalogues change far more slowly and their calls are metered.
//
// A listing that failed is kept only briefly: holding a network blip for five
// minutes would refuse every model missing from the fallback list long after
// the provider came back.
//
const TTL_MS = { ollama: 10_000 };
const DEFAULT_TTL_MS = 5 * 60_000;
export const ERROR_TTL_MS = 15_000;

// provider id -> { at, result } once a listing is in, or { pending } while it
// is being fetched — so four panels asking at once share one request.
const cache = new Map();

/** Called when a key changes — the old answer for that provider is now wrong. */
export function invalidate(providerId) {
  cache.delete(providerId);
}

function isFresh({ at, result }, provider) {
  const ttl = TTL_MS[provider.id] ?? DEFAULT_TTL_MS;
  return Date.now() - at < (result.error ? Math.min(ttl, ERROR_TTL_MS) : ttl);
}

async function fetchListing(provider) {
  const key = provider.keyless ? null : getKey(provider.id);

  // Not an error — just nothing to show until a key is set.
  if (!provider.keyless && !key) return { models: [], error: null, configured: false };

  try {
    return { models: (await provider.listModels(key)).map(toEntry), error: null, configured: true };
  } catch (error) {
    // A failed listing should not empty the picker. The curated fallback keeps
    // the provider usable, and the error rides along so the UI can say why the
    // list may be incomplete.
    return { models: provider.fallbackModels.map(toEntry), error: error.message, configured: true };
  }
}

function listProvider(provider) {
  const cached = cache.get(provider.id);
  if (cached?.pending) return cached.pending;
  if (cached && isFresh(cached, provider)) return Promise.resolve(cached.result);

  const pending = fetchListing(provider).then(
    (result) => {
      // Only if nothing replaced it meanwhile: a key saved mid-flight
      // invalidates this answer, and it must not land on top of the new one.
      if (cache.get(provider.id)?.pending === pending) cache.set(provider.id, { at: Date.now(), result });
      return result;
    },
    (error) => {
      if (cache.get(provider.id)?.pending === pending) cache.delete(provider.id);
      throw error;
    },
  );
  cache.set(provider.id, { pending });
  return pending;
}

/**
 * The whole catalogue, plus per-provider status. Providers are listed in
 * parallel: one slow or unreachable provider should not hold up the rest.
 */
export async function listAll() {
  const [results, prices] = await Promise.all([
    Promise.all(PROVIDERS.map(async (provider) => [provider, await listProvider(provider)])),
    priceCatalogue(),
  ]);

  const models = [];
  const providers = [];

  for (const [provider, result] of results) {
    for (const { name, pricing: listed } of result.models) {
      // A listing's own price wins; a model reached directly gets its list price.
      const pricing = listed ?? listPrice(provider.id, name, prices);
      models.push({ id: modelId(provider.id, name), provider: provider.id, name, ...(pricing ? { pricing } : {}) });
    }
    providers.push({
      id: provider.id,
      label: provider.label,
      keyless: Boolean(provider.keyless),
      configured: result.configured,
      count: result.models.length,
      error: result.error,
    });
  }

  return { models, providers };
}

/**
 * Can we send a request to this exact model id right now? If so, with what
 * the listing said about it, which is how an adapter knows whether a model
 * can be asked to think.
 *
 * A model missing from a list that loaded fine is a bad request. A model
 * missing because the list itself failed is a different thing entirely — we do
 * not know whether it exists — and the listing error is what the user needs to
 * see, not "not available".
 */
export async function checkAvailability(id) {
  const parsed = parseModelId(id);
  const provider = getProvider(parsed.provider);
  const { models, error } = await listProvider(provider);

  const model = models.find((entry) => entry.name === parsed.name);
  if (model) return { ok: true, model };
  if (error) return { ok: false, status: 503, error };
  return {
    ok: false,
    status: 400,
    error: `"${parsed.name}" is not available from ${provider.label}.`,
  };
}

/** What the settings modal renders. Contains masked hints, never a key. */
export function settingsStatus() {
  return KEYED_PROVIDERS.map((provider) => ({
    id: provider.id,
    label: provider.label,
    ...keyStatus(provider.id),
  }));
}
