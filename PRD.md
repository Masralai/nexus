# PRD — Nexus: BYOK Coding Agent

## Problem Statement

Building a terminal AI coding agent (like Claude Code / Codex / opencode) typically means
surrendering to a vendor's account, subscription, and hosted routing. A developer who
already holds API keys cannot point an off-the-shelf agent CLI at their own key and their
own endpoint (OpenRouter, Ollama, DeepSeek, Groq, etc.) without a fork or a brittle
wrapper. The result is either a walled-garden tool or a half-built script that stops at
"call the model once."

## Solution

A **bring-your-own-API-key (BYOK) coding agent** in TypeScript on Bun. A
model-agnostic agent engine (the loop, context management, sessions, permissions, tools)
with a terminal UI and a headless scriptable `run` command. One OpenAI-compatible adapter
covers the broad market (OpenRouter/Groq/Together/Ollama/vLLM/DeepSeek…), plus an
Anthropic adapter for Claude. The user supplies the key; Nexus provides the runtime.

## User Stories

1. As a developer with an OpenAI-compatible key, I want to run Nexus with just
   `OPENAI_API_KEY` set, so that I can start coding without any account or setup.
2. As a developer with an Anthropic key, I want to run Nexus with just
   `ANTHROPIC_API_KEY` set, so that Claude works out of the box.
3. As a developer with a self-hosted endpoint (Ollama/vLLM), I want to point Nexus
   at a custom `OPENAI_BASE_URL`, so that I can use my own local models.
4. As a developer, I want to give Nexus a task like `nexus run "fix the failing
   test in src/"`, so that it can plan and execute multi-step work autonomously.
5. As a developer, I want Nexus to read, write, and edit files in my working
   directory, so that it can make real code changes rather than only chatting.
6. As a developer, I want Nexus to run shell commands, so that it can build, test,
   and inspect the repo as part of its work.
7. As a developer, I want to be asked before every shell command executes, so that I
   retain control over what runs on my machine.
8. As a developer, I want parallel read-only tools (Read/Glob/Grep) with sequential
   mutators (Write/Edit/Bash), so that the agent works fast without corrupting state.
9. As a developer, I want Nexus to stream model output and tool activity live, so
   that I can watch and interrupt its progress.
10. As a developer, I want a TUI with a transcript, tool-activity panel, permission
    prompts, and a context/status bar, so that I can supervise the agent comfortably.
11. As a developer, I want the agent loop to stop after `maxSteps` (default 50) tool
    calls, so that runaway loops terminate.
12. As a developer, I want long tool outputs to be truncated (e.g. `[...truncated]`), so
    that the context window stays under budget.
13. As a developer, I want a structured working-memory message kept up to date each turn,
    so that the model retains task state even as the transcript grows.
14. As a developer, I want prompt caching respected (Anthropic `cache_control`, OpenAI
    automatic), so that long sessions stay cheap.
15. As a developer, I want every session persisted incrementally to JSONL, so that a
    crash or CTRL-C never loses completed work.
16. As a developer, I want `nexus resume <id>` to continue an interrupted session, so
    that I can pick up where the agent stopped.
17. As a developer, I want configuration in `~/.nexus.json` with env vars overriding,
    so that defaults are stable but keys stay out of config when I prefer.
18. As a developer, I want `--model` to override the configured model, so that I can
    switch models per run.
19. As a developer, I want clear exit codes (0 done / 1 error / 2 aborted), so that I can
    script Nexus in CI.
20. As a developer, I want `--yes` headless auto-approval of permissions, so that I can
    run Nexus unattended when I trust the task.
21. As a developer, I want `nexus self-test` to smoke-test my key/endpoint manually, so
    that I can verify configuration without running a full task.
22. As a maintainer, I want the engine to be event-driven, so that both the TUI and the
    headless CLI are interchangeable subscribers.
23. As a maintainer, I want the provider layer to be a single narrow interface, so that
    adding a new endpoint is one adapter, not a fork.
24. As a maintainer, I want a mock provider for tests, so that the loop is testable
    deterministically without network or cost.

## Implementation Decisions

