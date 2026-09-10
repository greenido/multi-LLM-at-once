import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  HISTORY_TURNS,
  buildMarkdown,
  exportFilename,
  modelToMarkdown,
  toMessages,
  totalTokens,
} from '../src/lib/transcript.js';

const turn = (role, text, extra = {}) => ({ role, text, ...extra });

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
    const messages = toMessages([turn('user', 'hi'), turn('error', 'Cannot reach Ollama')]);
    assert.deepEqual(messages, [{ role: 'user', content: 'hi' }]);
  });

  it('folds a question whose answer failed into the next one, rather than sending two user turns', () => {
    const messages = toMessages([
      turn('user', 'hi'),
      turn('error', 'rate limit reached'),
      turn('user', 'still there?'),
    ]);
    assert.deepEqual(messages, [{ role: 'user', content: 'hi\n\nstill there?' }]);
  });

  it('drops blank turns, which the API rejects', () => {
    assert.deepEqual(toMessages([turn('user', '   '), turn('user', 'real')]), [
      { role: 'user', content: 'real' },
    ]);
  });

  /** q0, a1, q2, a3 … ending on a question, as a request always does. */
  const conversation = (length) =>
    Array.from({ length }, (_, i) => turn(i % 2 ? 'assistant' : 'user', `t${i}`));

  it('never sends more than HISTORY_TURNS turns, keeping the most recent', () => {
    const messages = toMessages(conversation(HISTORY_TURNS + 11));
    assert.ok(messages.length <= HISTORY_TURNS);
    assert.equal(messages.at(-1).content, `t${HISTORY_TURNS + 10}`);
  });

  it('opens with the user even when the cut lands on an answer', () => {
    // An odd-length conversation cut to an even number of turns starts on an
    // answer whose question was cut off.
    const messages = toMessages(conversation(HISTORY_TURNS + 1));
    assert.equal(messages[0].role, 'user');
    assert.equal(messages.length, HISTORY_TURNS - 1);
  });
});

describe('totalTokens', () => {
  it('adds up every answer, and skips turns with no counts', () => {
    const total = totalTokens([
      turn('user', 'q'),
      turn('assistant', 'a', { usage: { promptTokens: 10, completionTokens: 5 } }),
      turn('assistant', 'b', { usage: { promptTokens: 20, completionTokens: 7 } }),
    ]);
    assert.deepEqual(total, { promptTokens: 30, completionTokens: 12 });
  });

  it('totals the cost too, where answers carry one', () => {
    const total = totalTokens([
      turn('assistant', 'a', { usage: { promptTokens: 10, completionTokens: 5, costUsd: 0.25 } }),
      turn('assistant', 'b', { usage: { promptTokens: 20, completionTokens: 7 } }),
      turn('assistant', 'c', { usage: { promptTokens: 1, completionTokens: 1, costUsd: 0.5 } }),
    ]);
    assert.deepEqual(total, { promptTokens: 31, completionTokens: 13, costUsd: 0.75 });
  });
});

describe('the markdown export', () => {
  const gpt = { id: 'openai:gpt-4o', label: 'gpt-4o', emoji: '🧠' };
  const llama = { id: 'ollama:llama3:latest', label: 'llama3', emoji: '🐑' };
  const now = new Date('2026-09-10T14:03:27.000Z');

  const answered = [
    turn('user', 'Why is the sky blue?'),
    turn('assistant', 'Rayleigh **scattering**.', {
      ms: 12800,
      ttftMs: 800,
      usage: { promptTokens: 12, completionTokens: 600 },
    }),
  ];

  it('titles each section with the model, and names its exact id', () => {
    const text = modelToMarkdown(gpt, answered);
    assert.ok(text.startsWith('## 🧠 gpt-4o\n\n`openai:gpt-4o`'));
  });

  it('keeps an answer as the markdown it was written in', () => {
    assert.ok(modelToMarkdown(gpt, answered).includes('Rayleigh **scattering**.'));
  });

  it("puts each answer's timings and token counts next to it", () => {
    assert.ok(modelToMarkdown(gpt, answered).includes('**AI** · 12.8s · first token 0.8s · 50 tok/s · 12 in · 600 out'));
  });

  it("gives a section the model's running token total", () => {
    assert.ok(modelToMarkdown(gpt, answered).includes('12 in · 600 out in total'));
  });

  it('marks errors, and the note on an answer that failed partway', () => {
    const text = modelToMarkdown(gpt, [
      turn('user', 'q'),
      turn('error', 'Grok rate limit reached.'),
      turn('assistant', 'half an ans', { note: 'Connection reset.' }),
    ]);
    assert.ok(text.includes('**Error**\n\n> Grok rate limit reached.'));
    assert.ok(text.includes('> ⚠️ Connection reset.'));
  });

  it('says so for a model that has not been asked anything', () => {
    assert.ok(modelToMarkdown(llama, []).includes('_Nothing asked yet._'));
  });

  it('opens with when it was exported and how many models it compares', () => {
    const text = buildMarkdown([gpt, llama], { [gpt.id]: answered }, '', now);
    assert.ok(text.startsWith('# Multi LLM comparison\n\nExported 2026-09-10 14:03 UTC · 2 models'));
  });

  it('includes the system prompt every model answered to, quoted line by line', () => {
    const text = buildMarkdown([gpt], {}, 'Be terse.\nUse bullets.', now);
    assert.ok(text.includes('**System prompt**\n\n> Be terse.\n> Use bullets.'));
  });

  it('leaves the system prompt out when there was none', () => {
    assert.ok(!buildMarkdown([gpt], {}, '  ', now).includes('System prompt'));
  });

  it('has every model, in panel order', () => {
    const text = buildMarkdown([gpt, llama], {}, '', now);
    assert.ok(text.indexOf('## 🧠 gpt-4o') < text.indexOf('## 🐑 llama3'));
  });
});

describe('exportFilename', () => {
  it('embeds the timestamp and ends in .md', () => {
    const name = exportFilename(new Date('2026-09-09T12:34:56.000Z'));
    assert.equal(name, 'exported_multi-llm_2026-09-09T12:34:56.000Z.md');
  });
});
