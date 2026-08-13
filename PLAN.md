# Nexus — Detailed Plan

A **bring-your-own-API-key (BYOK) coding agent**. Model-agnostic
agent engine with a terminal UI, built for coding tasks. TypeScript on Bun.

The north star: a solid agent CLI like Claude Code / Codex / opencode, but the user brings
their own API keys. Engine-first so the agent runtime is a reusable library that a CLI
and a TUI both consume.

---

## 1. Goals & Non-Goals

### Goals
- A coding-agent CLI that can read/write files, run shell commands, and edit repos in the
  working directory.
- A model-agnostic agent runtime (agent loop) that falls out of the CLI as a reusable core.
- Bring-your-own-key: support the dominant provider market with minimal adapter code.
- A TUI visible early, plus a headless scriptable `run` mode.
- An agent that survives interruption: sessions persist, resume works, CTRL-C is safe.

### Non-Goals (v1)
- No cloud account / hosted routing.
- No multi-model "auto-router" (provider-gateway territory — explicitly out).
- No sandboxing/containers in v1 (permission layer only; sandboxing is v2).
- No keyring integration in v1 (env + config file only).
- No browser/data agents (engine is model-agnostic, but v1 ships coding tools only).

---

## 2. Locked Decisions

| Area | Decision |
|---|---|
| Scope | Coding-agent CLI; engine designed so a model-agnostic runtime falls out |
| Runtime | TypeScript on **Bun** (fast startup, single-binary via `bun build --compile`, `bunx` installs) |
| Providers | One **OpenAI-compatible** adapter (covers OpenRouter/Groq/Together/Ollama/vLLM/DeepSeek…) + one **Anthropic** special-case adapter. No official SDK matrix |
| Streaming | Streaming-first (SSE). Streaming tool calls where supported |
| Prompt caching | Respected from day one (Anthropic `cache_control`, OpenAI automatic) |
| Loop | Native tool-calling; canonical internal `Message` / `ToolCall` / `ToolResult`; `maxSteps = 50`; "no tool_use = done" |
| Context | Stage 1: structured working-memory + per-tool-result truncation. Stage 2 (v1.1): compaction via a cheap model |
| Tools | Parallel read tools, sequential mutators; engine-owned permission layer; **ask on every Bash** |
| State | JSONL at `~/.nexus/sessions/<id>.jsonl`, incremental per-turn writes, resume = replay |
| Config | Env-over-config `~/.nexus.json`; single `provider` + `model`, `--model` CLI override |
| Tests | Mock `Provider` as the backbone; recorded fixtures for adapter tests; real-key only via manual `nexus self-test` |
| UI | TUI visible early (ink — React-based, native fit for Bun/TS); headless `run` stays scriptable |

---

## 3. Architecture

```
src/
  engine/          loop, context/working-memory, state/JSONL, events emitter, permission core
  providers/       types.ts (Provider interface), openai-compatible/, anthropic/, mock/
  tools/           fs (Read/Write/Edit), bash, glob/grep; ToolContext, truncation
  cli/             entry, config, commands (run, resume, self-test)
  tui/             ink app — subscriber to engine events
test/              colocated unit tests, mock-driven loop tests
```

### 3.1 The engine is event-driven, not stdout-coupled

The loop emits events through a small emitter. The headless CLI and the TUI are both
subscribers. This is what lets the TUI be built and demoed against the mock provider
before the engine is perfect, and keeps `nexus run` scriptable (machine-readable,
exit-code driven).

**Engine events:**
- `tokenDelta` — streamed model tokens
- `toolCallStarted` — model requested a tool, with its input
- `toolResult` — tool finished (or failed), with a possibly truncated result
- `permissionRequest` — a tool is asking the user to approve (gates Bash)
- `contextUpdate` — token usage / budget percentage after a turn
- `turnComplete` / `runComplete` / `error` / `aborted`

The permission-ask flow is a promise-backed callback: in the TUI it renders an
approve/deny prompt; in headless mode it honors `--yes` or defaults to deny.

### 3.2 Key interfaces

**Provider** — model-agnostic abstraction every adapter implements:
```ts
interface Provider {
  readonly id: string
  readonly contextWindow: number      // per-provider token budget
  readonly supportsCaching: boolean
  stream(
    messages: Message[],
    tools: ToolDefinition[],
    opts: StreamOptions,              // caching markers, budget, signal
  ): AsyncIterable<ProviderEvent>     // token, toolCall, done
}
```

**Tool** — the unit of agency the model can invoke:
```ts
interface Tool {
  name: string
  description: string
  schema: JSONSchema                  // what the model declares
  execute(input: unknown, ctx: ToolContext): Promise<ToolResult>
}
```
`ToolContext` carries `cwd`, a read-only transcript, a token budget for truncating big
results, and `requirePermission(reason)` which the tool calls **before** mutating
anything. The permission decision lives in the engine, never inside a tool.

### 3.3 Canonical message format (lossless & replayable)

The engine's currency. Adapters translate to/from their provider's native shapes. History
must round-trip through an adapter and back losslessly so retries and resume work.

```ts
type Message =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; result: ToolResult }
```

**Loop termination:** hard `maxSteps` (default 50) plus "model returns no tool_use = done".

---

## 4. Context Management

**Stage 1 (v1): structured working-memory + per-tool-result truncation.**
- The engine maintains a compact **working-memory message** (task state, key facts, file
  list) rewritten each turn — models handle *structured* context better than *more* context.
- Every tool result is truncated at the tool level (e.g. cap a `Bash` output at N lines
  with a `[...truncated]` marker) so big outputs never blow the budget raw.
- The loop tracks approximate tokens per message and exposes
  `context: { used, limit, pct }` in state so the UI and compaction can act on it.
