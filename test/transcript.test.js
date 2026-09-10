import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HISTORY_TURNS,
  buildExport,
  exportFilename,
  toMessages,
  transcriptToText,
} from '../src/lib/transcript.js';

const turn = (role, text) => ({ role, text });

describe('toMessages', () => {
  it('maps user and assistant turns to chat messages', () => {
    assert.deepEqual(
      toMessages([turn('user', 'hi'), turn('assistant', 'hello')]),
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
    );
  });

  it('drops error turns, which the model never said', () => {
    const messages = toMessages([
      turn('user', 'hi'),
      turn('error', 'Cannot reach Ollama'),
      turn('user', 'still there?'),
    ]);
    assert.deepEqual(messages.map((m) => m.content), ['hi', 'still there?']);
  });

  it('drops blank turns, which the API rejects', () => {
    assert.deepEqual(toMessages([turn('user', '   '), turn('user', 'real')]).length, 1);
  });

  it('keeps only the last HISTORY_TURNS turns', () => {
    const many = Array.from({ length: HISTORY_TURNS + 10 }, (_, i) => turn('user', `q${i}`));
    const messages = toMessages(many);
    assert.equal(messages.length, HISTORY_TURNS);
    // The most recent turns survive, not the oldest.
    assert.equal(messages.at(-1).content, `q${HISTORY_TURNS + 9}`);
  });
});

describe('transcriptToText', () => {
  it('labels each turn by speaker and separates them', () => {
    assert.equal(
      transcriptToText([turn('user', 'hi'), turn('assistant', 'hello')]),
      '* Me: hi\n----\n* AI: hello\n----\n',
    );
  });

  it('labels errors', () => {
    assert.match(transcriptToText([turn('error', 'boom')]), /^\* Error: boom/);
  });

  it('is empty for an empty transcript', () => {
    assert.equal(transcriptToText([]), '');
  });
});

describe('buildExport', () => {
  const models = [
    { id: 'a', label: 'Llama 3' },
    { id: 'b', label: 'Phi-3' },
  ];

  it('titles each section with the model that produced it', () => {
    const text = buildExport(models, { a: [turn('assistant', 'from a')], b: [turn('assistant', 'from b')] });
    assert.match(text, /^Llama 3:/);
    assert.ok(text.includes('Phi-3:'));
    assert.ok(text.includes('from a') && text.includes('from b'));
  });

  it('handles a model with no transcript yet', () => {
    assert.doesNotThrow(() => buildExport(models, {}));
  });
});

describe('exportFilename', () => {
  it('embeds the timestamp and ends in .txt', () => {
    const name = exportFilename(new Date('2026-09-09T12:34:56.000Z'));
    assert.equal(name, 'exported_multi-llm_2026-09-09T12:34:56.000Z.txt');
  });
});
