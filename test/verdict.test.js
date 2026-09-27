import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  JUDGE_SYSTEM,
  buildJudgePrompt,
  latestExchange,
  verdictToMarkdown,
  withVerdict,
} from '../src/lib/verdict.js';

const gpt = { id: 'openai:gpt-4o', label: 'gpt-4o' };
const claude = { id: 'anthropic:claude-opus-5', label: 'claude-opus-5' };
const llama = { id: 'ollama:llama3:latest', label: 'llama3' };

const user = (text) => ({ role: 'user', text });
const answer = (text, extra = {}) => ({ role: 'assistant', text, ...extra });

describe('latestExchange', () => {
  it('takes the latest question and each finished answer to it, in panel order', () => {
    const exchange = latestExchange([gpt, claude], {
      [gpt.id]: [user('first?'), answer('one'), user('Why is the sky blue?'), answer('Scattering.')],
      [claude.id]: [user('first?'), answer('uno'), user('Why is the sky blue?'), answer('Rayleigh.')],
    });
    assert.equal(exchange.question, 'Why is the sky blue?');
    assert.deepEqual(exchange.answers.map((each) => [each.model.id, each.text]), [
      [gpt.id, 'Scattering.'],
      [claude.id, 'Rayleigh.'],
    ]);
  });

  it('leaves out an answer still streaming, one that failed, and one never started', () => {
    const exchange = latestExchange([gpt, claude, llama], {
      [gpt.id]: [user('q'), answer('done')],
      [claude.id]: [user('q'), answer('half', { streaming: true })],
      [llama.id]: [user('q'), { role: 'error', text: 'Cannot reach Ollama' }],
    });
    assert.equal(exchange, null);
  });

  it('needs two answers to have anything to compare', () => {
    assert.equal(latestExchange([gpt], { [gpt.id]: [user('q'), answer('a')] }), null);
    assert.equal(latestExchange([gpt, claude], {}), null);
  });

  it('leaves out a panel whose latest question is not the others', () => {
    const exchange = latestExchange([gpt, claude, llama], {
      [gpt.id]: [user('q2'), answer('a')],
      [claude.id]: [user('q2'), answer('b')],
      [llama.id]: [user('q1'), answer('c')],
    });
    assert.deepEqual(exchange.answers.map((each) => each.model.id), [gpt.id, claude.id]);
  });

  it('keeps whether an answer was cut short, or failed partway', () => {
    const exchange = latestExchange([gpt, claude], {
      [gpt.id]: [user('q'), answer('a', { truncated: 'length' })],
      [claude.id]: [user('q'), answer('b', { note: 'Timed out' })],
    });
    assert.equal(exchange.answers[0].truncated, 'length');
    assert.equal(exchange.answers[1].failed, true);
  });
});

describe('buildJudgePrompt', () => {
  const exchange = {
    question: 'Why is the sky blue?',
    answers: [
      { model: gpt, text: 'Scattering.' },
      { model: claude, text: 'Rayleigh scattering, mostly.', truncated: 'length' },
    ],
  };
  const prompt = buildJudgePrompt(exchange);

  it('puts each answer under a letter, in order', () => {
    assert.ok(prompt.includes('<question>\nWhy is the sky blue?\n</question>'));
    assert.ok(prompt.indexOf('<answer id="A">\nScattering.\n</answer>') < prompt.indexOf('<answer id="B">'));
  });

  it('never names the models, so the judge cannot favour one — its own included', () => {
    for (const text of [prompt, JUDGE_SYSTEM]) {
      for (const name of ['gpt', 'claude', 'openai', 'anthropic']) assert.ok(!text.toLowerCase().includes(name), name);
    }
  });

  it('says which answer did not finish, so it is not judged wrong where it stops', () => {
    assert.ok(prompt.includes('(Answer B did not finish: cut off at the token limit.)'));
    assert.ok(!prompt.includes('(Answer A did not finish'));
    const failed = buildJudgePrompt({ ...exchange, answers: [exchange.answers[0], { model: llama, text: 'Once', failed: true }] });
    assert.ok(failed.includes('(Answer B did not finish: it stopped partway, on an error.)'));
  });

  it('asks for agreement, disagreement, mistakes, the best answer and a merged one', () => {
    for (const section of ['## Agreement', '## Disagreement', '## Mistakes', '## Best answer', '## Merged answer']) {
      assert.ok(prompt.includes(section), section);
    }
  });
});

describe('the verdict in the export', () => {
  const verdict = {
    judge: claude.id,
    labels: [gpt.id, llama.id],
    question: 'Why is the sky blue?',
    turn: answer('## Agreement\nBoth say scattering.', { ms: 3200, usage: { promptTokens: 300, completionTokens: 90 } }),
  };

  it('names the judge, the key to its letters, and what it wrote', () => {
    const text = verdictToMarkdown(verdict);
    assert.ok(text.startsWith('## ⚖️ Verdict · Judged by `anthropic:claude-opus-5` · 3.2s'));
    assert.ok(text.includes('**A** `openai:gpt-4o` · **B** `ollama:llama3:latest`'));
    assert.ok(text.includes('## Agreement\nBoth say scattering.'));
  });

  it('says so when the verdict itself was cut short', () => {
    const text = verdictToMarkdown({ ...verdict, turn: { ...verdict.turn, truncated: 'length' } });
    assert.ok(text.endsWith('> ⚠️ Cut off at the token limit.'));
  });

  it('comes after the panels, and only when there is one', () => {
    assert.equal(withVerdict('# Export\n', null), '# Export\n');
    assert.ok(withVerdict('# Export\n', verdict).startsWith('# Export\n\n## ⚖️ Verdict'));
  });
});
