# ⛄️ Multi LLM Tool

Ask several local [Ollama](https://ollama.com) models the same question at once
and compare their answers side by side.

<img src="images/multi-screen-llama-25-4-2024.png">

For a longer explanation of the why/how/when:
https://greenido.wordpress.com/2024/04/08/the-power-of-many-why-you-should-consider-using-multiple-large-language-models/

## What it does

- **Up to four models at once.** They all start together, so you wait for the
  slowest one rather than for the sum of all of them.
- **Whatever you have pulled.** The model list comes from Ollama itself, so a
  newly pulled model shows up in the picker with no code change.
- **Streams as it generates,** with a live timer per model and a final duration
  on every answer — the numbers you actually want when comparing models.
- **Stop** abandons a run and keeps whatever streamed in so far.
- **A real conversation per model.** Follow-up questions work, and each model
  only ever sees its own thread.
- **A system prompt** applied to every model, so you compare them under the
  same instruction.
- Answers render as markdown — tables, fenced code and lists read as
  themselves. Copy and export give you the raw text.

## Requirements

- Node 20.19 or newer
- [Ollama](https://ollama.com) running locally with at least one model pulled:

```bash
ollama serve
```

```bash
ollama pull llama3
```

## Run it

```bash
npm install
```

Development — Vite on `:5173` for the UI, the API on `:3000`, both at once:

```bash
npm run dev
```

Then open http://localhost:5173.

Production — one server on `:3000` serving the built bundle and the API:

```bash
npm run build && npm start
```

## Tests

```bash
npm test
```

Unit tests cover the transcript and history logic, the model registry, the
streaming NDJSON parser and the storage wrapper. The server tests boot the real
server and cover request validation and the unreachable-daemon paths, so they
need no Ollama.

## Configuration

All optional.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | Port the API listens on. |
| `OLLAMA_URL` | `http://localhost:11434` | Where to reach Ollama. |
| `QUERY_TIMEOUT_MS` | `120000` | Abort a model that never finishes. |
| `NODE_ENV` | — | Set to `production` to serve `dist/`. |

## How it is put together

```
index.html          Vite entry
src/App.jsx         state: models, selection, transcripts, in-flight requests
src/components/     Navbar, ContextBar, ModelPicker, ModelPanel, QueryBar, Markdown
src/lib/            models (registry), transcript (history), stream (NDJSON),
                    duration, storage
server.mjs          Express API: GET /api/models, POST /query
test/               node:test suites
```

The server keeps no per-user state. The browser owns the conversation and sends
it whole with each request, so two tabs cannot clobber each other.

`POST /query` takes `{ model, messages, system }` and replies with
newline-delimited JSON:

```
{"type":"chunk","text":"..."}    zero or more
{"type":"done"}                  or {"type":"error","error":"..."}
```

## Ideas / not done yet

- [x] Add timers per model
- [x] Add more models and a way to select them
- [x] Enable to export to file
- [x] Stream responses instead of waiting for the whole completion
- [x] Keep conversation history so follow-ups work
- [ ] Add more query options / pre-defined queries
- [ ] Save and reload past comparisons
- [ ] Show tokens/sec alongside the wall-clock timer
- [ ] Allow to leverage [llama_index](https://github.com/run-llama/llama_index)

## License

MIT

## Got an idea? Questions?

🏂 Feel free to open an issue or contact: [https://x.com/greenido](https://x.com/greenido)
