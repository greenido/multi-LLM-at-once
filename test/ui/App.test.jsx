/**
 * The flows App.jsx coordinates, driven through the UI against a fake API:
 * asking every panel at once, stopping, retrying one panel, saving, opening a
 * saved comparison mid-stream, and the verdict. These are what a refactor of
 * App is most likely to break and what the build alone cannot see.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import App from '../../src/App.jsx';
import { answerFor, fakeApi } from './fakeApi.jsx';

const LLAMA = 'ollama:llama3:latest';
const GPT = 'openai:gpt-4o';

/** The panel for a model, by the label in its heading. */
const panel = (label) => screen.getByRole('heading', { name: new RegExp(label) }).closest('section');

async function start(options) {
  const api = fakeApi(options);
  const user = userEvent.setup();
  render(<App />);
  // Two panels are preselected once the catalogue loads.
  await screen.findByRole('heading', { name: /llama3/ });
  return { api, user };
}

async function ask(user, text) {
  await user.type(screen.getByRole('textbox', { name: 'Your request' }), text);
  await user.click(screen.getByRole('button', { name: 'Send' }));
}

describe('asking', () => {
  it('preselects two panels from the catalogue', async () => {
    await start();
    expect(panel('llama3')).toBeTruthy();
    expect(panel('gpt-4o')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /claude-sonnet-4/ })).toBeNull();
  });

  it('asks every panel at once, each with only its own thread, and streams the answers in', async () => {
    const { api, user } = await start();
    await ask(user, 'What is 2+2?');

    await within(panel('llama3')).findByText(answerFor(LLAMA));
    await within(panel('gpt-4o')).findByText(answerFor(GPT));
    expect(api.queries().map((query) => query.body.model).sort()).toEqual([GPT, LLAMA].sort());

    await ask(user, 'And 3+3?');
    await waitFor(() => expect(api.queries()).toHaveLength(4));
    const followUp = api.queries().find((query) => query.body.model === GPT && query.body.messages.length === 3);
    expect(followUp.body.messages).toEqual([
      { role: 'user', content: 'What is 2+2?' },
      { role: 'assistant', content: answerFor(GPT) },
      { role: 'user', content: 'And 3+3?' },
    ]);
  });

  it('shows one model failing as an error without holding up the other', async () => {
    const { api, user } = await start();
    api.failNext(GPT, 'OpenAI rate limit reached.');
    await ask(user, 'Hello');

    await within(panel('gpt-4o')).findByText('OpenAI rate limit reached.');
    await within(panel('llama3')).findByText(answerFor(LLAMA));
  });

  it('saves the comparison once its answers are in, not mid-stream', async () => {
    const { api, user } = await start();
    api.hold(GPT);
    await ask(user, 'Hello');

    await within(panel('llama3')).findByText(answerFor(LLAMA));
    await waitFor(() => expect(api.isOpen(GPT)).toBe(true));
    expect(api.saves()).toHaveLength(0);

    act(() => api.write(GPT, { type: 'chunk', text: 'Late answer' }));
    act(() => api.finish(GPT));

    await waitFor(() => expect(api.saves()).toHaveLength(1));
    const { body } = api.saves()[0];
    expect(body.title).toBe('Hello');
    expect(Object.keys(body.transcripts).sort()).toEqual([GPT, LLAMA].sort());
    expect(body.transcripts[GPT].at(-1).text).toBe('Late answer');
  });
});

describe('stopping and retrying', () => {
  it('Stop keeps what streamed in and marks it stopped', async () => {
    const { api, user } = await start();
    api.hold(LLAMA);
    api.hold(GPT);
    await ask(user, 'Write a long essay');
    await waitFor(() => expect(api.isOpen(LLAMA) && api.isOpen(GPT)).toBe(true));

    act(() => api.write(LLAMA, { type: 'chunk', text: 'Once upon' }));
    await within(panel('llama3')).findByText(/Once upon/);

    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await within(panel('llama3')).findByText(/\[stopped\]/);
    await screen.findByRole('button', { name: 'Send' });
  });

  it('Retry re-asks one panel and leaves the other alone', async () => {
    const { api, user } = await start();
    api.failNext(GPT, 'Timed out');
    await ask(user, 'Hello');
    await within(panel('gpt-4o')).findByText('Timed out');
    await within(panel('llama3')).findByText(answerFor(LLAMA));

    await user.click(within(panel('gpt-4o')).getByRole('button', { name: 'Retry' }));

    await within(panel('gpt-4o')).findByText(answerFor(GPT));
    expect(within(panel('gpt-4o')).queryByText('Timed out')).toBeNull();
    expect(api.queries().filter((query) => query.body.model === LLAMA)).toHaveLength(1);
  });
});

