import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COLLAPSED_COUNT,
  MAX_FILTER_MATCHES,
  groupByMaker,
  matchesFilter,
  shortModelName,
  visibleForGroup,
} from '../src/lib/picker.js';

const model = (name) => ({ id: `openrouter:${name}`, name, label: name, emoji: '🔀' });
const many = (n, prefix = 'm') => Array.from({ length: n }, (_, i) => model(`${prefix}-${i}`));

describe('matchesFilter', () => {
  it('matches anywhere in the name, case-insensitively', () => {
    assert.equal(matchesFilter(model('anthropic/claude-sonnet-4.5'), 'SONNET'), true);
    assert.equal(matchesFilter(model('anthropic/claude-sonnet-4.5'), 'gpt'), false);
  });
});

describe('visibleForGroup', () => {
  it('keeps a short list fully visible', () => {
    const models = many(3);
    const { visible, hidden } = visibleForGroup(models);
    assert.equal(visible.length, 3);
    assert.equal(hidden, 0);
  });

  it('collapses a long list to the first few pills', () => {
    const models = many(443);
    const { visible, hidden, filtering } = visibleForGroup(models);
    assert.equal(visible.length, COLLAPSED_COUNT);
    assert.equal(hidden, 443 - COLLAPSED_COUNT);
    assert.equal(filtering, false);
  });

  it('keeps a selected model visible even when it sits past the collapse cut', () => {
    const models = many(40);
    const picked = models[30].id;
    const { visible, hidden } = visibleForGroup(models, { selectedIds: [picked] });
    assert.ok(visible.some((m) => m.id === picked));
    assert.equal(visible.length, COLLAPSED_COUNT + 1);
    assert.equal(hidden, 40 - (COLLAPSED_COUNT + 1));
  });

  it('never dumps every filter match — a broad query stays capped', () => {
    const models = [...many(50, 'claude'), ...many(50, 'other')];
    const { visible, hidden, matchCount, filtering } = visibleForGroup(models, { filter: 'claude' });
    assert.equal(filtering, true);
    assert.equal(matchCount, 50);
    assert.equal(visible.length, MAX_FILTER_MATCHES);
    assert.equal(hidden, 50 - MAX_FILTER_MATCHES);
  });

  it('returns every match when a filter hits fewer than the cap', () => {
    const models = [model('openai/gpt-4o'), model('anthropic/claude-sonnet'), model('google/gemini-flash')];
    const { visible, hidden, matchCount } = visibleForGroup(models, { filter: 'sonnet' });
    assert.equal(matchCount, 1);
    assert.equal(visible.length, 1);
    assert.equal(hidden, 0);
    assert.equal(visible[0].name, 'anthropic/claude-sonnet');
  });
});

describe('groupByMaker', () => {
  it('groups by the maker prefix and folds ~ aliases into the same lab', () => {
    const groups = groupByMaker([
      model('openai/gpt-4o'),
      model('~anthropic/claude-sonnet-latest'),
      model('anthropic/claude-haiku-4.5'),
      model('gemini-2.5-flash'),
    ]);
    assert.deepEqual(
      groups.map((group) => [group.maker, group.models.map((m) => m.name)]),
      [
        ['anthropic', ['~anthropic/claude-sonnet-latest', 'anthropic/claude-haiku-4.5']],
        ['openai', ['openai/gpt-4o']],
        ['Models', ['gemini-2.5-flash']],
      ],
    );
  });
});

describe('shortModelName', () => {
  it('keeps the part after the maker slash', () => {
    assert.equal(shortModelName('anthropic/claude-sonnet-4.5'), 'claude-sonnet-4.5');
    assert.equal(shortModelName('gemini-2.5-flash'), 'gemini-2.5-flash');
  });
});
