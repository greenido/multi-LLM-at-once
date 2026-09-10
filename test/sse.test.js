import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sseEvents, thinkTags } from '../server/providers/shared.mjs';

/** A ReadableStream that hands out exactly these byte groups, as given. */
function streamOf(...groups) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const group of groups) controller.enqueue(encoder.encode(group));
      controller.close();
    },
  });
}

const collect = async (...groups) => {
  const out = [];
  for await (const payload of sseEvents(streamOf(...groups))) out.push(payload);
  return out;
};

describe('sseEvents', () => {
  it('reads one event per blank line', async () => {
    assert.deepEqual(await collect('data: one\n\ndata: two\n\n'), ['one', 'two']);
  });

  it('joins a payload split across several data lines, as the spec says', async () => {
    assert.deepEqual(await collect('data: {"a":\ndata: 1}\n\n'), ['{"a":\n1}']);
  });

  it('reassembles an event split across reads', async () => {
    assert.deepEqual(await collect('data: {"te', 'xt":"hi"}\n', '\n'), ['{"text":"hi"}']);
  });

  it('handles a chunk boundary inside the newline pair', async () => {
    assert.deepEqual(await collect('data: one\n', '\ndata: two\n\n'), ['one', 'two']);
  });

  it('tolerates CRLF', async () => {
    assert.deepEqual(await collect('data: one\r\n\r\n'), ['one']);
  });

  it('ignores comments, ids and event names', async () => {
    assert.deepEqual(
      await collect(': keep-alive\nevent: message_start\nid: 7\nretry: 100\ndata: payload\n\n'),
      ['payload'],
    );
  });

  it('yields a final event that arrives without its trailing blank line', async () => {
    assert.deepEqual(await collect('data: last\n'), ['last']);
  });

  it('strips only the single optional space after the colon', async () => {
    assert.deepEqual(await collect('data:  two-spaces\n\n'), [' two-spaces']);
  });

  it('produces nothing from a stream with no data lines', async () => {
    assert.deepEqual(await collect('event: ping\n\n'), []);
    assert.deepEqual(await collect(''), []);
  });
});

/** Feed chunks through a fresh splitter, then flush it, collecting every part. */
function split(chunks) {
  const next = thinkTags();
  return [...chunks.flatMap((chunk) => next(chunk)), ...next()];
}

describe('thinkTags', () => {
  it('takes the reasoning out from between the tags, and trims the gap before the answer', () => {
    assert.deepEqual(split(['<think>Add them.</think>\n\nFour.']), [
      { reasoning: 'Add them.' },
      { text: 'Four.' },
    ]);
  });

  it('finds tags that arrive in pieces', () => {
    assert.deepEqual(split(['<thi', 'nk>Add ', 'them.</th', 'ink>', 'Four.']), [
      { reasoning: 'Add ' },
      { reasoning: 'them.' },
      { text: 'Four.' },
    ]);
  });

  it('passes an answer with no tags straight through, whitespace and all', () => {
    assert.deepEqual(split(['  Four', '.']), [{ text: '  Four' }, { text: '.' }]);
  });

  it('only looks for them at the start, so a tag later in an answer is left alone', () => {
    assert.deepEqual(split(['Use ', '<think> in a prompt']), [{ text: 'Use ' }, { text: '<think> in a prompt' }]);
  });

  it('lets go of text that only looked like the start of a tag', () => {
    assert.deepEqual(split(['<', 'b>bold</b>']), [{ text: '<b>bold</b>' }]);
    assert.deepEqual(split(['<']), [{ text: '<' }]);
  });

  it('shows nothing for an empty block, which a model not asked to think sends', () => {
    assert.deepEqual(split(['<think>\n\n', '</think>\n\n', 'Four.']), [{ text: 'Four.' }]);
  });

  it('keeps the reasoning of a model stopped before it answered', () => {
    assert.deepEqual(split(['<think>Add them', ' up']), [{ reasoning: 'Add them' }, { reasoning: ' up' }]);
  });
});
