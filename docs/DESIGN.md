# vault-brain design

Goal: Claude recalls past coding and personal work from an Obsidian vault using a tiny always-loaded index (about 400 tokens). Knowledge survives `/compact`. The user never writes notes by hand: background Sonnet does it.

## Index scheme (three levels)

| Level | File | Content |
|---|---|---|
| 0 | `_brain/INDEX.md` | At most 15 lines. Line 1: lookup protocol. Then one line per category: `CODE \| name \| scope \| _brain/<CODE>.md`. CODE is one uppercase letter (P code projects, L life, W work clients, R reference). Injected at every SessionStart. |
| 1 | `_brain/<CODE>.md` | One line per topic: `CODE.topic \| hook (max 12 words) \| paths \| grep terms`. Topic codes are readable lowercase slugs (`P.acme-api`, `L.run`, `P.acme.ticket42`). |
| 2 | vault notes | Notes written by the brain have frontmatter `brain: <topic code>`, so `grep -rl "brain: P.acme-api"` finds them. Existing user notes are never modified; they are only referenced by path in level 1. |

Session state: `_brain/sessions/<session_id>.md` (frontmatter `brain: session`, `topics`, `updated`; current task, decisions with reasons, open items, next step). Overwritten at each capture of that session.

Injected rule (max 3 lines): for a question about past work or life, FIRST read `<vault>/_brain/<CODE>.md` (absolute path), THEN grep only the paths that topic lists; NEVER grep the whole vault; use `brain-recall` when more than 2 files are needed.

Lookup protocol: read INDEX.md (already injected), pick a category, read `_brain/<CODE>.md`, pick a topic, grep its terms inside its paths, read only matching sections. The `brain-recall` agent (Sonnet, read-only) does this outside the main context and returns at most 150 words plus `path:line` sources.

## Capture flow

```
PreCompact / SessionEnd hook -> capture.mjs
   guard CLAUDE_BRAIN_CAPTURE, vault check
   extract.mjs: transcript lines since state[session_id] -> compact U/A/T/R text
   delta < 1500 chars  -> update state only
   else queue/<ts>-<sid>.md, update state, spawn worker.mjs (detached), exit
worker.mjs: lock (mkdir) -> per queue file: claude -p --model sonnet (cwd = vault, hooks disabled, CLAUDE_BRAIN_CAPTURE=1)
   prompts/capture.md -> brain notes, session note, L1/L0, git commit in the vault
   ok -> delete queue file; fail -> queue/failed/<name>.aN.md + log (N = attempts)
   rate limit (usage limit|rate limit|limit reached in output) -> stop run, file stays queued, no attempt counted
SessionStart -> inject.mjs: print INDEX.md + 3-line lookup rule (+ session note path on source=compact); requeue failed; recover orphaned queue
```

Retry: worker start and each SessionStart move `failed/` files with fewer than 3 attempts and mtime older than 30 minutes back to `queue/` (a legacy file without `.aN` counts as 1 attempt). The 3rd failure logs `GAVE UP` and the file stays in `failed/`. Test override: `CLAUDE_BRAIN_CLAUDE_BIN` = node script used instead of `claude`.

Why a queue: hooks must return fast and a killed session must not lose its capture. Why a lock directory: one Sonnet writer at a time so notes and git commits never race; the holder re-checks the queue before releasing, so a hook that loses the lock race loses nothing. Stale lock: older than 15 minutes (the worker touches it after each file).

Why a delta by line count: PreCompact and SessionEnd can both fire in one session; each captures only what is new.

## Safety

- Recursion guard: the worker's child `claude` has `CLAUDE_BRAIN_CAPTURE=1` and hooks disabled; every hook script exits 0 at once under that env.
- Existing notes without `brain:` frontmatter are never edited, not even to add a link. The vault is a git repo so every brain write is a reviewable, revertable commit.
- No secrets in notes (prompt rule). Hooks never throw; every action and error goes to `~/.claude/brain/log.txt`.
- No network from the scripts; no dependencies (node stdlib only).

## State

`~/.claude/brain/` (override with `CLAUDE_BRAIN_STATE`): `state.json` (session id -> captured line count), `queue/`, `queue/failed/`, `lock/`, `log.txt`. Test-only switch: `CLAUDE_BRAIN_NO_SPAWN=1` stops capture from spawning the worker.

## Reindex

`reindex.mjs` builds or refreshes levels 0 and 1 from the vault. Incremental: `_brain/.indexed-commit` stores the last indexed HEAD; the changed set is `git diff --name-only <commit> HEAD` plus untracked `.md` files. Never edits user notes. It takes the same lock as the worker.

## Known limits

- Capture quality depends on Sonnet following prompts/capture.md; review the vault git log.
- The 15-line L0 cap limits categories; topics scale in L1.
- Windows tested; macOS/Linux paths are standard but untested.