### Modules (deep, tested in isolation)
- **Agent loop** — `run(session, tools, provider) → AsyncIterable<Event>`; owns
  `maxSteps`, "no tool_use = done" termination, transcript replay, incremental JSONL
  writes per turn.
- **Context manager** — working-memory construction/update, per-tool-result truncation,
  per-message token tracking, `context: { used, limit, pct }` exposed after each append.
- **Session store** — append-only JSONL at `~/.nexus/sessions/<id>.jsonl`; `save` /
  `load(id)`; resume = replay.
- **Permission core** — pure policy: `ask(tool, input) → allow | deny | ask`; default
  **ask on every Bash**; allow/deny/ask rules with allowlist/denylist patterns; the
  decision lives in the engine, invoked via `ToolContext.requirePermission`.
- **Tool scheduler** — parallel reads, sequential mutators, deterministic ordering.
- **Provider adapters** — `mock`, `openai-compatible`, `anthropic`; streaming-first,
  canonical message translation, `contextWindow`, `supportsCaching`, prompt-caching
  markers.

### Key interfaces
- `Provider` — `{ id, contextWindow, supportsCaching, stream(messages, tools, opts) }`.
- `Tool` — `{ name, description, schema, execute(input, ctx) }`;
  `ctx` carries `cwd`, read-only transcript, truncation budget, `requirePermission`.
- Canonical messages: `user | assistant (with toolCalls) | tool (toolCallId, result)` —
  lossless and replayable through adapters.

### Architecture
Event-driven engine, not stdout-coupled. Events: `tokenDelta`, `toolCallStarted`,
`toolResult`, `permissionRequest`, `contextUpdate`, `turnComplete`, `runComplete`,
`error`, `aborted`. TUI and headless CLI are both subscribers.

Layout: `src/engine/`, `src/providers/`, `src/tools/`, `src/cli/`, `src/tui/`; tests
colocated per module. Tool set v1: Read, Write, Edit, Bash, Glob, Grep.

No API keys, secrets, or PII in this PRD. Keys live in env vars or `~/.nexus.json`
(env wins). No auto-router; single `provider` + `model` with `--model` override.

## Testing Decisions

A good test exercises **external behavior only** — the event stream the engine emits and
the state it persists — not internal implementation details. Tests are deterministic and
never require network or a real key.

- **Agent loop** — mock provider drives scripted tool calls; assert termination
  (`maxSteps`, no-tool_use), event ordering, working-memory updates, permission-gated
  Bash, interrupted-run resume.
- **Context manager** — truncation boundaries, token accounting after appends, budget
  reporting.
- **Session store** — incremental writes survive interruption; `load` replays a
  transcript losslessly.
- **Permission core** — default ask-on-Bash, allow/deny rules, allowlist/denylist
  patterns.
- **Tool scheduler** — parallel read scheduling, sequential mutator ordering, no races
  on writes.
- **Provider adapters** — mock and recorded fixtures for the two real adapters' streaming
  shapes.

Real-key verification happens only through the manual `nexus self-test` command, never
in CI.

Prior art: standard Bun test runner (`bun test`) colocated with modules; the mock
`Provider` is the backbone fixture for all engine tests.

## Out of Scope

- Hosted routing, accounts, or cloud proxy service
- Multi-model auto-router (provider-gateway territory)
- Sandboxing / containers / seccomp (v2; permission layer only in v1)
- OS keyring integration (v1.1+; env + config only in v1)
- SQLite session store (only if multi-session/analytics needs arise)
- Browser/data agents (engine is model-agnostic, but v1 ships coding tools only)
- Tool marketplace / plugins (v3)
- Compaction via cheap-model summarization (v1.1; working-memory + truncation in v1)

## Further Notes

- TUI is ink (React-based, native fit for Bun/TS), built early so it is demoable against
  the mock provider before real keys are wired.
- `nexus init` interactive setup is v1.1+; single-binary installs via
  `bun build --compile` and `bunx` later.
- Milestones M0–M5 in PLAN.md are the sequencing for this PRD; M0 scaffold is the next
  concrete step.