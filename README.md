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

*One binary. Any provider. Sessions are files.*

[Overview](#overview) • [Quick start](#quick-start) • [Installation](#installation) • [Usage](#usage) • [Configuration](#configuration) • [Architecture](#architecture) • [Troubleshooting](#troubleshooting)

</div>

---

## Overview

Nexus is a BYOK agent harness that runs **Turns** against a **Provider** with an optional workspace **Tool** layer and durable **Sessions**. It is not a hosted platform — your terminal is the interface, your keys stay local, and every session is a plain JSONL file you can grep, pipe, or resume.

Use it as an interactive shell for day-to-day coding or as a headless one-shot runner in CI. The same **Turn launcher** powers both (`src/cli/launch.ts:27`).

> [!TIP]
> No account required. Credentials live in `~/.nexus/credentials.json` and env vars always win over the file (`src/cli/config.ts:86`).

## Features

- **Model-agnostic** — OpenAI, Anthropic, Gemini, OpenRouter, Groq, DeepSeek, Ollama via one config (`src/providers/presets.ts:13`)
- **Two agent modes** — `plan` (read-only, auto-allowed) and `build` (full tools with approval)
- **Permission gate** — readonly tools inside the session cwd are auto-allowed; `write`/`edit`/`bash` and paths outside cwd always ask (`src/engine/permission.ts:17`)
- **Six focused tools** — `read`, `write`, `edit`, `bash`, `list`, `glob`, `grep` (`src/tools/index.ts:160`)
- **Durable sessions** — JSONL under `~/.nexus/sessions/` with `create`/`append`/`resume` (`src/engine/state.ts:27`)
- **Context assembly + compaction** — prompt-only truncation and LLM summarization when the budget exceeds threshold (`src/engine/context.ts:57`)
- **Skills** — reusable instruction packs from `.agents/skills` injected into context (`src/skills/index.ts:87`)
- **Ink TUI** — live turn view, stream viewport, mouse wheel scroll, permission picker (`src/tui/shell.tsx:44`)

## Prerequisites

- [Bun](https://bun.sh) >= 1.0 (runtime + package manager)
- An API key for at least one provider (or a local Ollama instance — no key needed)

## Installation

### Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/masralai/nexus/main/web/install.sh | sh
# -> ~/.local/bin/nexus  (add to PATH if prompted)
nexus --version
```

Custom repo or mirror:

```bash
NEXUS_INSTALL_REPO=myorg/nexus sh web/install.sh
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/masralai/nexus/main/web/install.ps1 | iex
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

Composer keys: `Enter` send, `Up`/`Down` history, `Ctrl+U`/`Ctrl+D` or mouse wheel to scroll, `Shift+Tab` toggle plan/build, `Ctrl+C` abort turn (second press exits).

Slash commands (`src/tui/slash.ts:7`):

| Command | Description |
|---------|-------------|
| `/key` | Connect provider + API key |
| `/model` | Set model (preset suggestions + custom) |
| `/skill [name\|clear]` | Activate a skill; bare `/skill` opens searchable picker |
| `/skills` | Alias for `/skill` |
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

Exit codes: `0` done, `1` error, `2` aborted (`src/cli/run.ts:56`).

`--yes` (or piping / non-TTY) auto-approves permission asks. Without it, the gate yields `permissionRequest` events and the TUI shows a picker (`src/tui/permission-gate.tsx`).

### Resume

```bash
nexus resume 5467a7c8-...          # exact session id
# or inside the shell
/resume                            # picker sorted by createdAt desc
```

Sessions are JSONL: `~/.nexus/sessions/<id>.jsonl` with `meta`, `msg`, `status` lines (`src/engine/state.ts:16`). Copy or version them like any file.

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
  "baseUrl": "https://api.openai.com/v1"
}
```

| Field | Env override | Default |
|-------|--------------|---------|
| `provider` | `NEXUS_PROVIDER` | `openai-compatible` |
| `preset` | `NEXUS_PRESET` | `openai` |
| `model` | `NEXUS_MODEL` / `--model` | `""` (provider default) |
| `maxSteps` | `NEXUS_MAX_STEPS` | `50` |
| `compactModel` | `NEXUS_COMPACT_MODEL` | `gpt-4o-mini` / `claude-3-5-haiku-latest` for Anthropic |
| `compactThreshold` | `NEXUS_COMPACT_THRESHOLD` | `0.8` |
| `baseUrl` | `OPENAI_BASE_URL` | per preset |

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

Resolution order per preset `envKeys` (`src/cli/config.ts:86`): env var first (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`/`GOOGLE_API_KEY`, etc.), then credentials file. The `mock` provider needs no key.

