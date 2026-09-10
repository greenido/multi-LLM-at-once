/**
 * Saved comparisons and saved prompts, kept in SQLite on the server.
 *
 * A comparison is one conversation across several models: the system prompt,
 * the panels in order, and every model's transcript. The browser still owns a
 * live conversation and sends it whole — this is where a copy of it goes each
 * time an exchange finishes, so it can be found and picked up again later.
 * Transcripts are stored as the browser sent them, checked for shape rather
 * than taken apart, because the browser is what reads them back.
 *
 * Prompts are named, reusable text of two kinds: system prompts and questions.
 *
 * Like the keys, this is plaintext in a file mode 0600 under the gitignored
 * data/ — but a separate file from them, so history can be deleted, copied or
 * backed up without the keys coming along.
 */
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Read at connect time, not at import time, so a test can redirect it.
const dbPath = () => process.env.HISTORY_DB ?? 'data/history.db';

export const PROMPT_KINDS = ['system', 'question'];

// A few to start from, so the prompt menus are not empty on day one. Planted
// once, when the database is created — delete them and they stay deleted.
const STARTER_PROMPTS = [
  ['system', 'Concise expert', 'You are a world-class expert. Answer concisely, and say so when you are not sure.'],
  ['system', 'Explain simply', 'Explain it as you would to a curious twelve-year-old: plain words, one idea at a time, and a concrete example for each.'],
  ['system', 'Code reviewer', 'You are a senior engineer reviewing code. List bugs first, then risks, then style. Be specific and quote the lines you mean.'],
  ['question', 'Bat and ball', 'A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost? Show your reasoning.'],
  ['question', 'Trade-offs table', 'What are the trade-offs between SQLite and PostgreSQL for a small web app? Answer with a table, then a one-line recommendation.'],
  ['question', 'Explain this code', 'Explain what this code does, step by step, and point out anything that could go wrong:\n\n'],
];

/** Refused input. The routes answer it with a 400 and this message. */
export class InvalidInput extends Error {}

/** Ids come from the browser for comparisons, and from here for prompts. */
export const isValidId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id);

const ROLES = new Set(['user', 'assistant', 'error']);
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function check(condition, message) {
  if (!condition) throw new InvalidInput(message);
}

let db = null;

