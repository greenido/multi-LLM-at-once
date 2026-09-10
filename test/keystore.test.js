import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

// Redirected before the module connects, so no test touches data/keys.db.
process.env.KEYS_DB = ':memory:';
const { closeDatabase, deleteKey, getKey, keySource, keyStatus, maskKey, setKey } = await import(
  '../server/keystore.mjs'
);

// Invented values throughout — never a real credential.
const KEY = 'sk-test-000000000000000000000000004f2a';

beforeEach(() => {
  closeDatabase();
  delete process.env.OPENAI_API_KEY;
});

describe('maskKey', () => {
  it('keeps just enough to tell two keys apart', () => {
    assert.equal(maskKey(KEY), 'sk-…4f2a');
  });

  it('reveals nothing from a short key rather than most of it', () => {
    assert.equal(maskKey('abc'), '•••');
    assert.equal(maskKey('12345678'), '••••••••');
  });

  it('has no opinion about an absent key', () => {
    assert.equal(maskKey(''), '');
    assert.equal(maskKey(undefined), '');
  });

  it('never contains the middle of the key', () => {
    assert.ok(!maskKey(KEY).includes('0000'));
  });
});

describe('storing a key', () => {
  it('round-trips', () => {
    setKey('openai', KEY);
    assert.equal(getKey('openai'), KEY);
    assert.equal(keySource('openai'), 'database');
  });

  it('replaces rather than duplicating', () => {
    setKey('openai', KEY);
    setKey('openai', 'sk-test-second-00000000000000000beef');
    assert.equal(getKey('openai'), 'sk-test-second-00000000000000000beef');
  });

  it('reports nothing for a provider that was never set', () => {
    assert.equal(getKey('gemini'), null);
    assert.equal(keySource('gemini'), null);
    assert.deepEqual(keyStatus('gemini'), { configured: false, source: null, hint: null });
  });

  it('deletes, and says whether there was anything to delete', () => {
    setKey('xai', KEY);
    assert.equal(deleteKey('xai'), true);
    assert.equal(deleteKey('xai'), false);
    assert.equal(getKey('xai'), null);
  });
});

describe('the environment fallback', () => {
  it('supplies a key nobody typed in', () => {
    process.env.OPENAI_API_KEY = KEY;
    assert.equal(getKey('openai'), KEY);
    assert.equal(keySource('openai'), 'environment');
  });

  it('loses to a stored key, so the UI can override a deployment default', () => {
    process.env.OPENAI_API_KEY = 'sk-test-from-env-000000000000000000';
    setKey('openai', KEY);
    assert.equal(getKey('openai'), KEY);
    assert.equal(keySource('openai'), 'database');
  });

  it('ignores an empty variable rather than treating it as configured', () => {
    process.env.OPENAI_API_KEY = '   ';
    assert.equal(getKey('openai'), null);
    assert.equal(keySource('openai'), null);
  });
});

describe('keyStatus', () => {
  it('carries a masked hint and never the key', () => {
    setKey('anthropic', KEY);
    const status = keyStatus('anthropic');
    assert.deepEqual(status, { configured: true, source: 'database', hint: 'sk-…4f2a' });
    assert.ok(!JSON.stringify(status).includes(KEY));
  });
});
