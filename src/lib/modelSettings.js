/**
 * A panel's own settings: its temperature and a cap on its answer's length.
 * Either can be left unset, and a model with neither answers at its
 * provider's defaults — which is also what a comparison of defaults needs.
 */

/** Anthropic takes 0–1; everyone else here takes 0–2. */
export const maxTemperature = (provider) => (provider === 'anthropic' ? 1 : 2);

/** The server refuses anything above this; the model's own limit is usually lower. */
export const MAX_ANSWER_TOKENS = 1_000_000;

/**
 * Only the settings that are set and valid for this provider, or an empty
 * object. A stored value from an older version, or out of range, is dropped
 * rather than sent to be refused.
 */
export function cleanSettings(raw, provider) {
  const settings = {};
  const temperature = raw?.temperature;
  if (typeof temperature === 'number' && temperature >= 0 && temperature <= maxTemperature(provider)) {
    settings.temperature = temperature;
  }
  const maxTokens = raw?.maxTokens;
  if (Number.isInteger(maxTokens) && maxTokens >= 1 && maxTokens <= MAX_ANSWER_TOKENS) {
    settings.maxTokens = maxTokens;
  }
  return settings;
}

export const hasSettings = (settings) => Boolean(settings) && Object.keys(settings).length > 0;

/** "temp 0.3 · max 256 tokens", or null when the model runs at its defaults. */
export function describeSettings(settings) {
  if (!hasSettings(settings)) return null;
  return [
    settings.temperature !== undefined ? `temp ${settings.temperature}` : null,
    settings.maxTokens !== undefined ? `max ${settings.maxTokens.toLocaleString('en-US')} tokens` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
