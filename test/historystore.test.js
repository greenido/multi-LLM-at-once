import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';

// Redirected before the module connects, so no test touches data/history.db.
process.env.HISTORY_DB = ':memory:';
const {
  InvalidInput,
  closeDatabase,
  createPrompt,
  deleteComparison,
  deletePrompt,
  getComparison,
  listComparisons,
  listPrompts,
  saveComparison,
} = await import('../server/historystore.mjs');

// Every test starts from a freshly created database.
beforeEach(() => closeDatabase());

const comparison = (overrides = {}) => ({
  id: 'cmp00000000000000000000000000001',
  title: 'Why is the sky blue?',
  system: 'Be terse.',
  models: ['openai:gpt-4o', 'ollama:llama3:latest'],
  transcripts: {
    'openai:gpt-4o': [
      { role: 'user', text: 'Why is the sky blue?' },
      { role: 'assistant', text: 'Rayleigh scattering.', ms: 1200, usage: { promptTokens: 9, completionTokens: 4 } },
    ],
    'ollama:llama3:latest': [
      { role: 'user', text: 'Why is the sky blue?' },
      { role: 'error', text: 'Cannot reach Ollama' },
    ],
  },
  ...overrides,
});

describe('saving a comparison', () => {
  it('reads back exactly what was saved, timings and all', () => {
    saveComparison(comparison());
    const saved = getComparison(comparison().id);
    assert.equal(saved.system, 'Be terse.');
    assert.deepEqual(saved.models, comparison().models);
    assert.deepEqual(saved.transcripts, comparison().transcripts);
  });

  it('counts the questions asked, which is the longest thread of user turns', () => {
    assert.equal(saveComparison(comparison()).questions, 1);
  });

  it('replaces a comparison saved under the same id, keeping when it was created', async () => {
    const first = saveComparison(comparison());
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = saveComparison(comparison({ title: 'Renamed' }));
    assert.equal(second.title, 'Renamed');
    assert.equal(second.createdAt, first.createdAt);
    assert.ok(second.updatedAt > first.updatedAt);
    assert.equal(listComparisons().length, 1);
  });

  it('refuses a malformed one rather than storing something that will not open', () => {
    const bad = [
      comparison({ id: 'short' }),
      comparison({ id: '../../etc/passwd-0000' }),
      comparison({ title: '   ' }),
      comparison({ title: 'x'.repeat(201) }),
      comparison({ system: 42 }),
      comparison({ models: 'openai:gpt-4o' }),
      comparison({ transcripts: [] }),
      comparison({ transcripts: { m: [{ role: 'system', text: 'x' }] } }),
      comparison({ transcripts: { m: [{ role: 'user' }] } }),
      comparison({ transcripts: { m: [{ role: 'assistant', text: 'no question' }] } }),
    ];
    for (const input of bad) assert.throws(() => saveComparison(input), InvalidInput);
    assert.equal(listComparisons().length, 0);
  });
});

