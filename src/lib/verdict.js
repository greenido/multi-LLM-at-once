/**
 * A verdict: one model reads every panel's answer to the latest question and
 * compares them — where they agree, where they contradict each other, what
 * each gets wrong — and writes one merged answer.
 *
 * The answers reach it by letter, never by model. A model asked to judge
 * tends to prefer its own writing, and a famous name is a hint in itself; a
 * letter is neither. The letters are kept with the verdict, in order, so the
 * reader can still tell which answer was which.
 */
import { turnStats } from './metrics.js';
import { cutShortNote } from './transcript.js';

export const LETTERS = 'ABCDEFGH';

export const JUDGE_SYSTEM =
  'You compare answers that different AI models gave to the same question. You are not told which model wrote which answer, so judge each by what it says. Be specific, and quote the words you mean when that helps.';

const INSTRUCTIONS = `Compare the answers. Reply in Markdown, with these sections:

## Agreement
What the answers agree on.

## Disagreement
Where they contradict each other, and which is right, where you can tell.

## Mistakes
Anything an answer gets wrong, naming it by its letter — or "None found."

## Best answer
The letter of the best answer, and why, in a sentence or two.

## Merged answer
One answer to the question that combines the best of them.`;

/**
 * The latest question and every finished answer to it, in panel order — or
 * null when fewer than two panels have one, which leaves nothing to compare.
 * An answer still streaming, and one that failed, are left out. So is a panel
 * whose latest question is not the others' — one added after they were asked.
 */
export function latestExchange(models, transcripts) {
  let question = null;
  const answers = [];
  for (const model of models) {
    const turns = transcripts[model.id] ?? [];
    const asked = turns.findLastIndex((turn) => turn.role === 'user');
    if (asked === -1) continue;
    const answer = turns[asked + 1];
    if (answer?.role !== 'assistant' || answer.streaming || !answer.text.trim()) continue;
    question ??= turns[asked].text;
    if (turns[asked].text !== question) continue;
    answers.push({ model, text: answer.text, truncated: answer.truncated, failed: Boolean(answer.note) });
  }
  return answers.length >= 2 ? { question, answers } : null;
}

/** Why an answer stopped before it was finished, in words for the judge, or null. */
function unfinished({ truncated, failed }) {
  if (truncated) return cutShortNote(truncated).replace(/^Cut/, 'cut').replace(/\.$/, '');
  return failed ? 'it stopped partway, on an error' : null;
}

/**
 * What the judging model is asked: the question, then each answer under its
 * letter. An answer that was cut short, or failed partway, is said to be, so
 * that it is judged as unfinished rather than as wrong where it stops.
 */
export function buildJudgePrompt({ question, answers }) {
  const sections = answers.map((answer, index) => {
    const letter = LETTERS[index];
    const why = unfinished(answer);
    return `<answer id="${letter}">\n${answer.text.trim()}\n</answer>${why ? `\n(Answer ${letter} did not finish: ${why}.)` : ''}`;
  });
  return [
    `The question:\n\n<question>\n${question.trim()}\n</question>`,
    `${answers.length} answers to it, each under a letter:\n\n${sections.join('\n\n')}`,
    INSTRUCTIONS,
  ].join('\n\n');
}

/** The verdict as a section of the Markdown export, with the key to its letters. */
export function verdictToMarkdown(verdict) {
  const { turn } = verdict;
  const stats = Object.values(turnStats(turn)).filter(Boolean);
  const heading = ['## ⚖️ Verdict', `Judged by \`${verdict.judge}\``, ...stats].join(' · ');
  const key = verdict.labels.map((model, index) => `**${LETTERS[index]}** \`${model}\``).join(' · ');
  const body = turn.role === 'error' ? `> ${turn.text.trim()}` : turn.text.trim();
  const notes = [
    ...(turn.truncated ? [cutShortNote(turn.truncated)] : []),
    ...(turn.note ? [turn.note] : []),
  ].map((note) => `\n\n> ⚠️ ${note}`);
  return `${heading}\n\n${key}\n\n${body}${notes.join('')}`;
}

/** An export with the verdict after the panels, when there is one. */
export function withVerdict(markdown, verdict) {
  return verdict ? `${markdown}\n${verdictToMarkdown(verdict)}\n` : markdown;
}
