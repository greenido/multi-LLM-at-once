import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_SELECTED,
  defaultSelection,
  emojiFor,
  groupByProvider,
  parseModelId,
  prettyLabel,
  toModel,
} from '../src/lib/models.js';

/** "ollama:llama3:latest" -> the shape the UI renders. */
const model = (id) => toModel({ id, ...parseModelId(id) });
const models = (...ids) => ids.map(model);

describe('parseModelId', () => {
  it('splits on the first colon, so an Ollama tag survives', () => {
    assert.deepEqual(parseModelId('ollama:llama3:latest'), {
      provider: 'ollama',
      name: 'llama3:latest',
    });
  });

  it('reads a cloud id', () => {
    assert.deepEqual(parseModelId('openai:gpt-4o'), { provider: 'openai', name: 'gpt-4o' });
  });

  it('rejects an id with no namespace', () => {
    assert.equal(parseModelId('gpt-4o'), null);
    assert.equal(parseModelId(':leading'), null);
  });
});

describe('prettyLabel', () => {
  it('strips the implicit :latest tag', () => {
    assert.equal(prettyLabel('llama3:latest'), 'llama3');
  });

  it('keeps an explicit tag, which distinguishes two installs of one family', () => {
    assert.equal(prettyLabel('phi3:14b'), 'phi3:14b');
  });
});

describe('emojiFor', () => {
  it('recognises local families', () => {
    assert.equal(emojiFor('ollama', 'llama3:latest'), emojiFor('ollama', 'llama3.2:1b'));
    assert.notEqual(emojiFor('ollama', 'llama3:latest'), emojiFor('ollama', 'phi3:latest'));
  });

  it('falls back for an unknown local model rather than rendering nothing', () => {
    assert.equal(emojiFor('ollama', 'some-new-model:1b'), '🤖');
  });

  it('marks a cloud model by provider, not by family', () => {
    // Every OpenAI model reads the same, and differs from every Gemini one.
    assert.equal(emojiFor('openai', 'gpt-4o'), emojiFor('openai', 'o3-mini'));
    assert.notEqual(emojiFor('openai', 'gpt-4o'), emojiFor('gemini', 'gemini-2.5-pro'));
  });

  it('falls back for a provider it has no icon for', () => {
    assert.equal(emojiFor('some-new-provider', 'x'), '☁️');
  });
});

describe('defaultSelection', () => {
  it('ranks by preference, not by the order the providers return', () => {
    // Providers return names sorted alphabetically, which would put gemma first.
    const selected = defaultSelection(
      models('ollama:gemma:2b', 'ollama:llama3:latest', 'ollama:mistral:7b', 'ollama:phi3:latest'),
    );
    assert.deepEqual(selected, ['ollama:llama3:latest', 'ollama:phi3:latest']);
  });

  it('ranks cloud models too, so a cloud-only setup gets sensible defaults', () => {
    const selected = defaultSelection(models('xai:grok-3', 'openai:gpt-4o', 'gemini:gemini-2.5-flash'));
    assert.deepEqual(selected, ['openai:gpt-4o', 'gemini:gemini-2.5-flash']);
  });

  it('falls back to whatever is available when nothing is preferred', () => {
    const selected = defaultSelection(models('ollama:zephyr:7b', 'ollama:orca-mini:3b'));
    assert.equal(selected.length, 2);
  });

  it('never selects more panels than are allowed', () => {
    const selected = defaultSelection(
      models('ollama:llama3:latest', 'ollama:phi3:latest', 'ollama:mistral:7b', 'ollama:gemma:2b', 'openai:gpt-4o'),
    );
    assert.ok(selected.length <= MAX_SELECTED);
  });

  it('copes with a single model, and with none', () => {
    assert.deepEqual(defaultSelection(models('ollama:llama3:latest')), ['ollama:llama3:latest']);
    assert.deepEqual(defaultSelection([]), []);
  });

  it('does not mutate the list it is given', () => {
    const list = models('ollama:gemma:2b', 'ollama:llama3:latest');
    const before = list.map((m) => m.id);
    defaultSelection(list);
    assert.deepEqual(list.map((m) => m.id), before);
  });
});

describe('groupByProvider', () => {
  const providers = [
    { id: 'ollama', label: 'Ollama' },
    { id: 'openai', label: 'OpenAI' },
    { id: 'gemini', label: 'Google Gemini' },
  ];

  it('buckets models in the order the server listed the providers', () => {
    const groups = groupByProvider(models('openai:gpt-4o', 'ollama:llama3:latest'), providers);
    assert.deepEqual(groups.map((group) => group.id), ['ollama', 'openai']);
    assert.deepEqual(groups[1].models.map((m) => m.name), ['gpt-4o']);
  });

  it('drops a provider with nothing to show, so an unconfigured one is invisible', () => {
    const groups = groupByProvider(models('ollama:llama3:latest'), providers);
    assert.deepEqual(groups.map((group) => group.id), ['ollama']);
  });

  it('carries the provider status through for the picker to render', () => {
    const groups = groupByProvider(models('openai:gpt-4o'), [
      { id: 'openai', label: 'OpenAI', error: 'rate limited', configured: true },
    ]);
    assert.equal(groups[0].error, 'rate limited');
    assert.equal(groups[0].label, 'OpenAI');
  });
});
