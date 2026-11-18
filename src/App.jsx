import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Navbar from './components/Navbar.jsx';
import ContextBar from './components/ContextBar.jsx';
import HistoryPanel from './components/HistoryPanel.jsx';
import ModelPanel from './components/ModelPanel.jsx';
import ModelPicker from './components/ModelPicker.jsx';
import QueryBar from './components/QueryBar.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import VerdictPanel from './components/VerdictPanel.jsx';
import { useAutosave } from './hooks/useAutosave.js';
import { useCatalogue } from './hooks/useCatalogue.js';
import { useHistorySheet } from './hooks/useHistorySheet.js';
import { usePersistentState } from './hooks/usePersistentState.js';
import { usePrompts } from './hooks/usePrompts.js';
import { useStreams } from './hooks/useStreams.js';
import { useTranscripts } from './hooks/useTranscripts.js';
import { deleteComparison, getComparison, newId } from './lib/history.js';
import { cleanSettings } from './lib/modelSettings.js';
import { clearKey, fetchSettings, saveKey, testKey } from './lib/settings.js';
import { buildMarkdown, downloadText, exportFilename, toMessages } from './lib/transcript.js';
import { JUDGE_SYSTEM, buildJudgePrompt, latestExchange, verdictToMarkdown, withVerdict } from './lib/verdict.js';

// The verdict's request, beside the panels' — which are keyed by model id, and
// a model id always has a colon in it.
const VERDICT = 'verdict';

// One shared empty array, so a panel with no transcript yet keeps a stable
// prop and stays memoized like the rest.
const NO_TURNS = [];

// Static strings so Tailwind keeps these classes; four models read best as 2x2.
const GRID_COLUMNS = {
  1: 'grid-cols-1',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-2 xl:grid-cols-3',
  4: 'md:grid-cols-2',
};