- Budget is per-provider: `Provider.contextWindow`; usage recomputed after each append,
  not just at start.

**Stage 2 (v1.1): compaction.**
- When over budget, ask a *cheap* model to compress the conversation into a condensed
  "prior context" message, then continue. Extra call cost, preserved intent.

**Prompt caching respected from day one:** Anthropic `cache_control` markers and OpenAI's
automatic caching, so the growing transcript stays cheap on long sessions.

---

## 5. Tool Layer

v1 tool set (coding tasks):
- `Read` — read a file (supports offsets/limits)
- `Write` — create/overwrite a file (permission-gated)
- `Edit` — targeted string replacement in a file (permission-gated)
- `Bash` — run a shell command in `cwd` (permission-gated, **ask always** by default)
- `Glob` — file pattern search
- `Grep` — content regex search

**Scheduling:** read tools (`Read`/`Glob`/`Grep`) run in parallel; mutators
(`Write`/`Edit`/`Bash`) run one at a time, in order, to avoid race conditions.

**Safety posture (v1):** engine-owned permission layer. Default stance is **ask on every
Bash**; permission rules (allow/deny/ask per tool, allowlist/denylist patterns) are
configurable. Sandboxing (containers/seccomp) is explicitly **v2**.

---

## 6. State & Sessions

- **Storage:** append-only JSONL per session at `~/.nexus/sessions/<id>.jsonl`.
- **Contents per line:** canonical `Message[]` entries + `sessionId`, `cwd`, `model`,
  `provider`, `createdAt`, `status`.
- **Writes:** incremental — written after every turn, so a crash/CTRL-C interrupts at the
  last completed turn and resumes cleanly.
- **Resume = replay:** reload the transcript, re-attach the tool registry + `cwd`,
  continue the loop. Depends on the lossless-transcript guarantee from §3.3.
- SQLite is a v2 upgrade only if multi-session/analytics needs arise.

---

## 7. Config & Keys

- **`~/.nexus.json`** holds: `provider`, `model`, `maxSteps`, permission rules, cwd
  defaults, and optionally API keys.
- **Env vars override config** and are the recommended key home: `ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`, plus `OPENAI_BASE_URL` for custom endpoints (Ollama/OpenRouter/etc.).
- **Single model selection:** `provider` + `model` in config, overridden by
  `--model` on the CLI. No auto-router.
- `harness init` (interactive key/config setup) is replaced by the shell `/key` flow.
  Credentials live in `~/.nexus/credentials.json` (`0600`); env API keys still win.
---

## 8. Testing Strategy

- **Mock `Provider`** is the backbone: implements the same `Provider` interface and
  returns scripted tool calls. Tests every loop behavior deterministically with zero
  network and zero cost:
  - loop termination (`maxSteps`, no-tool_use = done)
  - permission flow (ask/deny/allow)
  - truncation and working-memory updates
  - parallel-read scheduling and mutator ordering
  - session persistence and resume
  - CTRL-C / interrupted-run resume
- **Recorded fixtures** for adapter-level tests of the two real providers' streaming
  shapes (added once real adapters land).
- **Real-key integration** only via a manual `nexus self-test` command, never in CI.
- Repo layout keeps tests colocated per module.

---

## 9. CLI Surface

```
nexus run "task"          # run the loop against configured provider; streams to stdout
nexus run --model <m>     # override model
nexus run --yes           # auto-approve permissions (headless)
nexus resume <id>         # resume a session from its JSONL
nexus self-test           # manual real-key smoke test
```

**Exit codes:** `0` done · `1` error · `2` user-aborted. Session survives CTRL-C.

---

## 10. TUI (ink)

- Streaming transcript panel
- Tool activity panel (what the model is doing, inputs)
- Permission prompt (approve/deny — driven by the same engine permission layer)
- Context/status bar (tokens used / budget, steps used, model)
- Demoable against the mock provider *and* real keys from M4 onward

---

## 11. Milestones

**M0 — Scaffold**
- Bun project, tsconfig, CLI entry, config loader (`~/.nexus.json`, env override),
  `--model` plumbing, `AGENTS.md`-style dev conventions.

**M1 — Engine core (mock-first)**
- Canonical types (`Message`/`ToolCall`/`ToolResult`), `Provider` interface + Mock
  provider, agent loop (`maxSteps`, stop condition), event emitter, JSONL persistence
  with incremental writes.

**M2 — Tools + permissions**
- Read/Write/Edit/Bash/Glob/Grep; parallel-read / sequential-mutate scheduler;
  `requirePermission` (ask on Bash); result truncation; structured working-memory message.

**M3 — Real providers**
- OpenAI-compatible adapter, Anthropic adapter; streaming; prompt-caching markers;
  context-window budgeting. Mock stays for tests.

**M4 — TUI**
- ink app: transcript, tool activity, permission prompt, context/status bar. Demoable
  against mock *and* real keys.
- **Persistent shell** (`nexus` no args): multi-turn chat, slash commands `/key` `/model`
  `/resume` `/new` `/help` `/quit`; credentials in `~/.nexus/credentials.json`.

**M5 — CLI surface**
- `nexus run`, `nexus resume <id>`, `nexus self-test`, exit codes (0/1/2),
  CTRL-C → session survives.

**v1.1+**
- Compaction (cheap-model), shell `/key` credentials, installers (compile / bunx), recorded
  fixtures + CI. Spec: [specs/v1.1.md](specs/v1.1.md).
- Sandboxing (containers/seccomp) is **v2** — see §12 (not v1.1).

---

## 12. Open Items (explicitly deferred)

- SQLite session store — only if multi-session/analytics need arises
- Tool marketplace / plugins — v3
- OS keyring integration — until asked for
- Sandboxing (containers/seccomp) — v2
- Recorded fixture suite for adapters — M3+