describe('history', () => {
  const SAVED = {
    id: 'saved-comparison-1',
    title: 'An old question',
    system: 'Be brief.',
    models: [LLAMA, GPT],
    questions: 1,
    createdAt: 1,
    updatedAt: 1,
    verdict: null,
    transcripts: {
      [LLAMA]: [{ role: 'user', text: 'An old question' }, { role: 'assistant', text: 'An old llama answer' }],
      [GPT]: [{ role: 'user', text: 'An old question' }, { role: 'assistant', text: 'An old gpt answer' }],
    },
  };

  it('opening a saved comparison mid-stream drops the late words of the old one', async () => {
    const { api, user } = await start({ comparisons: [SAVED] });
    api.hold(GPT);
    await ask(user, 'A new question');
    await waitFor(() => expect(api.isOpen(GPT)).toBe(true));

    await user.click(screen.getByRole('button', { name: 'History' }));
    await user.click(await screen.findByRole('button', { name: /^An old question/ }));

    await within(panel('gpt-4o')).findByText('An old gpt answer');
    expect(screen.getByRole('textbox', { name: 'System prompt' }).value).toBe('Be brief.');
    expect(within(panel('gpt-4o')).queryByText(/stopped/)).toBeNull();

    // Opening it to read is not a change, so it is not saved again.
    const savesBefore = api.saves().filter((call) => call.path.endsWith(SAVED.id)).length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.saves().filter((call) => call.path.endsWith(SAVED.id))).toHaveLength(savesBefore);
  });
});

describe('the settings of a panel', () => {
  it('go with that panel only, are shown on its answer, and are remembered', async () => {
    const { api, user } = await start();

    await user.click(within(panel('gpt-4o')).getByRole('button', { name: 'Tune' }));
    await user.type(within(panel('gpt-4o')).getByLabelText(/Temperature/), '0.3');
    await user.type(within(panel('gpt-4o')).getByLabelText(/Max answer tokens/), '256');
    await ask(user, 'Hello');

    await within(panel('gpt-4o')).findByText(answerFor(GPT));
    const sent = Object.fromEntries(api.queries().map((query) => [query.body.model, query.body.settings]));
    expect(sent[GPT]).toEqual({ temperature: 0.3, maxTokens: 256 });
    expect(sent[LLAMA]).toBeUndefined();
    expect(within(panel('gpt-4o')).getAllByText('temp 0.3 · max 256 tokens').length).toBeGreaterThan(0);
    expect(JSON.parse(localStorage.getItem('multi-llm.model-settings'))[GPT]).toEqual({ temperature: 0.3, maxTokens: 256 });
  });

  it('go back to the defaults on request', async () => {
    localStorage.setItem('multi-llm.model-settings', JSON.stringify({ [GPT]: { temperature: 0.3 } }));
    const { api, user } = await start();
    expect(within(panel('gpt-4o')).getByText('temp 0.3')).toBeTruthy();

    await user.click(within(panel('gpt-4o')).getByRole('button', { name: 'Tune' }));
    await user.click(within(panel('gpt-4o')).getByRole('button', { name: 'Use defaults' }));
    await ask(user, 'Hello');

    await within(panel('gpt-4o')).findByText(answerFor(GPT));
    expect(api.queries().find((query) => query.body.model === GPT).body.settings).toBeUndefined();
  });
});

describe('the theme', () => {
  it('can be set to dark or light, and is remembered', async () => {
    const { user } = await start();
    const select = screen.getByRole('combobox', { name: 'Theme' });

    await user.selectOptions(select, 'dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(JSON.parse(localStorage.getItem('multi-llm.theme'))).toBe('dark');

    await user.selectOptions(select, 'light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('follows the system by default, as it changes', async () => {
    let listener;
    const query = { matches: true, addEventListener: (_, fn) => { listener = fn; }, removeEventListener: () => {} };
    vi.stubGlobal('matchMedia', () => query);
    await start();
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    query.matches = false;
    act(() => listener());
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});

describe('the verdict', () => {
  it('sends every answer by letter to the judge, and a new question clears it', async () => {
    const { api, user } = await start();
    await ask(user, 'Which is bigger?');
    await within(panel('gpt-4o')).findByText(answerFor(GPT));
    await within(panel('llama3')).findByText(answerFor(LLAMA));

    await user.click(screen.getByRole('button', { name: 'Compare answers' }));
    await screen.findByRole('button', { name: 'Compare again' });

    const judging = api.queries().at(-1).body;
    expect(judging.messages).toHaveLength(1);
    expect(judging.messages[0].content).toContain(answerFor(GPT));
    expect(judging.messages[0].content).not.toMatch(/gpt-4o|llama3/);

    await ask(user, 'Another one');
    await screen.findByRole('button', { name: 'Compare answers' });
  });
});
