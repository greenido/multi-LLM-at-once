import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { comparisonTitle, formatWhen, newId, toSaved } from '../src/lib/history.js';

const user = (text) => ({ role: 'user', text });
const answer = (text, extra = {}) => ({ role: 'assistant', text, ...extra });

describe('newId', () => {
  it('is 32 hex characters, which the server accepts as an id', () => {
    assert.match(newId(), /^[0-9a-f]{32}$/);
  });

  it('is different every time', () => {
    assert.notEqual(newId(), newId());
  });
});

describe('comparisonTitle', () => {
  it('is the first question, on one line', () => {
    const title = comparisonTitle(['a'], { a: [user('Explain this:\n\n  const x = 1;'), answer('ok')] });
    assert.equal(title, 'Explain this: const x = 1;');
  });

  it('follows the panel order rather than whichever model answered first', () => {
    assert.equal(comparisonTitle(['b', 'a'], { a: [user('from a')], b: [user('from b')] }), 'from b');
  });

  it('shortens a long question, marking the cut', () => {
    const title = comparisonTitle(['a'], { a: [user('word '.repeat(40))] });
    assert.equal(title.length, 80);
    assert.ok(title.endsWith('…'));
  });

  it('is null until something has been asked', () => {
    assert.equal(comparisonTitle(['a'], {}), null);
  });
});

describe('toSaved', () => {
  const base = { id: 'abc12345', system: 'Be terse.', models: ['a', 'b'] };

  it('keeps every model that has a transcript, and drops empty ones', () => {
    const saved = toSaved({ ...base, transcripts: { a: [user('q'), answer('r')], b: [] } });
    assert.deepEqual(Object.keys(saved.transcripts), ['a']);
    assert.equal(saved.title, 'q');
    assert.equal(saved.system, 'Be terse.');
  });

  it('drops the streaming flag, so a reopened answer is not left forever loading', () => {
    const saved = toSaved({ ...base, transcripts: { a: [user('q'), answer('partial', { streaming: true, ms: 5 })] } });
    assert.deepEqual(saved.transcripts.a[1], { role: 'assistant', text: 'partial', ms: 5 });
  });

  it('is null while nothing has been asked', () => {
    assert.equal(toSaved({ ...base, transcripts: {} }), null);
  });
});

describe('formatWhen', () => {
  const now = new Date(2026, 8, 10, 15, 30);
  const time = (date) => date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  it('shows just the time for today', () => {
    const earlier = new Date(2026, 8, 10, 9, 5);
    assert.equal(formatWhen(earlier.getTime(), now), time(earlier));
  });

  it('says yesterday for yesterday, even just after midnight', () => {
    const lateLastNight = new Date(2026, 8, 9, 23, 59);
    assert.equal(formatWhen(lateLastNight.getTime(), new Date(2026, 8, 10, 0, 1)), `Yesterday ${time(lateLastNight)}`);
  });

  it('shows the date before that, and the year only when it is not this one', () => {
    const lastWeek = new Date(2026, 8, 3, 12, 0);
    assert.equal(formatWhen(lastWeek.getTime(), now), lastWeek.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    const lastYear = new Date(2025, 11, 31, 12, 0);
    assert.ok(formatWhen(lastYear.getTime(), now).includes('2025'));
  });
});
