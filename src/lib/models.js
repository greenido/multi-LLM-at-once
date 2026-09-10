/**
 * Models come from the server, which asks each provider what it has: the local
 * Ollama daemon, and every cloud provider with an API key configured.
 *
 * Ids are namespaced "provider:name" because two providers can use the same
 * model name. Ollama's own names contain a colon ("llama3:latest"), so the
 * split takes the first one only.
 */

/** How many models can be compared at once, to keep the grid and the box sane. */
export const MAX_SELECTED = 4;

/** Models we preselect when the user has no saved choice, best first. */
const PREFERRED = [
  'llama3',
  'phi3',
  'mistral',
  'gemma',
  'gpt-4o',
  'claude-sonnet',
  'gemini-2.5-flash',
  'grok-3',
];

const PROVIDER_EMOJI = {
  openai: '🧠',
  anthropic: '🔶',
  gemini: '✨',
  xai: '🛸',
};

/** Ollama models are grouped by family instead, since they are all local. */
const FAMILY_EMOJI = [
  [/^llama|^codellama/, '🐑'],
  [/^phi/, '⛵️'],
  [/^mistral|^mixtral/, '🌬️'],
  [/^gemma/, '💎'],
  [/^qwen/, '🐉'],
  [/^deepseek/, '🔍'],
  [/^granite/, '🪨'],
  [/^tinyllama/, '🐜'],
];

/** "llama3:latest" -> "llama3"; "phi3:14b" keeps its tag. */
export function prettyLabel(name) {
  return name.replace(/:latest$/, '');
}

export function emojiFor(provider, name) {
  if (provider !== 'ollama') return PROVIDER_EMOJI[provider] ?? '☁️';
  const match = FAMILY_EMOJI.find(([pattern]) => pattern.test(name));
  return match ? match[1] : '🤖';
}

export function parseModelId(id) {
  const separator = id.indexOf(':');
  if (separator <= 0) return null;
  return { provider: id.slice(0, separator), name: id.slice(separator + 1) };
}

/** Turn a raw server entry into the shape the UI renders. */
export function toModel({ id, provider, name }) {
  return { id, provider, name, label: prettyLabel(name), emoji: emojiFor(provider, name) };
}

export async function fetchModels() {
  const response = await fetch('/api/models');
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Could not list models (HTTP ${response.status})`);
  }
  return {
    models: (data.models ?? []).map(toModel),
    providers: data.providers ?? [],
  };
}

/**
 * Pick sensible defaults: the familiar models in PREFERRED order, then whatever
 * else is available, capped at two panels so the first render is not
 * overwhelming. PREFERRED is a ranking, so rank by it rather than letting the
 * alphabetical order the providers return decide.
 */
export function defaultSelection(models) {
  const rank = (model) => {
    const index = PREFERRED.findIndex((preferred) => model.name.startsWith(preferred));
    return index === -1 ? PREFERRED.length : index;
  };
  return [...models]
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 2)
    .map((model) => model.id);
}

/**
 * Models bucketed by provider, in the server's order, skipping providers with
 * nothing to show. The picker renders one row per provider so a list spanning
 * five services stays readable.
 */
export function groupByProvider(models, providers) {
  return providers
    .map((provider) => ({
      ...provider,
      emoji: PROVIDER_EMOJI[provider.id] ?? null,
      models: models.filter((model) => model.provider === provider.id),
    }))
    .filter((group) => group.models.length > 0);
}
