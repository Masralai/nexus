# Nexus

BYOK agent for the terminal - interactive chat shell, one-shot runs, and resumable sessions.

## Features

- **Interactive shell** — persistent chat with slash commands, streaming output, and permission prompts
- **Bring your own key** — credentials in `~/.nexus/credentials.json` (env vars win)
- **Plan / build modes** — read-only exploration vs full tool access
- **Skills** — activate instruction packs from `~/.agents/skills` (same layout as Cursor / Claude Code)
- **Sessions** — JSONL history under `~/.nexus/sessions/` with resume
- **Tools** — `read`, `write`, `edit`, `bash`, `glob`, `grep`

## Quick start

```bash
bun install
bun run src/cli/main.ts
```

On first launch, `/key` walks you through provider + API key. Then type a task normally.

```bash
# One-shot (non-interactive)
export OPENAI_API_KEY=…
bun run src/cli/main.ts run "list files in this repo" --yes

# Compiled binary
bun run build:compile
./dist/nexus
```

> [!NOTE]
> Env API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, …) override the credentials file.

## Usage

```
nexus                         # interactive shell
nexus run "task" [--model <m>] [--yes]
nexus resume <id> [--model <m>] [--yes]
nexus self-test [--model <m>]
```

| Exit code (`run`) | Meaning |
|---|---|
| `0` | done |
| `1` | error |
| `2` | aborted (Ctrl+C) |

### Shell slash commands

| Command | Action |
|---|---|
| `/key` | Connect provider + API key |
| `/model` | Pick or enter a model id |
| `/skill` | Activate a skill (searchable picker); `/skill <name>` · `/skill clear` |
| `/skills` | Same as `/skill` — searchable skill picker |
| `/{skill-id}` | Activate a skill directly when id/name matches |
| `/plan` | Read-only agent mode |
| `/build` | Full tools mode |
| `/resume` | Continue a past session |
| `/new` | Fresh session (clears active skills) |
| `/help` | List commands |
| `/quit` | Exit |

Ctrl+C aborts the current turn; Ctrl+C on an idle prompt quits.

## Development

```bash
bun test
bun run typecheck
bun run build:compile
```
