# Nexus

BYOK coding agent 

## Install / run

```bash
bun install

# Interactive shell (OpenCode-style). First launch opens /key if no credentials.
bun run src/cli/main.ts
# or: ./dist/nexus

# One-shot / scripted
export OPENAI_API_KEY=…   # optional if you already ran /key
bun run src/cli/main.ts run "list files in this repo" --yes

# Compiled binary
bun run build:compile
./dist/nexus
```

## Commands

```
nexus                         # persistent chat shell
nexus run "task" [--model <m>] [--yes]
nexus resume <id> [--model <m>] [--yes]
nexus self-test [--model <m>]
```

### Shell slash commands

| Command | Action |
|---|---|
| `/key` | Provider picker → paste API key → `~/.nexus/credentials.json` |
| `/model` | Suggested models + Custom… |
| `/resume` | Pick a past session |
| `/new` | Fresh session |
| `/help` | List commands |
| `/quit` | Exit |

Ctrl+C aborts the current agent turn; Ctrl+C on an idle prompt quits.

Exit codes (for `run`): `0` done · `1` error · `2` aborted.

Config: `~/.nexus.json`. Credentials: `~/.nexus/credentials.json` (`0600`). Env API keys win over the file. Sessions: `~/.nexus/sessions/`.