function connect() {
  if (db) return db;

  const path = dbPath();
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  db = new DatabaseSync(path);

  // user_version is 0 on a fresh file: create everything and plant the starter
  // prompts, then mark it so neither happens again.
  if (db.prepare('PRAGMA user_version').get().user_version === 0) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS comparisons (
        id          TEXT PRIMARY KEY,
        title       TEXT NOT NULL,
        system      TEXT NOT NULL,
        models      TEXT NOT NULL,
        transcripts TEXT NOT NULL,
        questions   INTEGER NOT NULL,
        search_text TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS comparisons_by_update ON comparisons (updated_at DESC);

      CREATE TABLE IF NOT EXISTS prompts (
        id         TEXT PRIMARY KEY,
        kind       TEXT NOT NULL CHECK (kind IN ('system', 'question')),
        name       TEXT NOT NULL,
        text       TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
    const insert = db.prepare('INSERT INTO prompts (id, kind, name, text, created_at) VALUES (?, ?, ?, ?, ?)');
    const now = Date.now();
    for (const [kind, name, text] of STARTER_PROMPTS) insert.run(crypto.randomUUID(), kind, name, text, now);
    db.exec('PRAGMA user_version = 1');
  }

  // Readable only by the user running the server — conversations can be as
  // private as keys. Best effort, as for the key store.
  if (path !== ':memory:') {
    try {
      chmodSync(path, 0o600);
    } catch {
      // Nothing to do about it, and the app still works.
    }
  }
  return db;
}

//
// Comparisons
//

/** The most user turns any one model has, which is how many questions were asked. */
function countQuestions(transcripts) {
  return Math.max(0, ...Object.values(transcripts).map((turns) => turns.filter((turn) => turn.role === 'user').length));
}

/** Every question and answer, for search to match against without the JSON around it. */
function searchText(title, transcripts) {
  return [title, ...Object.values(transcripts).flatMap((turns) => turns.map((turn) => turn.text))].join('\n');
}

const toSummary = (row) => ({
  id: row.id,
  title: row.title,
  models: JSON.parse(row.models),
  questions: row.questions,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * The shape the browser reads back, checked on the way in so a saved
 * comparison always opens. Beyond role and text a turn is passed through as
 * sent — its timings, token counts, notes — since the browser owns that shape.
 */
function checkComparison({ id, title, system, models, transcripts }) {
  check(isValidId(id), 'A comparison id is 8 to 64 letters, digits, - or _.');
  check(typeof title === 'string' && title.trim() && title.length <= 200, 'A title of up to 200 characters is required.');
  check(typeof system === 'string', 'system must be a string.');
  check(
    Array.isArray(models) && models.length <= 32 && models.every((model) => typeof model === 'string' && model),
    'models must be a list of model ids.',
  );
  check(isPlainObject(transcripts), 'transcripts must be an object of model id to turns.');

  const entries = Object.entries(transcripts);
  check(entries.length <= 64, 'That is more models than one comparison can hold.');
  for (const [model, turns] of entries) {
    check(Array.isArray(turns), `The transcript for ${model} must be a list of turns.`);
    check(
      turns.every((turn) => isPlainObject(turn) && ROLES.has(turn.role) && typeof turn.text === 'string'),
      `Every turn for ${model} needs a role of user, assistant or error, and text.`,
    );
  }
  check(countQuestions(transcripts) > 0, 'A comparison needs at least one question.');
}

/** Insert or replace one comparison. Created-at survives a replace. */
export function saveComparison(comparison) {
  checkComparison(comparison);
  const { id, system, models, transcripts } = comparison;
  const title = comparison.title.trim();
  const now = Date.now();
  connect()
    .prepare(
      `INSERT INTO comparisons (id, title, system, models, transcripts, questions, search_text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title, system = excluded.system, models = excluded.models,
         transcripts = excluded.transcripts, questions = excluded.questions,
         search_text = excluded.search_text, updated_at = excluded.updated_at`,
    )
    .run(
      id,
      title,
      system,
      JSON.stringify(models),
      JSON.stringify(transcripts),
      countQuestions(transcripts),
      searchText(title, transcripts),
      now,
      now,
    );
  return getComparisonSummary(id);
}

function getComparisonSummary(id) {
  const row = connect()
    .prepare('SELECT id, title, models, questions, created_at, updated_at FROM comparisons WHERE id = ?')
    .get(id);
  return row ? toSummary(row) : null;
}

/** Newest first. `query` matches anywhere in a question or an answer. */
export function listComparisons({ query = '', limit = 200 } = {}) {
  const trimmed = query.trim();
  const statement = trimmed
    ? connect().prepare(
        `SELECT id, title, models, questions, created_at, updated_at FROM comparisons
         WHERE search_text LIKE ? ESCAPE '\\' ORDER BY updated_at DESC LIMIT ?`,
      )
    : connect().prepare(
        'SELECT id, title, models, questions, created_at, updated_at FROM comparisons ORDER BY updated_at DESC LIMIT ?',
      );
  // LIKE's own wildcards are escaped, so searching "100%" means that text.
  const pattern = `%${trimmed.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
  const rows = trimmed ? statement.all(pattern, limit) : statement.all(limit);
  return rows.map(toSummary);
}

export function getComparison(id) {
  const row = connect().prepare('SELECT * FROM comparisons WHERE id = ?').get(id);
  if (!row) return null;
  return {
    ...toSummary(row),
    system: row.system,
    transcripts: JSON.parse(row.transcripts),
  };
}

/** Returns whether there was one to delete. */
export function deleteComparison(id) {
  return connect().prepare('DELETE FROM comparisons WHERE id = ?').run(id).changes > 0;
}

//
// Prompts
//

const toPrompt = (row) => ({ id: row.id, kind: row.kind, name: row.name, text: row.text, createdAt: row.created_at });

/** System prompts first, then questions, each alphabetical. */
export function listPrompts() {
  return connect()
    .prepare("SELECT * FROM prompts ORDER BY kind = 'question', name COLLATE NOCASE")
    .all()
    .map(toPrompt);
}

export function createPrompt({ kind, name, text }) {
  check(PROMPT_KINDS.includes(kind), `kind must be one of: ${PROMPT_KINDS.join(', ')}.`);
  check(typeof name === 'string' && name.trim() && name.trim().length <= 80, 'A name of up to 80 characters is required.');
  check(typeof text === 'string' && text.trim(), 'A prompt cannot be empty.');
  check(text.length <= 100_000, 'That prompt is over 100,000 characters.');
  name = name.trim();

  const id = crypto.randomUUID();
  connect()
    .prepare('INSERT INTO prompts (id, kind, name, text, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, kind, name, text, Date.now());
  return toPrompt(connect().prepare('SELECT * FROM prompts WHERE id = ?').get(id));
}

/** Returns whether there was one to delete. */
export function deletePrompt(id) {
  return connect().prepare('DELETE FROM prompts WHERE id = ?').run(id).changes > 0;
}

/** Test seam: drop the handle so a suite can point HISTORY_DB somewhere else. */
export function closeDatabase() {
  db?.close();
  db = null;
}
