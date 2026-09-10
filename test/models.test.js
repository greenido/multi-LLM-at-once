import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_SELECTED, defaultSelection, emojiFor, prettyLabel, toModel } from '../src/lib/models.js';

const models = (...ids) => ids.map(toModel);

describe('prettyLabel', () => {
  it('strips the implicit :latest tag', () => {
    assert.equal(prettyLabel('llama3:latest'), 'llama3');
  });

  it('keeps an explicit tag, which distinguishes two installs of one family', () => {
    assert.equal(prettyLabel('phi3:14b'), 'phi3:14b');
  });
});

describe('emojiFor', () => {
  it('recognises known families', () => {
    assert.equal(emojiFor('llama3:latest'), emojiFor('llama3.2:1b'));
    assert.notEqual(emojiFor('llama3:latest'), emojiFor('phi3:latest'));
  });

  it('falls back for anything unknown rather than rendering nothing', () => {
    assert.equal(emojiFor('some-new-model:1b'), '🤖');
  });
});

describe('defaultSelection', () => {
  it('ranks by preference, not by the order Ollama returns', () => {
    // Ollama returns tags sorted alphabetically, which would put gemma first.
    const selected = defaultSelection(models('gemma:2b', 'llama3:latest', 'mistral:7b', 'phi3:latest'));
    assert.deepEqual(selected, ['llama3:latest', 'phi3:latest']);
  });

  it('falls back to whatever is installed when nothing is preferred', () => {
    const selected = defaultSelection(models('zephyr:7b', 'orca-mini:3b'));
    assert.equal(selected.length, 2);
  });

  it('never selects more panels than are allowed', () => {
    const selected = defaultSelection(models('llama3:latest', 'phi3:latest', 'mistral:7b', 'gemma:2b', 'qwen2:0.5b'));
    assert.ok(selected.length <= MAX_SELECTED);
  });

  it('copes with a single model, and with none', () => {
    assert.deepEqual(defaultSelection(models('llama3:latest')), ['llama3:latest']);
    assert.deepEqual(defaultSelection([]), []);
  });

  it('does not mutate the list it is given', () => {
    const list = models('gemma:2b', 'llama3:latest');
    const before = list.map((m) => m.id);
    defaultSelection(list);
    assert.deepEqual(list.map((m) => m.id), before);
  });
});