describe('a verdict', () => {
  const verdict = {
    judge: 'anthropic:claude-opus-5',
    labels: ['openai:gpt-4o', 'ollama:llama3:latest'],
    question: 'Why is the sky blue?',
    turn: { role: 'assistant', text: '## Agreement\nBoth say scattering.', ms: 3200 },
  };

  it('is kept with its comparison, and read back as it was', () => {
    saveComparison(comparison({ verdict }));
    assert.deepEqual(getComparison(comparison().id).verdict, verdict);
  });

  it('is null for a comparison saved without one, or saved again without it', () => {
    saveComparison(comparison());
    assert.equal(getComparison(comparison().id).verdict, null);
    saveComparison(comparison({ verdict }));
    saveComparison(comparison());
    assert.equal(getComparison(comparison().id).verdict, null);
  });

  it('is refused when it is malformed, rather than stored to fail when opened', () => {
    const bad = [
      'a verdict',
      { ...verdict, judge: '' },
      { ...verdict, labels: ['openai:gpt-4o'] },
      { ...verdict, labels: ['openai:gpt-4o', 42] },
      { ...verdict, question: undefined },
      { ...verdict, turn: { role: 'judge', text: 'x' } },
      { ...verdict, turn: undefined },
    ];
    for (const input of bad) assert.throws(() => saveComparison(comparison({ verdict: input })), InvalidInput);
  });

  it('can be kept in a history file from before verdicts, whose comparisons still open', () => {
    const file = join(tmpdir(), `multi-llm-history-v1-${process.pid}.db`);
    rmSync(file, { force: true });
    // A file as version 1 left it: no verdict column.
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE comparisons (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, system TEXT NOT NULL, models TEXT NOT NULL,
        transcripts TEXT NOT NULL, questions INTEGER NOT NULL, search_text TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE prompts (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL);
      PRAGMA user_version = 1;
    `);
    const { id, title, system, models, transcripts } = comparison();
    old.prepare('INSERT INTO comparisons VALUES (?, ?, ?, ?, ?, 1, ?, 1, 1)')
      .run(id, title, system, JSON.stringify(models), JSON.stringify(transcripts), title);
    old.close();

    process.env.HISTORY_DB = file;
    try {
      assert.equal(getComparison(id).verdict, null);
      assert.deepEqual(getComparison(id).transcripts, transcripts);
      saveComparison(comparison({ verdict }));
      assert.deepEqual(getComparison(id).verdict, verdict);
    } finally {
      closeDatabase();
      process.env.HISTORY_DB = ':memory:';
      rmSync(file, { force: true });
    }
  });
});

describe('listing comparisons', () => {
  it('lists newest first, without the transcripts', async () => {
    saveComparison(comparison({ id: 'cmp-older-000000', title: 'Older' }));
    await new Promise((resolve) => setTimeout(resolve, 5));
    saveComparison(comparison({ id: 'cmp-newer-000000', title: 'Newer' }));
    const list = listComparisons();
    assert.deepEqual(list.map((item) => item.title), ['Newer', 'Older']);
    assert.equal('transcripts' in list[0], false);
  });

  it('finds a comparison by anything in a question or an answer', () => {
    saveComparison(comparison());
    assert.equal(listComparisons({ query: 'rayleigh' }).length, 1);
    assert.equal(listComparisons({ query: 'sky blue' }).length, 1);
    assert.equal(listComparisons({ query: 'photosynthesis' }).length, 0);
  });

  it('does not match on the JSON the transcripts are stored as', () => {
    saveComparison(comparison());
    assert.equal(listComparisons({ query: 'completionTokens' }).length, 0);
  });

  it("treats LIKE's wildcards as the characters they are", () => {
    saveComparison(comparison());
    assert.equal(listComparisons({ query: '%' }).length, 0);
    assert.equal(listComparisons({ query: '_' }).length, 0);
  });
});

describe('deleting a comparison', () => {
  it('removes it, and says whether there was one', () => {
    saveComparison(comparison());
    assert.equal(deleteComparison(comparison().id), true);
    assert.equal(getComparison(comparison().id), null);
    assert.equal(deleteComparison(comparison().id), false);
  });
});

describe('prompts', () => {
  it('starts with a few of each kind, so the menus are not empty on day one', () => {
    const prompts = listPrompts();
    assert.ok(prompts.some((prompt) => prompt.kind === 'system'));
    assert.ok(prompts.some((prompt) => prompt.kind === 'question'));
  });

  it('lists system prompts before questions, each alphabetically', () => {
    const kinds = listPrompts().map((prompt) => prompt.kind);
    assert.deepEqual(kinds, [...kinds].sort((a, b) => (a === b ? 0 : a === 'system' ? -1 : 1)));
  });

  it('saves a new one, trimming its name', () => {
    const prompt = createPrompt({ kind: 'question', name: '  Haiku  ', text: 'Write a haiku about SQLite.' });
    assert.equal(prompt.name, 'Haiku');
    assert.ok(listPrompts().some((each) => each.id === prompt.id));
  });

  it('keeps the starters deleted once they are deleted', () => {
    // A file, not :memory:, so reconnecting finds the same database.
    const file = join(tmpdir(), `multi-llm-history-${process.pid}.db`);
    process.env.HISTORY_DB = file;
    try {
      for (const prompt of listPrompts()) deletePrompt(prompt.id);
      closeDatabase();
      assert.equal(listPrompts().length, 0);
    } finally {
      closeDatabase();
      process.env.HISTORY_DB = ':memory:';
      rmSync(file, { force: true });
    }
  });

  it('refuses one with no name, no text or an unknown kind', () => {
    assert.throws(() => createPrompt({ kind: 'question', name: ' ', text: 'x' }), InvalidInput);
    assert.throws(() => createPrompt({ kind: 'question', name: 'x', text: '  ' }), InvalidInput);
    assert.throws(() => createPrompt({ kind: 'persona', name: 'x', text: 'x' }), InvalidInput);
    assert.throws(() => createPrompt({ kind: 'question', name: 'x'.repeat(81), text: 'x' }), InvalidInput);
  });
});
