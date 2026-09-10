/**
 * Transcript helpers. A transcript is an ordered list of
 * { role: 'user' | 'assistant' | 'error', text: string } turns.
 */

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
