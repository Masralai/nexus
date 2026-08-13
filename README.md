# Nexus (harness)

BYOK coding-agent CLI — TypeScript on Bun. Bring your own API keys.

## Install / run

```bash
# From source
bun install
bun run src/cli/main.ts --help

# First-time config (writes ~/.harness.json; keys stay in env)
bun run src/cli/main.ts init
export OPENAI_API_KEY=…   # or ANTHROPIC_API_KEY
bun run src/cli/main.ts run "list files in this repo" --yes

# Compiled binary
bun run build:compile
./dist/harness --help

# bunx (after publish): bunx nexus …  — until then use bun run / the binary above
```

## Commands

```
harness run "task" [--model <m>] [--yes]
harness resume <id> [--model <m>] [--yes]
harness init [--force]
harness self-test [--model <m>]
```

Exit codes: `0` done · `1` error · `2` aborted.

## Docs

- [PLAN.md](PLAN.md) — architecture and milestones
- [PRD.md](PRD.md) — user stories
- [specs/v1.1.md](specs/v1.1.md) — v1.1 SDD (compaction, init, fixtures, installers)
