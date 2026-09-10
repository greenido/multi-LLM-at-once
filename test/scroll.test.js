import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STICK_SLACK_PX, isAtBottom } from '../src/lib/scroll.js';

/** A container of `clientHeight` scrolled `fromBottom` pixels up from the end. */
const scrolledUpBy = (fromBottom, { clientHeight = 400, scrollHeight = 2000 } = {}) => ({
  clientHeight,
  scrollHeight,
  scrollTop: scrollHeight - clientHeight - fromBottom,
});

describe('isAtBottom', () => {
  it('is true at the exact bottom', () => {
    assert.equal(isAtBottom(scrolledUpBy(0)), true);
  });

  it('tolerates the fractional scroll positions a zoomed display reports', () => {
    assert.equal(isAtBottom(scrolledUpBy(0.5)), true);
  });

  it('is true within the slack, so following survives a nudge of the wheel', () => {
    assert.equal(isAtBottom(scrolledUpBy(STICK_SLACK_PX - 1)), true);
    assert.equal(isAtBottom(scrolledUpBy(STICK_SLACK_PX)), true);
  });

  it('is false once the user has deliberately scrolled up to read', () => {
    assert.equal(isAtBottom(scrolledUpBy(STICK_SLACK_PX + 1)), false);
    assert.equal(isAtBottom(scrolledUpBy(600)), false);
  });

  it('is true when there is nothing to scroll', () => {
    assert.equal(isAtBottom({ scrollTop: 0, scrollHeight: 300, clientHeight: 400 }), true);
  });
});
