import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NOTABLE_LOAD_MS,
  formatCost,
  formatSpend,
  formatTokens,
  tokensPerSecond,
  turnStats,
  withCost,
} from '../src/lib/metrics.js';

const usage = (completionTokens, extra = {}) => ({ promptTokens: 10, completionTokens, ...extra });

// Grouping follows the machine's locale, so the expected text does too.
const n = (value) => value.toLocaleString();

describe('tokensPerSecond', () => {
  it('measures from the first token, so a slow start does not dilute the speed', () => {
    // 100 tokens streamed over the 2s after a 3s wait: 50 tok/s, not 20.
    assert.equal(tokensPerSecond({ usage: usage(100), ms: 5000, ttftMs: 3000 }), 50);
  });

  it("prefers Ollama's own decode timing when it reports one", () => {
    assert.equal(tokensPerSecond({ usage: usage(90, { evalMs: 1500 }), ms: 9000, ttftMs: 100 }), 60);
  });

  it('leaves out reasoning tokens that never streamed', () => {
    // 1,100 billed output tokens, of which only 100 were the visible answer.
    const turn = { usage: usage(1100, { reasoningTokens: 1000 }), ms: 12000, ttftMs: 10000 };
    assert.equal(tokensPerSecond(turn), 50);
  });

  it('has nothing to say about an answer that arrived in one piece', () => {
    assert.equal(tokensPerSecond({ usage: usage(40), ms: 1000, ttftMs: 990 }), null);
  });

  it('has nothing to say without token counts or timings', () => {
    assert.equal(tokensPerSecond({ ms: 5000, ttftMs: 1000 }), null);
    assert.equal(tokensPerSecond({ usage: usage(0), ms: 5000, ttftMs: 1000 }), null);
    assert.equal(tokensPerSecond({ usage: usage(100), ms: 5000 }), null);
  });

  it('does not go negative when every token was reasoning', () => {
    const turn = { usage: usage(500, { reasoningTokens: 500 }), ms: 6000, ttftMs: 1000 };
    assert.equal(tokensPerSecond(turn), null);
  });
});

describe('turnStats', () => {
  it('formats everything a finished answer knows about itself', () => {
    const stats = turnStats({ ms: 12800, ttftMs: 800, usage: usage(600, { promptTokens: 1234 }) });
    assert.deepEqual(stats, {
      duration: '12.8s',
      load: null,
      firstToken: 'first token 0.8s',
      speed: '50 tok/s',
      tokens: `${n(1234)} in · 600 out`,
    });
  });

  it('keeps a decimal on a slow model rather than rounding it to nothing', () => {
    assert.equal(turnStats({ ms: 21000, ttftMs: 1000, usage: usage(50) }).speed, '2.5 tok/s');
  });

  it('points out a cold model load, and only a cold one', () => {
    assert.equal(turnStats({ usage: usage(1, { loadMs: 2100 }) }).load, 'load 2.1s');
    assert.equal(turnStats({ usage: usage(1, { loadMs: NOTABLE_LOAD_MS - 1 }) }).load, null);
  });

  it('is all nulls for a turn that is still streaming', () => {
    assert.deepEqual(Object.values(turnStats({ role: 'assistant', text: 'so far' })), [null, null, null, null, null]);
  });
});

describe('formatTokens', () => {
  it('reads like the panel header', () => {
    assert.equal(formatTokens({ promptTokens: 9, completionTokens: 1234 }), `9 in · ${n(1234)} out`);
  });
});

describe('what an answer cost', () => {
  const pricing = { prompt: 0.000003, completion: 0.000015 };

  it('works it out from the list price when the provider did not say', () => {
    const { costUsd } = withCost(usage(200, { promptTokens: 1000 }), pricing);
    assert.ok(Math.abs(costUsd - (1000 * 0.000003 + 200 * 0.000015)) < 1e-12);
  });

  it('prefers the cost the provider reported, which knows about caching', () => {
    assert.equal(withCost(usage(200, { costUsd: 0.0001 }), pricing).costUsd, 0.0001);
  });

  it('has no cost at all for a provider that publishes no prices', () => {
    assert.equal('costUsd' in withCost(usage(200), undefined), false);
  });

  it('keeps four decimals under a dollar, since one answer usually costs less than a cent', () => {
    assert.equal(formatCost(0.00042), '$0.0004');
    assert.equal(formatCost(0.0123), '$0.0123');
    assert.equal(formatCost(1.371), '$1.37');
    assert.equal(formatCost(0.00001), '<$0.0001');
    assert.equal(formatCost(0), 'free');
  });

  it('rides along with the token counts', () => {
    assert.equal(formatSpend({ promptTokens: 9, completionTokens: 40, costUsd: 0.0012 }), '9 in · 40 out · $0.0012');
    assert.equal(formatSpend({ promptTokens: 9, completionTokens: 40 }), '9 in · 40 out');
  });
});
