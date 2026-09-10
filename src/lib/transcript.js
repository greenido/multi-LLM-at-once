/**
 * Transcript helpers. A transcript is an ordered list of
 * { role: 'user' | 'assistant' | 'error', text: string } turns, where an
 * answer also carries whatever was measured about it — see metrics.js.
 */
import { formatTokens, turnStats } from './metrics.js';

/**
 * How many turns of history to send back. A local model's context window is
 * small, and an unbounded transcript would eventually fill it with old turns
 * and push the actual question out.
 */
export const HISTORY_TURNS = 20;

/**
 * The transcript as chat messages. Errors are dropped — the model never said
 * them — and empty turns cannot be sent, so they go too.
 *
 * What is left has to still be a conversation every API accepts. Dropping a
 * failed answer leaves its question next to the following one, and two user
 * turns in a row is not something every API takes, so they are folded into one
 * message: the model gets both questions. And cutting to HISTORY_TURNS can
 * land on an answer whose question was cut off, so the history always opens
 * with the user.
 */
export function toMessages(turns) {
  const messages = [];
  for (const turn of turns.filter((turn) => turn.role !== 'error' && turn.text.trim()).slice(-HISTORY_TURNS)) {
    const last = messages.at(-1);
    if (last?.role === turn.role) last.content += `\n\n${turn.text}`;
    else messages.push({ role: turn.role, content: turn.text });
  }
  while (messages[0]?.role === 'assistant') messages.shift();
  return messages;
}

/**
 * Prompt and completion tokens across a transcript. Cloud providers bill by the
 * token, so a running total is worth showing next to a panel that is spending.
 */
export function totalTokens(turns) {
  return turns.reduce(
    (total, turn) => ({
      promptTokens: total.promptTokens + (turn.usage?.promptTokens ?? 0),
      completionTokens: total.completionTokens + (turn.usage?.completionTokens ?? 0),
    }),
    { promptTokens: 0, completionTokens: 0 },
  );
}

//
// Export. Answers are markdown already, so the export is a markdown document
// — and it carries what the panels show about each answer, because the
// timings and token counts are the point of keeping a comparison at all.
//

/** Quoted, line by line, so a multi-line prompt stays one block. */
const quote = (text) =>
  text
    .trim()
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');

function turnToMarkdown(turn) {
  if (turn.role === 'user') return `**Me**\n\n${turn.text.trim()}`;
  if (turn.role === 'error') return `**Error**\n\n${quote(turn.text)}`;

  const stats = Object.values(turnStats(turn)).filter(Boolean);
  const label = ['**AI**', ...stats, ...(turn.streaming ? ['still answering'] : [])].join(' · ');
  const note = turn.note ? `\n\n${quote(`⚠️ ${turn.note}`)}` : '';
  return `${label}\n\n${turn.text.trim()}${note}`;
}

/** One model's conversation, titled with the model that had it. */
export function modelToMarkdown(model, turns) {
  const total = totalTokens(turns);
  const spent = total.promptTokens + total.completionTokens > 0;
  const heading = `## ${model.emoji} ${model.label}\n\n\`${model.id}\`${spent ? ` · ${formatTokens(total)} in total` : ''}`;
  if (turns.length === 0) return `${heading}\n\n_Nothing asked yet._`;
  return [heading, ...turns.map(turnToMarkdown)].join('\n\n');
}

/** "2026-09-10 14:03 UTC" */
const formatTimestamp = (date) => `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** Every panel in one document, under the system prompt they all answered to. */
export function buildMarkdown(models, transcripts, system, now = new Date()) {
  const parts = [
    '# Multi LLM comparison',
    `Exported ${formatTimestamp(now)} · ${models.length} model${models.length === 1 ? '' : 's'}`,
  ];
  if (system?.trim()) parts.push(`**System prompt**\n\n${quote(system)}`);
  for (const model of models) parts.push(modelToMarkdown(model, transcripts[model.id] ?? []));
  return `${parts.join('\n\n')}\n`;
}

/** Timestamped filename for the export download. */
export function exportFilename(now = new Date()) {
  return `exported_multi-llm_${now.toISOString()}.md`;
}

export function downloadText(filename, text, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}
