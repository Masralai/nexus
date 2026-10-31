<div align="center">

```
 ███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗
 ████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝
 ██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗
 ██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║
 ██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║
 ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝
```

# Nexus

**Terminal-first, model-agnostic harness for software development.**

[![CI](https://img.shields.io/github/actions/workflow/status/masralai/nexus/ci.yml?style=flat-square&label=CI)](https://github.com/masralai/nexus/actions)
![Bun](https://img.shields.io/badge/Bun-%3E%3D1.0-black?style=flat-square&logo=bun)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Node](https://img.shields.io/badge/Node-%3E%3D20-3c873a?style=flat-square&logo=node.js&logoColor=white)

*One binary. Any provider. Durable sessions in SQLite.*

[Overview](#overview) • [Quick start](#quick-start) • [Installation](#installation) • [Usage](#usage) • [Configuration](#configuration) • [Architecture](#architecture) • [Troubleshooting](#troubleshooting)

</div>

---

## Overview

Nexus is a BYOK agent harness that runs **Turns** against a **Provider** with an optional workspace **Tool** layer and durable **Sessions**. It is not a hosted platform — your terminal is the interface, your keys stay local, and sessions live in a local SQLite database with typed message parts.

Use it as an interactive shell for day-to-day coding or as a headless one-shot runner in CI. The same **Turn launcher** powers both (`src/cli/launch.ts:27`).

> [!TIP]
> No account required. Credentials live in `~/.nexus/credentials.json` and env vars always win over the file (`src/cli/config.ts:86`).

## Features

- **Model-agnostic** — Anthropic, OpenAI, Gemini, OpenRouter, Groq, DeepSeek, xAI, Mistral, Cohere, Ollama via one config (`src/providers/presets.ts`)
- **Two agent modes** — `plan` (read-only, auto-allowed) and `build` (full tools with approval)
- **Permission gate** — readonly tools inside the session cwd are auto-allowed; `write`/`edit`/`bash` and paths outside cwd always ask (`src/engine/permission.ts:17`)
- **Six focused tools** — `read`, `write`, `edit`, `bash`, `list`, `glob`, `grep`, plus patch, snapshots, jobs, LSP, sub-agents, and git worktrees (`src/tools/index.ts`)
- **Durable sessions** — SQLite at `~/.nexus/nexus.db` with typed parts, revert/fork, JSON/Markdown export and import, and a one-time legacy JSONL migration (`src/engine/sqlite.ts`, `nexus migrate`)
- **Real prompt architecture** — policy and environment in the provider system channel, layered `AGENTS.md` discovery, per-tool truncation, pairing-safe compaction, and generated Session titles (`src/engine/prompt.ts`, `src/engine/instructions.ts`, `src/engine/compact.ts`, `src/engine/title.ts`)
- **Steering and accounting** — input typed during a Turn is queued and applied at the next provider boundary; every Session exposes token, cache and cost counters plus its effective catalog entry
- **Skills** — reusable instruction packs from `.agents/skills` injected into context (`src/skills/index.ts:87`)
- **Commands, agents, and plugins** — config-defined slash commands, custom agent prompts/tool sets, and isolated local plugin modules (`src/cli/commands.ts`, `src/plugins/load.ts`)
- **Ink TUI** — live turn view, stream viewport, mouse wheel scroll, permission picker (`src/tui/shell.tsx:44`)

## Prerequisites

- [Bun](https://bun.sh) >= 1.0 (runtime + package manager)
- An API key for at least one provider (or a local Ollama instance — no key needed)

## Installation

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/masralai/nexus/main/scripts/install.sh | sh
# -> ~/.local/bin/nexus  (add to PATH if prompted)
nexus --version
```

Custom repo or mirror:

```bash
NEXUS_INSTALL_REPO=myorg/nexus sh web/install.sh
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/masralai/nexus/main/scripts/install.ps1 | iex
# -> %USERPROFILE%\.local\bin\nexus.exe
nexus --version
```

### Without installing

```bash
bunx --package masralai/nexus nexus --help
# or from source
git clone https://github.com/masralai/nexus
cd nexus
bun install
bun run src/cli/main.ts --help
```

### Build a standalone binary

```bash
bun install
bun run build:compile   # -> dist/nexus
./dist/nexus --help
```

> [!NOTE]
> Releases publish `nexus-linux-amd64` on every `v*` tag via `.github/workflows/release.yml:18`.

## Quick start

```bash
# 1. Launch the shell
nexus

# 2. Inside the shell, connect a provider
/key          # picker: Anthropic / OpenAI / Gemini / OpenRouter / Groq / DeepSeek / Ollama / Other
# paste API key when prompted -> saved to ~/.nexus/credentials.json (mode 600)

# 3. Pick a model
/model        # choose from preset suggestions or type a custom id

# 4. Run a task
# type in the composer and press Enter — or headless:
nexus run "add tests for session resume" --yes
```

> [!IMPORTANT]
> Env vars override the credentials file. Set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, etc. to avoid writing keys to disk.

## Usage

### Interactive shell

```bash
nexus                 # opens the Ink shell in the current directory
```

Composer keys: `Enter` send, `Up`/`Down` history, `Ctrl+U`/`Ctrl+D` or mouse wheel to scroll, `Shift+Tab` toggle plan/build, `Ctrl+C` abort turn (second press exits). While a Turn runs, keep typing and press `Enter` to steer; the line is queued and applied at the next safe boundary.

Slash commands (`src/tui/slash.ts:7`):

| Command | Description |
|---------|-------------|
| `/key` | Connect provider + API key |
| `/model` | Set model (preset suggestions + custom) |
| `/skill [name\|clear]` | Activate a skill; bare `/skill` opens searchable picker |
| `/skills` | Alias for `/skill` |
| `/agent [name]` | Select a config-defined custom agent |
| `/{skill-id}` | Activate a skill directly by id (e.g. `/tdd`) |
| `/plan` | Switch to read-only plan mode |
| `/build` | Switch to build mode (full tools) |
| `/resume` | Continue a past session |
| `/new` | Start a fresh session |
| `/help` | List commands |
| `/quit`, `/exit` | Exit |

Skills are discovered from (first match wins) `src/skills/index.ts:16`:

```
./.agents/skills  >  ~/.agents/skills  >  ~/.claude/skills  >  ~/.cursor/skills-cursor
```

Activate via `/skill`, `/skills` picker (searchable), or `/{skill-id}` when the id matches a discovered skill.

### One-shot and headless

```bash
# Interactive TUI (default when stdout is a TTY)
nexus run "explain the permission gate"

# Headless — streams tokens to stdout, no prompts
nexus run "refactor src/tools/index.ts" --yes

# Specify model and resume
nexus run "continue the refactor" --model gpt-4o --yes
nexus resume <session-id> --yes

# Check provider connectivity
nexus self-test --model claude-sonnet-4-20250514
```

Exit codes: `0` done, `1` error, `2` aborted, `3` step limit reached (`src/cli/run.ts`). A step-limited session is persisted with status `limit`.

`--yes` (or piping / non-TTY) auto-approves permission asks. Without it, the gate yields `permissionRequest` events and the TUI shows a picker (`src/tui/permission-gate.tsx`).

### Resume

```bash
nexus resume 5467a7c8-...          # exact session id
# or inside the shell
/resume                            # picker sorted by createdAt desc
```

Sessions live in SQLite at `~/.nexus/nexus.db` (override with `NEXUS_DB`). Each message is stored as typed parts (`text`, `tool_call`, `tool_result`, `compaction`). Existing JSONL sessions are imported once with `nexus migrate [dir]` (default `~/.nexus/sessions`).

### Revert, fork, and export

```bash
nexus export <id>                        # JSON to stdout (round-trip format)
nexus export <id> --format markdown      # human-readable transcript
nexus export <id> --out session.json
nexus import session.json                # idempotent: existing ids are skipped
nexus revert <id> [--at <message-id>]    # drop that message and everything after it
nexus fork <id> [--at <message-id>]      # branch before a boundary; prints the new id
```

HTTP clients use the same capabilities: `POST /api/session/:id/revert`, `POST /api/session/:id/fork`, `GET /api/session/:id/export`, `POST /api/session/import`, `GET /api/session/:id/usage` and `GET /api/session/:id/message` (messages carry stable `id` fields).

## Configuration

### Config file

`~/.nexus.json` (`src/cli/config.ts:30`):

```json
{
  "provider": "openai-compatible",
  "preset": "openai",
  "model": "gpt-4o",
  "maxSteps": 50,
  "compactModel": "gpt-4o-mini",
  "compactThreshold": 0.8,
  "baseUrl": "https://api.openai.com/v1",
  "commands": {
    "review": "Review $ARGUMENTS for bugs and missing tests",
    "release": { "template": "Prepare release $1", "description": "release checklist", "agent": "release" }
  },
  "agents": {
    "release": {
      "description": "Conservative release engineer",
      "mode": "plan",
      "tools": ["read", "grep", "glob", "task"],
      "prompt": "Never mutate files without explicit approval."
    }
  },
  "plugins": ["./plugins/example.ts"]
}
```

| Field | Env override | Default |
|-------|--------------|---------|
| `provider` | `NEXUS_PROVIDER` (custom presets only) | derived from preset |
| `preset` | `NEXUS_PRESET` | `openai` |
| `model` | `NEXUS_MODEL` / `--model` | `""` (provider default) |
| `maxSteps` | `NEXUS_MAX_STEPS` | `50` |
| `compactModel` | `NEXUS_COMPACT_MODEL` | smallest suggested model for the active preset |
| `compactThreshold` | `NEXUS_COMPACT_THRESHOLD` | `0.8` |
| `titleModel` | — | `compactModel` |
| `autoTitle` | — | `true` |
| `baseUrl` | `NEXUS_BASE_URL` (custom endpoints) | per preset |

### Presets and providers

`src/providers/presets.ts:13`:

| Preset | Adapter | Base URL | Suggested models |
|--------|---------|----------|------------------|
| `anthropic` | `anthropic` | Anthropic API | `claude-sonnet-4-20250514`, `claude-opus-4-20250514` |
| `openai` | `openai-compatible` | `https://api.openai.com/v1` | `gpt-4o`, `gpt-4o-mini`, `o3-mini` |
| `gemini` | `openai-compatible` | `https://generativelanguage.googleapis.com/v1beta/openai/` | `gemini-2.5-pro`, `gemini-2.5-flash` |
| `openrouter` | `openai-compatible` | `https://openrouter.ai/api/v1` | `anthropic/claude-sonnet-4`, `openai/gpt-4o` |
| `groq` | `openai-compatible` | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` |
| `deepseek` | `openai-compatible` | `https://api.deepseek.com/v1` | `deepseek-chat`, `deepseek-reasoner` |
| `ollama` | `openai-compatible` | `http://127.0.0.1:11434/v1` | `llama3.2`, `qwen2.5-coder` |

`Other` lets you enter a custom id + base URL for any OpenAI-compatible endpoint.

### Credentials

`~/.nexus/credentials.json` (`src/cli/credentials.ts:12`, mode `600`):

```json
{
  "openai": { "apiKey": "sk-...", "baseUrl": "https://api.openai.com/v1" },
  "anthropic": { "apiKey": "sk-ant-..." }
}
```

Resolution order per preset `envKeys`: env var first (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`, etc.), then credentials file. Keys are scoped to the active preset and never borrowed across providers. The `mock` provider needs no key.

**Instructions.** Discovery loads global `AGENTS.md`, then project files from the repository root toward the working directory, plus `@`-imports and configured `instructions` paths/URLs. Relative configured paths resolve from the `.nexus.json` that declared them. Auto-discovery of nearby subtree `AGENTS.md` files when a file is read is planned for M3.

## Architecture

```
Session (SQLite) ──► Turn launcher (src/cli/launch.ts) ──► Turn (src/engine/loop.ts)
                        │ provider + compactProvider               │
                        │ registry (Tools)                         │ stream tokens + toolCalls
                        │ config + store                           ▼
                        └─────────────────────────────────► Permission gate (src/engine/permission.ts:50)
                                                               allow / deny / ask
                                                                   │
                                                          Tool execute ──► Session append
                                                                   │
                                                          Context assembly + maybeCompact
```

A **Session** holds many **Messages** and is advanced by **Turns**. Each Turn builds a system channel from policy, environment, instructions, and skills, streams from the Provider with the durable history, gates every tool call, executes all Tool calls in parallel in one step (optimistic, provider-ordered), and appends results as typed parts.

Key seams:

- **Turn launcher** — single place that builds provider, compact provider, registry, and store (shared by shell and CLI).
- **Permission gate** — single decision per tool call (`decide()` + `gateToolCall()`); readonly inside cwd → allow, `bash`/outside cwd → ask, denied tools → deny.
- **Agent mode** — `plan` advertises only readonly tools and denies `write`/`edit`/`bash` (`src/engine/mode.ts:6`); `build` advertises all.
- **Prompt assembly** — the system channel + per-tool truncation are prompt-only; durable history is never mutated except by compaction.

## Tools

`src/tools/index.ts:160`:

| Tool | Readonly | Input | Description |
|------|----------|-------|-------------|
| `read` | yes | `{ path, offset?, limit? }` | Read a file (line-windowed) — emit N parallel `read` for N files |
| `list` | yes | `{ path? }` | List a directory (prefer over `bash ls`) |
| `glob` | yes | `{ pattern }` | Find files by glob |
| `grep` | yes | `{ pattern, path? }` | Regex search (skips dotfiles/`node_modules`) |
| `write` | no | `{ path, content }` | Create/overwrite a file |
| `edit` | no | `{ path, oldString, newString }` | Exact-string replacement |
| `apply_patch` | no | `{ patch }` | Multi-file / multi-occurrence patch |
| `bash` | no | `{ command }` | Run a shell command through the persistent PTY |
| `task` | yes | `{ prompt, subagent_type?: "explore"\|"plan" }` | Spawn parallel sub-agent(s) for research — emit N `task` in one step |
| `job_start` / `job_status` / `job_list` / `job_kill` | mixed | `{ command }`, `{ id }` | Background jobs with output retained across steps |
| `inbox` | yes | `{}` | Read completed background results for the Session |
| `lsp` | yes | `{ operation, file?, line?, character?, query? }` | Language-server navigation and symbols |
| `worktree_create` / `worktree_list` / `worktree_remove` | mixed | `{ name?, branch?, from?, directory? }`, `{ directory, force? }` | Isolated git worktrees on their own branches |

> [!WARNING]
> `bash` always asks for approval and should not be used for listing or reading files — use `list`/`glob`/`read`/`grep` instead.

## Agent modes

| Mode | Advertised tools | Permission | System guidance |
|------|------------------|------------|-----------------|
| `plan` | readonly only | `denyTools: [write, edit, bash]` | *"explore and propose a plan; do not implement"* |
| `build` | all | none extra | — |

Toggle with `/plan` `/build` or `Shift+Tab` in the shell, or `mode` in `runTurn()` (`src/cli/launch.ts:53`).

## Sessions and skills

**Sessions** are append-only rows in SQLite (`src/engine/sqlite.ts`):

```
sessions         id, cwd, model, provider, title, status, created_at
session_parts    session_id, message_id, seq, part_type, data, message_json
```

Status is one of `running`, `done`, `aborted`, `error`, or `limit` (step limit reached). Compaction summaries are stored as synthetic `compaction` parts. Forks record `parent_id` and `fork_boundary`; reverts remove the boundary message and everything after it. Token, cache, reasoning and cost counters are persisted per Session, and the API returns the matching catalog entry alongside usage.

**Skills** are `SKILL.md` files with optional YAML frontmatter (`name`, `description`). Active skills are concatenated (capped at 12k chars each) into the system prompt for every Turn step (`src/skills/index.ts`).

## Project structure

```
nexus/
├── src/
│   ├── cli/          # main.ts, launch.ts (turn launcher), config.ts, credentials.ts, run.ts
│   ├── engine/       # loop.ts, sqlite.ts, schema.ts, migrations.ts, prompt.ts, instructions.ts, context.ts, compact.ts, permission.ts, mode.ts, types.ts
│   ├── providers/    # index.ts, presets.ts, anthropic.ts, openai-compatible.ts, mock.ts, sse.ts
│   ├── tools/        # index.ts (read/write/edit/bash/list/glob/grep), worktree.ts, jobs.ts, patch.ts, lsp.ts, task.ts
│   ├── runtime/      # pty.ts, mcp.ts, lsp.ts, jobs.ts, worktree.ts, hooks.ts
│   ├── plugins/      # hooks.ts (stable seam), load.ts (local modules)
│   ├── server/       # HTTP API, SSE feed, auth, service state
│   ├── skills/       # index.ts (discover/format/filter)
│   └── tui/          # shell.tsx, live-turn.tsx, stream.tsx, permission-gate.tsx, picker.tsx, ...
├── fixtures/providers/  # recorded provider fixtures
├── web/              # install.sh / install.ps1
├── landing/          # Next.js marketing site
└── .github/workflows/ # ci.yml, release.yml
```

## Development

```bash
bun install
bun test                 # bun:test, all suites
bun run typecheck        # tsc --noEmit
bun run src/cli/main.ts --help
```

CI runs `bun install` → `bun test` → `bun run typecheck` on every push/PR to `main` (`.github/workflows/ci.yml:16`).

## Troubleshooting

**`not connected — run /key`**
No resolvable API key. Set the env var for your preset (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, etc.) or run `/key` in the shell to write `~/.nexus/credentials.json`.

**`permission denied` from a tool**
You denied the gate, or `plan` mode denied `write`/`edit`/`bash`. Switch to `build` with `/build` or `Shift+Tab`.

**Tool calls outside the workspace ask every time**
Expected. Paths containing `..`, `~`, or absolute paths outside the session `cwd` always trigger `ask` (`src/engine/permission.ts:72`).

**`~/.nexus.json: ...` parse error**
The config file must be a JSON object. Delete or fix `~/.nexus.json` and retry; defaults will be used if it is missing (`src/cli/config.ts:40`).

**Ollama shows no models**
Ensure Ollama is running (`ollama serve`) and the model is pulled (`ollama pull llama3.2`). The default base URL is `http://127.0.0.1:11434/v1`.

> [!TIP]
> Run `nexus self-test` to verify the provider can stream. It sends a single `pong` prompt and exits `0` on any token (`src/cli/run.ts:65`).

---

<div align="center">

Built for the terminal. Bring your own key.

</div>