## Architecture

```
Session (JSONL) ──► Turn launcher (src/cli/launch.ts:27) ──► Turn (src/engine/loop.ts:58)
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

A **Session** holds many **Messages** and is advanced by **Turns**. Each Turn assembles a prompt from working memory (`src/engine/context.ts:17`), streams from the Provider, gates every tool call, executes all Tool calls in parallel in one step (optimistic, provider-ordered) (`src/engine/loop.ts:168`), and appends results durably.

Key seams:

- **Turn launcher** — single place that builds provider, compact provider, registry, and store (shared by shell and CLI).
- **Permission gate** — single decision per tool call (`decide()` + `gateToolCall()`); readonly inside cwd → allow, `bash`/outside cwd → ask, denied tools → deny.
- **Agent mode** — `plan` advertises only readonly tools and denies `write`/`edit`/`bash` (`src/engine/mode.ts:6`); `build` advertises all.
- **Context assembly** — working memory + skill blocks + truncation are prompt-only; durable history is never mutated except by compaction.

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
| `bash` | no | `{ command }` | Run a shell command (30s timeout) |
| `task` | yes | `{ prompt, subagent_type?: "explore"\|"plan" }` | Spawn parallel sub-agent(s) for research — emit N `task` in one step |

> [!WARNING]
> `bash` always asks for approval and should not be used for listing or reading files — use `list`/`glob`/`read`/`grep` instead.

## Agent modes

| Mode | Advertised tools | Permission | System guidance |
|------|------------------|------------|-----------------|
| `plan` | readonly only | `denyTools: [write, edit, bash]` | *"explore and propose a plan; do not implement"* |
| `build` | all | none extra | — |

Toggle with `/plan` `/build` or `Shift+Tab` in the shell, or `mode` in `runTurn()` (`src/cli/launch.ts:53`).

## Sessions and skills

**Sessions** are append-only JSONL (`src/engine/state.ts:30`):

```
~/.nexus/sessions/<uuid>.jsonl
  {"type":"meta","session":{"id","cwd","model","provider","createdAt"}}
  {"type":"msg","msg":{"role":"user","content":"..."}}
  {"type":"msg","msg":{"role":"assistant","content":"...","toolCalls":[...]}}
  {"type":"msg","msg":{"role":"tool","toolCallId":"...","result":{"ok":true,"output":"..."}}}
  {"type":"status","status":"done"}
```

**Skills** are `SKILL.md` files with optional YAML frontmatter (`name`, `description`). Active skills are concatenated (capped at 12k chars each) and injected into working memory for every Turn step (`src/skills/index.ts:112`).

## Project structure

```
nexus/
├── src/
│   ├── cli/          # main.ts, launch.ts (turn launcher), config.ts, credentials.ts, run.ts
│   ├── engine/       # loop.ts, state.ts (JSONL), context.ts, compact.ts, permission.ts, mode.ts, types.ts
│   ├── providers/    # index.ts, presets.ts, anthropic.ts, openai-compatible.ts, mock.ts, sse.ts
│   ├── tools/        # index.ts (read/write/edit/bash/list/glob/grep)
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