const isBoolean = (value) => typeof value === 'boolean';
const isString = (value) => typeof value === 'string';
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export default function App() {
  const catalogue = useCatalogue();
  const { available, providers, groups, selected, selectedIds } = catalogue;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keySettings, setKeySettings] = useState([]);
  const [dismissed, setDismissed] = useState([]);

  const [system, setSystem] = usePersistentState('multi-llm.system-prompt', '', isString);
  // The Thinking switch: ask models that can reason to do it, and show it.
  const [think, setThink] = usePersistentState('multi-llm.think', false, isBoolean);
  // The model that judges, as the user last picked it.
  const [judgeId, setJudgeId] = usePersistentState('multi-llm.judge', null);
  // Each model's own temperature and answer cap, by model id. Kept for a model
  // whose panel is closed, so it comes back as it was.
  const [modelSettings, setModelSettings] = usePersistentState('multi-llm.model-settings', {}, isPlainObject);
  const [query, setQuery] = useState('');

  const { transcripts, setTranscripts, appendTurn, patchLastTurn } = useTranscripts();
  // One model's comparison of the latest answers: { judge, labels, question,
  // turn }, where labels are the models whose answers it read, in letter order.
  const [verdict, setVerdict] = useState(null);
  const streams = useStreams();
  const { startedAt, busy, streamTurn } = streams;

  // The conversation on screen is saved under this id, which a new chat or an
  // opened comparison replaces.
  const [comparisonId, setComparisonId] = useState(newId);
  const autosave = useAutosave({ id: comparisonId, system, models: selectedIds, transcripts, verdict, busy });
  const history = useHistorySheet({ savedAt: autosave.savedAt });
  const { prompts, savePrompt, removePrompt } = usePrompts();

  // A one-off message above the panels: models a reopened comparison had that
  // are not available now.
  const [notice, setNotice] = useState(null);

  const anyRunning = selected.some((model) => startedAt[model.id]) || Boolean(startedAt[VERDICT]);
  // The answers a verdict would compare, and the model that would judge them:
  // the one last picked, while it is still available, or else the first panel's.
  const exchange = useMemo(() => latestExchange(selected, transcripts), [selected, transcripts]);
  const judge = available.find((model) => model.id === judgeId) ?? selected[0] ?? null;
  // Checked against each model's provider, and memoized so a panel's settings
  // keep their identity while another panel streams.
  const panelSettings = useMemo(
    () => Object.fromEntries(selected.map((model) => [model.id, cleanSettings(modelSettings[model.id], model.provider)])),
    [selected, modelSettings],
  );
  const changeSettings = useCallback(
    (modelId, change) => setModelSettings((all) => ({ ...all, [modelId]: change(all[modelId] ?? {}) })),
    [setModelSettings],
  );

  // A provider that failed and has nothing to offer would otherwise vanish from
  // the picker without saying why — the usual case being Ollama not running.
  const warnings = providers.filter(
    (provider) => provider.error && provider.count === 0 && !dismissed.includes(provider.id),
  );

  const loadSettings = useCallback(async () => {
    try {
      setKeySettings(await fetchSettings());
    } catch (error) {
      console.error('Could not read settings:', error);
    }
  }, []);

  //
  // History.
  //
  /** Put a saved comparison back in the panels, to read or to carry on. */
  async function openComparison(id) {
    let comparison;
    try {
      comparison = await getComparison(id);
    } catch (error) {
      history.setError(error.message);
      return;
    }

    streams.nextConversation();
    autosave.markSaved(comparison);
    setComparisonId(comparison.id);
    setTranscripts(comparison.transcripts);
    setVerdict(comparison.verdict ?? null);
    setSystem(comparison.system);

    // Its panels come back where their models still exist. The rest keep their
    // answers, and show again if that model comes back.
    const reachable = comparison.models.filter((modelId) => available.some((model) => model.id === modelId));
    if (reachable.length > 0) catalogue.select(reachable);
    const missing = comparison.models.filter((modelId) => !reachable.includes(modelId));
    setNotice(
      missing.length > 0
        ? `Not available right now: ${missing.join(', ')}. Their answers are kept, and show again when they are back.`
        : null,
    );
    history.hide();
  }

  async function removeComparison(id) {
    try {
      await deleteComparison(id);
    } catch (error) {
      history.setError(error.message);
      return;
    }
    // Deleting the one on screen clears it, or the next answer would save it
    // straight back.
    if (id === comparisonId) newChat();
    history.forget(id);
  }

  function newChat() {
    streams.nextConversation();
    autosave.markSaved(null);
    setComparisonId(newId());
    setTranscripts({});
    setVerdict(null);
    setNotice(null);
  }

  //
  // Settings. A key change can add or remove a whole provider's worth of
  // models, so the catalogue is re-read quietly afterwards.
  //
  function applyProvider(updated) {
    setKeySettings((prev) => prev.map((provider) => (provider.id === updated.id ? updated : provider)));
    catalogue.reload({ quiet: true });
  }

  /** Ask one model, streaming its answer into the newest turn of its panel. */
  function ask(model, messages) {
    return streamTurn({
      key: model.id,
      model,
      messages,
      system,
      think,
      settings: panelSettings[model.id],
      begin: (turn) => appendTurn(model.id, turn),
      update: (patchTurn) => patchLastTurn(model.id, patchTurn),
    });
  }

  /**
   * Ask the judging model to compare the latest answers. They go to it by
   * letter, never by model, and the letters are kept with what it says.
   */
  function compare() {
    if (!exchange || !judge || anyRunning) return;
    const labels = exchange.answers.map((answer) => answer.model.id);
    streamTurn({
      key: VERDICT,
      model: judge,
      messages: [{ role: 'user', content: buildJudgePrompt(exchange) }],
      system: JUDGE_SYSTEM,
      think,
      begin: (turn) => setVerdict({ judge: judge.id, labels, question: exchange.question, turn }),
      update: (patchTurn) =>
        setVerdict((current) => current && { ...current, turn: { ...current.turn, ...patchTurn(current.turn) } }),
    });
  }

  /**
   * A verdict is about the answers it read, so it goes when one of them is
   * asked again or a new question is sent — stopped first, if it is still
   * being written.
   */
  function dropVerdict() {
    streams.abort(VERDICT);
    setVerdict(null);
  }

  async function send() {
    const text = query.trim();
    if (!text || selected.length === 0) return;
    setQuery('');
    dropVerdict();

    // Snapshot each panel's history before the new turn is appended, so the
    // request carries the conversation up to this question. Every model keeps
    // its own thread — it should only ever see what it said itself.
    const histories = new Map(
      selected.map((model) => [
        model.id,
        [...toMessages(transcripts[model.id] ?? []), { role: 'user', content: text }],
      ]),
    );

    selected.forEach((model) => appendTurn(model.id, { role: 'user', text }));

    // Every model starts now. Wall time is the slowest model, not the sum of
    // all of them, and one model failing does not hold up the others.
    await Promise.allSettled(selected.map((model) => ask(model, histories.get(model.id))));
  }

  /**
   * Ask one model its last question again, in place of the answer it gave —
   * after a rate limit, a timeout or a stopped answer, or for a second try. The
   * panels beside it are left alone, and are not billed a second time.
   */
  function retry(model) {
    const turns = transcripts[model.id] ?? [];
    const question = turns.findLastIndex((turn) => turn.role === 'user');
    if (question === -1 || startedAt[model.id]) return;

    const kept = turns.slice(0, question + 1);
    setTranscripts((prev) => ({ ...prev, [model.id]: kept }));
    dropVerdict();
    ask(model, toMessages(kept));
  }

  // Panels are memoized, so a handler passed to one has to keep its identity
  // from render to render, yet still see the latest transcripts when it runs.
  const latestRetry = useRef(retry);
  useLayoutEffect(() => {
    latestRetry.current = retry;
  });
  const onRetry = useCallback((model) => latestRetry.current(model), []);

  // Stable, so a panel streaming tokens does not re-render the ones beside it.
  const copy = useCallback((text) => {
    navigator.clipboard.writeText(text).catch((error) => {
      console.error('Failed to copy text:', error);
    });
  }, []);

  const exportMarkdown = () => withVerdict(buildMarkdown(selected, transcripts, system), verdict);

  return (
    <div className="flex h-full flex-col">
      <Navbar
        onOpenHistory={history.show}
        onExport={() => downloadText(exportFilename(), exportMarkdown())}
        onCopyAll={() => copy(exportMarkdown())}
        onOpenSettings={() => {
          loadSettings();
          setSettingsOpen(true);
        }}
      />

      <main className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-4 p-4">
        {warnings.map((provider) => (
          <Banner
            key={provider.id}
            text={provider.error}
            dismissLabel={`Dismiss ${provider.label} warning`}
            onDismiss={() => setDismissed((prev) => [...prev, provider.id])}
          />
        ))}
        {autosave.error && <Banner text={autosave.error} onDismiss={autosave.dismissError} />}
        {notice && <Banner text={notice} onDismiss={() => setNotice(null)} />}

        <ContextBar
          value={system}
          onChange={setSystem}
          think={think}
          onThinkChange={setThink}
          onClear={newChat}
          canClear={Object.values(transcripts).some((turns) => turns.length > 0)}
          prompts={prompts}
          onSavePrompt={savePrompt}
          onDeletePrompt={removePrompt}
        />

        {groups.length > 0 && <ModelPicker groups={groups} selected={selectedIds} onToggle={catalogue.toggle} />}

        {catalogue.error ? (
          <CenteredNotice
            tone="error"
            message={catalogue.error}
            hint="The API server is not answering. Check that it is running."
            action={{ label: 'Retry', onClick: () => catalogue.reload() }}
          />
        ) : catalogue.loading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <p className="text-sm text-slate-400">Looking for available models…</p>
          </div>
        ) : available.length === 0 ? (
          <CenteredNotice
            tone="empty"
            message="No models available yet."
            hint="Start Ollama for local models, or add a cloud API key in Settings."
            action={{ label: 'Open Settings', onClick: () => setSettingsOpen(true) }}
          />
        ) : (
          <div className={`grid min-h-0 flex-1 gap-4 ${GRID_COLUMNS[selected.length] ?? GRID_COLUMNS[2]}`}>
            {selected.map((model) => (
              <ModelPanel
                key={model.id}
                model={model}
                turns={transcripts[model.id] ?? NO_TURNS}
                startedAt={startedAt[model.id]}
                settings={panelSettings[model.id]}
                onCopy={copy}
                onRetry={onRetry}
                onSettingsChange={changeSettings}
              />
            ))}
          </div>
        )}

        {available.length > 0 && (
          <VerdictPanel
            verdict={verdict}
            canCompare={Boolean(exchange && judge) && !anyRunning}
            startedAt={startedAt[VERDICT]}
            groups={groups}
            judgeId={judge?.id}
            onJudgeChange={setJudgeId}
            onCompare={compare}
            onCopy={() => verdict && copy(verdictToMarkdown(verdict))}
            onRemove={dropVerdict}
          />
        )}

        <QueryBar
          value={query}
          onChange={setQuery}
          onSend={send}
          onStop={streams.stop}
          running={anyRunning}
          disabled={selected.length === 0}
          prompts={prompts}
          onSavePrompt={savePrompt}
          onDeletePrompt={removePrompt}
        />
      </main>

      <HistoryPanel
        open={history.open}
        items={history.items}
        loading={history.loading}
        error={history.error}
        activeId={comparisonId}
        query={history.query}
        onQuery={history.search}
        onOpen={openComparison}
        onDelete={removeComparison}
        onClose={history.hide}
      />

      <SettingsModal
        open={settingsOpen}
        providers={keySettings}
        onClose={() => setSettingsOpen(false)}
        onSave={async (provider, apiKey) => applyProvider(await saveKey(provider, apiKey))}
        onClear={async (provider) => applyProvider(await clearKey(provider))}
        onTest={testKey}
      />
    </div>
  );
}

function Banner({ text, onDismiss, dismissLabel = 'Dismiss' }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <span aria-hidden="true">⚠️</span>
      <span className="flex-1">{text}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={dismissLabel}
        className="rounded px-1 text-amber-500 transition hover:text-amber-900"
      >
        ✕
      </button>
    </div>
  );
}

const TONE = {
  error: 'border-red-200 bg-red-50 text-red-700',
  empty: 'border-slate-200 bg-slate-50 text-slate-600',
};

function CenteredNotice({ tone, message, hint, action }) {
  return (
    <div
      className={`flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-xl border p-8 text-center ${TONE[tone]}`}
    >
      <p className="text-sm font-medium">{message}</p>
      <p className="max-w-md text-xs opacity-80">{hint}</p>
      <button
        type="button"
        onClick={action.onClick}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
      >
        {action.label}
      </button>
    </div>
  );
}
