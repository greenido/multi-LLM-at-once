/**
 * Transcript helpers. A transcript is an ordered list of
 * { role: 'user' | 'assistant' | 'error', text: string } turns.
 */

/**
 * How many turns of history to send back. A local model's context window is
 * small, and an unbounded transcript would eventually fill it with old turns
 * and push the actual question out.
 */
export const HISTORY_TURNS = 20;

/**
 * The transcript as Ollama chat messages. Errors are dropped — the model never
 * said them — and empty turns cannot be sent, so they go too.
 */
export function toMessages(turns) {
  return turns
    .filter((turn) => turn.role !== 'error' && turn.text.trim())
    .slice(-HISTORY_TURNS)
    .map((turn) => ({ role: turn.role, content: turn.text }));
}

/** Serialize one transcript to the plain-text form used by copy and export. */
export function transcriptToText(turns) {
  const speaker = { user: 'Me', assistant: 'AI', error: 'Error' };
  return turns
    .map((turn) => `* ${speaker[turn.role]}: ${turn.text.trim()}\n----\n`)
    .join('');
}

/** Serialize every panel into one document, each section titled by model. */
export function buildExport(models, transcripts) {
  return models
    .map((model) => `${model.label}:\n${transcriptToText(transcripts[model.id] ?? [])}`)
    .join('\n=====\n');
}

/** Timestamped filename for the export download. */
export function exportFilename(now = new Date()) {
  return `exported_multi-llm_${now.toISOString()}.txt`;
}

export function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
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
