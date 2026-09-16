/**
 * How the model picker stays short: a row never dumps its catalogue into the
 * page. The first few pills stay visible, anything selected stays visible, and
 * the rest are reached through Find a model — so the answer panels keep the
 * main screen.
 */

/** How many pills a provider shows before the rest hide behind Find a model. */
export const COLLAPSED_COUNT = 8;

/**
 * While searching, still cap how many pills a row can paint. A broad query
 * against OpenRouter would otherwise fill the page the same way Expand did.
 */
export const MAX_FILTER_MATCHES = 16;

/** Case-insensitive, anywhere in the name or label — "sonnet", "70b", "llama-3". */
export function matchesFilter(model, filter) {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  return model.name.toLowerCase().includes(needle) || model.label.toLowerCase().includes(needle);
}

/**
 * Which pills a provider row should render, and how many stay hidden.
 *
 * Never returns the full catalogue for a large provider: collapsed rows keep
 * the first COLLAPSED_COUNT plus any selected later in the list; filtered rows
 * keep at most MAX_FILTER_MATCHES matches.
 */
export function visibleForGroup(models, { selectedIds = [], filter = '', collapsedCount = COLLAPSED_COUNT, maxFilterMatches = MAX_FILTER_MATCHES } = {}) {
  const selected = new Set(selectedIds);
  const trimmed = filter.trim();

  if (trimmed) {
    const matched = models.filter((model) => matchesFilter(model, trimmed));
    return {
      visible: matched.slice(0, maxFilterMatches),
      hidden: Math.max(0, matched.length - maxFilterMatches),
      matchCount: matched.length,
      filtering: true,
    };
  }

  const visible = models.filter((model, index) => index < collapsedCount || selected.has(model.id));
  return {
    visible,
    hidden: models.length - visible.length,
    matchCount: models.length,
    filtering: false,
  };
}

/**
 * Bucket models by maker for the browse dialog. A reseller names models
 * "anthropic/claude-…" — that prefix is the maker. A leading "~" (OpenRouter
 * aliases) is stripped so they sit with their lab. Models with no slash stay
 * under a single "Models" bucket.
 */
export function groupByMaker(models) {
  const buckets = new Map();
  for (const model of models) {
    const slash = model.name.indexOf('/');
    const raw = slash > 0 ? model.name.slice(0, slash) : '';
    const maker = raw.replace(/^~/, '') || 'Models';
    if (!buckets.has(maker)) buckets.set(maker, []);
    buckets.get(maker).push(model);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => {
      if (a === 'Models') return 1;
      if (b === 'Models') return -1;
      return a.localeCompare(b);
    })
    .map(([maker, items]) => ({ maker, models: items }));
}

/** Short name for a list row: "claude-sonnet-4.5" from "anthropic/claude-sonnet-4.5". */
export function shortModelName(name) {
  const slash = name.lastIndexOf('/');
  return slash >= 0 ? name.slice(slash + 1) : name;
}
