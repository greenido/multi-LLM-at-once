/**
 * Provider API keys, kept in SQLite on the server.
 *
 * The browser sets a key through the settings modal and never gets it back:
 * every read path here returns a masked hint, and only `getKey` — used to build
 * an outbound provider request — returns the secret itself.
 *
 * Keys are stored as plaintext in a file mode 0600, in a gitignored directory.
 * Encrypting them with a passphrase kept next to the database on the same disk
 * would look safer without being safer, so the honest controls are the file
 * permissions, disk encryption, and keeping the file out of git.
 */
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Read at connect time, not at import time, so a test can redirect it.
const dbPath = () => process.env.KEYS_DB ?? 'data/keys.db';

/**
 * Environment variables are read as a fallback, so a deployment can inject keys
 * without anyone typing them into the UI. The database wins when both are set.
 */
const ENV_VAR = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  xai: 'XAI_API_KEY',
};

let db = null;

function connect() {
  if (db) return db;

  const path = dbPath();
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS provider_keys (
      provider   TEXT PRIMARY KEY,
      api_key    TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // Readable only by the user running the server. Best effort: some filesystems
  // (and Windows) do not implement POSIX modes, and that is not fatal.
  if (path !== ':memory:') {
    try {
      chmodSync(path, 0o600);
    } catch {
      // Nothing to do about it, and the app still works.
    }
  }
  return db;
}

/**
 * "sk-proj-abc123…d4f2" — enough for a human to tell two keys apart, useless to
 * anyone who intercepts it. Short keys are masked entirely rather than leaked.
 */
export function maskKey(key) {
  if (typeof key !== 'string' || key.length === 0) return '';
  if (key.length <= 8) return '•'.repeat(key.length);
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

/** The secret itself. Only ever used to build an outbound provider request. */
export function getKey(provider) {
  const row = connect()
    .prepare('SELECT api_key FROM provider_keys WHERE provider = ?')
    .get(provider);
  if (row?.api_key) return row.api_key;

  const fromEnv = process.env[ENV_VAR[provider] ?? '']?.trim();
  return fromEnv || null;
}

/** Where a key came from, so the UI can say why it cannot be deleted. */
export function keySource(provider) {
  const row = connect()
    .prepare('SELECT 1 FROM provider_keys WHERE provider = ?')
    .get(provider);
  if (row) return 'database';
  return process.env[ENV_VAR[provider] ?? '']?.trim() ? 'environment' : null;
}

export function setKey(provider, key) {
  connect()
    .prepare(
      `INSERT INTO provider_keys (provider, api_key, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(provider) DO UPDATE SET api_key = excluded.api_key, updated_at = excluded.updated_at`,
    )
    .run(provider, key, Date.now());
}

/** Returns whether a stored key was actually removed. */
export function deleteKey(provider) {
  const { changes } = connect().prepare('DELETE FROM provider_keys WHERE provider = ?').run(provider);
  return changes > 0;
}

/** Everything the settings UI needs, with no secret in it. */
export function keyStatus(provider) {
  const source = keySource(provider);
  const key = source ? getKey(provider) : null;
  return { configured: Boolean(key), source, hint: key ? maskKey(key) : null };
}

/** Test seam: drop the handle so a suite can point KEYS_DB somewhere else. */
export function closeDatabase() {
  db?.close();
  db = null;
}
