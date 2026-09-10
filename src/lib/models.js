/**
 * Models come from the server, which reads them from Ollama. Nothing here is
 * hardcoded — pull a new model and it shows up in the picker.
 */

/** How many models can be compared at once, to keep the grid and the box sane. */
export const MAX_SELECTED = 4;

/** Models we preselect when the user has no saved choice. */
const PREFERRED = ['llama3', 'phi3', 'mistral', 'gemma'];

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
export function prettyLabel(id) {
  return id.replace(/:latest$/, '');
}

export function emojiFor(id) {
  const match = FAMILY_EMOJI.find(([pattern]) => pattern.test(id));
  return match ? match[1] : '🤖';
}

/** Turn a raw Ollama model id into the shape the UI renders. */
export function toModel(id) {
  return { id, label: prettyLabel(id), emoji: emojiFor(id) };
}

export async function fetchModels() {
  const response = await fetch('/api/models');
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Could not list models (HTTP ${response.status})`);
  }
  return (data.models ?? []).map(toModel);
}

/**
 * Pick sensible defaults: the familiar models in PREFERRED order, then
 * whatever else is installed, capped at two panels so the first render is not
 * overwhelming. PREFERRED is a ranking, so rank by it rather than letting the
 * alphabetical order Ollama returns decide.
 */
export function defaultSelection(models) {
  const rank = (model) => {
    const index = PREFERRED.findIndex((name) => model.id.startsWith(name));
    return index === -1 ? PREFERRED.length : index;
  };
  return [...models]
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, 2)
    .map((model) => model.id);
}
