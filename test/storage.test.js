import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { load, save } from '../src/lib/storage.js';

const realWindow = globalThis.window;
afterEach(() => {
  globalThis.window = realWindow;
});

function fakeStorage(behaviour = {}) {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      getItem: behaviour.getItem ?? ((key) => (store.has(key) ? store.get(key) : null)),
      setItem: behaviour.setItem ?? ((key, value) => store.set(key, value)),
    },
  };
  return store;
}

describe('storage', () => {
  it('round-trips a value', () => {
    fakeStorage();
    save('k', ['a', 'b']);
    assert.deepEqual(load('k', null), ['a', 'b']);
  });

  it('returns the fallback for a missing key', () => {
    fakeStorage();
    assert.equal(load('absent', 'fallback'), 'fallback');
  });

  it('returns the fallback rather than throwing on corrupt JSON', () => {
    const store = fakeStorage();
    store.set('k', '{not json');
    assert.equal(load('k', 'fallback'), 'fallback');
  });

  it('survives a storage that throws, as in a private window', () => {
    fakeStorage({
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    });
    assert.equal(load('k', 'fallback'), 'fallback');
    assert.doesNotThrow(() => save('k', 'value'));
  });

  it('survives no storage at all', () => {
    globalThis.window = undefined;
    assert.equal(load('k', 'fallback'), 'fallback');
    assert.doesNotThrow(() => save('k', 'value'));
  });
});
