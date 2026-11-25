---
name: brain
description: Use the vault brain. Look up past work/life/decisions (brain-recall agent), store explicit facts ("remember X", via brain-writer), "brain reindex", "brain status".
---

# brain

The vault path is env `CLAUDE_BRAIN_VAULT`. A tiny index (`_brain/INDEX.md`) is injected at session start.

## When to look up
Any question about past work, earlier decisions, project setups, or the user's personal life notes (training, nutrition, finance, journal). Index first, never a vault-wide grep: read `<vault>/_brain/<CODE>.md` (absolute path) for the matching category in the injected index, then grep only the paths the topic lists. If that needs more than 2 files, spawn the `brain-recall` agent with the question and the vault path. Never grep the whole vault or whole folders like `personal`.

## When to write
- User says "remember X": spawn `brain-writer` with the fact and the vault path.
- Right after an important decision: offer once, or just store it with `brain-writer`.
- Routine capture happens automatically (PreCompact and SessionEnd hooks run Sonnet in the background); nothing to do.

## Commands
- "brain reindex": run `node "${CLAUDE_PLUGIN_ROOT}/scripts/reindex.mjs"`. The path is the installed plugin directory; if the variable is unset, find the `vault-brain` directory under `~/.claude/plugins` (for example `~/.claude/plugins/cache/vault-brain/vault-brain/*/`). Incremental after the first run. Can take several minutes.
- "brain status": show `~/.claude/brain/queue/` (pending, and `failed/`), whether `~/.claude/brain/lock` exists, and the last 20 lines of `~/.claude/brain/log.txt`. Failed captures retry automatically (see DESIGN); after 3 attempts they stay in `queue/failed/` (`.aN.md` = attempts).
