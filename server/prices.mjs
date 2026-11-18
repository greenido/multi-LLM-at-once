/**
 * List prices for the models reached directly — OpenAI, Anthropic, Gemini,
 * Grok, Mistral, DeepSeek — none of whose model listings say what a model
 * costs.
 *
 * OpenRouter's public catalogue does, for every lab's models, at what the lab
 * charges. So it is read here — no key, nothing about the user sent — once a
 * day, and a direct model is matched to its entry there. The match is kept
 * deliberately narrow, and a price found this way is marked as an estimate:
 * it is a list price, not what the provider billed for the answer.
 *
 * PRICES_URL points it elsewhere, and an empty PRICES_URL turns it off.
 */
import { readPricing } from './providers/openai.mjs';

const DEFAULT_URL = 'https://openrouter.ai/api/v1/models';
const TTL_MS = 24 * 60 * 60_000;
// A catalogue that could not be read is tried again sooner than a day later.
const FAILURE_TTL_MS = 10 * 60_000;
// The model picker waits for this, so it gives up rather than hold it.
const TIMEOUT_MS = 5_000;

// Our provider id -> the vendor prefix the catalogue files its models under.
// Groq and Ollama are absent on purpose: Groq sets its own prices for the
// open models it hosts, and a local model costs nothing per token.
const VENDOR = {
  openai: 'openai',
  anthropic: 'anthropic',
  gemini: 'google',
  xai: 'x-ai',
  mistral: 'mistralai',
  deepseek: 'deepseek',
};

const pricesUrl = () => process.env.PRICES_URL ?? DEFAULT_URL;

let cached = null; // { at, ttl, prices }
let pending = null;

async function load(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { data = [] } = await response.json();
    const prices = new Map();
    for (const entry of data) {
      const price = typeof entry?.id === 'string' ? readPricing(entry) : null;
      if (price) prices.set(entry.id, price);
    }
    cached = { at: Date.now(), ttl: TTL_MS, prices };
  } catch (error) {
    console.warn(`💲 Could not read the price catalogue (${error.message}); keeping what was there.`);
    cached = { at: Date.now(), ttl: FAILURE_TTL_MS, prices: cached?.prices ?? new Map() };
  }
  return cached.prices;
}

/** "openai/gpt-4o" -> { prompt, completion } in USD per token. Never throws. */
export function priceCatalogue() {
  const url = pricesUrl();
  if (!url) return Promise.resolve(new Map());
  if (cached && Date.now() - cached.at < cached.ttl) return Promise.resolve(cached.prices);
  pending ??= load(url).finally(() => {
    pending = null;
  });
  return pending;
}

/** Test seam: forget the catalogue so the next call reads it again. */
export function clearPrices() {
  cached = null;
}

/**
 * The names a model may be filed under in the catalogue, most exact first.
 * Only rewrites known to keep the price: an Anthropic snapshot costs what its
 * family does, and Mistral's -latest is the model itself. An OpenAI snapshot
 * can be priced apart from its alias, so it is matched exactly or not at all.
 */
function candidates(providerId, name) {
  const names = [name];
  if (providerId === 'anthropic') {
    // claude-sonnet-4-5-20250929 is filed as claude-sonnet-4.5.
    const undated = name.replace(/-\d{8}$/, '');
    names.push(undated, undated.replace(/(\d+)-(\d+)/g, '$1.$2'));
  }
  if (providerId === 'mistral') names.push(name.replace(/-latest$/, ''));
  return [...new Set(names)];
}

/** A direct model's list price, marked as an estimate, or null when unknown. */
export function listPrice(providerId, name, prices) {
  const vendor = VENDOR[providerId];
  if (!vendor) return null;
  for (const candidate of candidates(providerId, name)) {
    const price = prices.get(`${vendor}/${candidate}`);
    if (price) return { ...price, estimated: true };
  }
  return null;
}
