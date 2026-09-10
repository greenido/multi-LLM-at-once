/**
 * Saved comparisons and saved prompts, which live on the server.
 *
 * A comparison is saved each time an exchange finishes, under an id this
 * browser picks when the conversation starts — so saving again replaces it,
 * and two tabs each keep their own. Opening one puts it back in the panels,
 * and the conversation carries on from there.
 */
import { asJson, request } from './api.js';

/**
 * A random id. crypto.randomUUID exists only in a secure context, which a
 * server reached over plain HTTP on the LAN is not; getRandomValues works
 * everywhere.
 */
export function newId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

const TITLE_LENGTH = 80;

/** The first thing asked, on one line, as the name a comparison is listed by. */
export function comparisonTitle(models, transcripts) {
  for (const id of [...models, ...Object.keys(transcripts)]) {
    const question = transcripts[id]?.find((turn) => turn.role === 'user');
    if (!question) continue;
    const line = question.text.replace(/\s+/g, ' ').trim();
    return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line;
  }
  return null;
}

/**
 * What gets saved: every model with something in its transcript, minus the
 * flag that only means something while an answer is streaming. Null while
 * nothing has been asked, which is not worth saving.
 */
export function toSaved({ id, system, models, transcripts }) {
  const kept = {};
  for (const [model, turns] of Object.entries(transcripts)) {
    if (turns.length > 0) kept[model] = turns.map(({ streaming, ...turn }) => turn);
  }
  const title = comparisonTitle(models, kept);
  return title ? { id, title, system, models, transcripts: kept } : null;
}

/** Local midnight, so "yesterday" means the calendar day, across DST too. */
const dayOf = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** "14:03" today, "Yesterday 09:12", and "Sep 3" — with a year if not this one — before that. */
export function formatWhen(timestamp, now = new Date()) {
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const daysAgo = Math.round((dayOf(now) - dayOf(date)) / 86_400_000);
  if (daysAgo === 0) return time;
  if (daysAgo === 1) return `Yesterday ${time}`;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

//
// The server.
//

export async function listComparisons(query = '') {
  const q = query.trim();
  const { comparisons = [] } = await request(`/api/comparisons${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  return comparisons;
}

export async function getComparison(id) {
  return (await request(`/api/comparisons/${encodeURIComponent(id)}`)).comparison;
}

export async function saveComparison(snapshot) {
  const path = `/api/comparisons/${encodeURIComponent(snapshot.id)}`;
  return (await request(path, asJson('PUT', snapshot))).comparison;
}

export async function deleteComparison(id) {
  await request(`/api/comparisons/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function listPrompts() {
  const { prompts = [] } = await request('/api/prompts');
  return prompts;
}

export async function createPrompt({ kind, name, text }) {
  return (await request('/api/prompts', asJson('POST', { kind, name, text }))).prompt;
}

export async function deletePrompt(id) {
  await request(`/api/prompts/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
