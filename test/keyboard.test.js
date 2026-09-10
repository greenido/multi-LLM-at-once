import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isSubmitKey } from '../src/lib/keyboard.js';

/** The fields a React keydown event carries that the rule reads. */
const key = (overrides = {}) => ({
  key: 'Enter',
  shiftKey: false,
  keyCode: 13,
  nativeEvent: { isComposing: false },
  ...overrides,
});

describe('isSubmitKey', () => {
  it('sends on a plain Enter', () => {
    assert.equal(isSubmitKey(key()), true);
  });

  it('leaves Shift+Enter to insert a new line', () => {
    assert.equal(isSubmitKey(key({ shiftKey: true })), false);
  });

  it('ignores every other key', () => {
    assert.equal(isSubmitKey(key({ key: 'a', keyCode: 65 })), false);
  });

  it('does not send the Enter that confirms an IME candidate', () => {
    assert.equal(isSubmitKey(key({ nativeEvent: { isComposing: true } })), false);
  });

  it('catches the same Enter in Safari, which reports it only as keyCode 229', () => {
    assert.equal(isSubmitKey(key({ keyCode: 229 })), false);
  });

  it('reads a plain DOM event too, not only a React one', () => {
    assert.equal(isSubmitKey({ key: 'Enter', shiftKey: false, keyCode: 13, isComposing: true }), false);
  });
});
