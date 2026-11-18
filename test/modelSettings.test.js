import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cleanSettings, describeSettings, maxTemperature } from '../src/lib/modelSettings.js';

describe('the settings of a panel', () => {
  it('keeps what is set and valid', () => {
    assert.deepEqual(cleanSettings({ temperature: 0.7, maxTokens: 512 }, 'openai'), { temperature: 0.7, maxTokens: 512 });
  });

  it('keeps a temperature of zero', () => {
    assert.deepEqual(cleanSettings({ temperature: 0 }, 'openai'), { temperature: 0 });
  });

  it('drops anything out of range or of the wrong kind, rather than send it to be refused', () => {
    assert.deepEqual(cleanSettings({ temperature: 2.5, maxTokens: 0 }, 'openai'), {});
    assert.deepEqual(cleanSettings({ temperature: '0.7', maxTokens: 1.5 }, 'openai'), {});
    assert.deepEqual(cleanSettings(null, 'openai'), {});
  });

  it('holds Claude to the 0–1 that Anthropic takes', () => {
    assert.equal(maxTemperature('anthropic'), 1);
    assert.equal(maxTemperature('gemini'), 2);
    assert.deepEqual(cleanSettings({ temperature: 1.5 }, 'anthropic'), {});
    assert.deepEqual(cleanSettings({ temperature: 1.5 }, 'gemini'), { temperature: 1.5 });
  });

  it('describes itself in a line, or not at all at the defaults', () => {
    assert.equal(describeSettings({ temperature: 0.3, maxTokens: 1024 }), 'temp 0.3 · max 1,024 tokens');
    assert.equal(describeSettings({ maxTokens: 256 }), 'max 256 tokens');
    assert.equal(describeSettings({}), null);
    assert.equal(describeSettings(undefined), null);
  });
});
