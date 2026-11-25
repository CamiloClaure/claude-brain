# vault-brain

A Claude Code plugin that gives Claude a persistent "brain" over an Obsidian vault. A tiny index (about 400 tokens) is always loaded; details are fetched on demand; knowledge is captured in the background by Sonnet before `/compact` and at session end. You never write notes by hand.

## How it works

- `SessionStart`: injects `_brain/INDEX.md` (and, after `/compact`, the path of the saved session state).
- `PreCompact` / `SessionEnd`: extracts the new part of the transcript, queues it, and a detached worker runs `claude -p --model sonnet` in the vault to update notes, indexes and a session state note, then commits to the vault's git repo.
- `brain-recall` agent: answers questions by walking index level 0 -> 1 -> notes (max 150 words + sources).
- `brain-writer` agent: stores an explicit "remember X".

See `docs/DESIGN.md` for the index scheme and flow, and `demo-vault/` for a fake example.

## Requirements

node 20+, git, the `claude` CLI logged in (OAuth is fine). No npm dependencies.

## Install

```
git clone https://github.com/CamiloClaure/claude-brain
claude plugin marketplace add ./claude-brain
claude plugin install vault-brain@vault-brain
```

Add to the `env` object of `~/.claude/settings.json`:

```
"CLAUDE_BRAIN_VAULT": "~/Documents/vault"   (use your real absolute path; ~ is a placeholder)
```

Make the vault a git repo (`git init`, first commit) and build the index once: ask Claude "brain reindex" or run `node scripts/reindex.mjs`. If the variable is unset or the folder is missing, all hooks do nothing.

## Use

- Just work. Ask about past work and Claude consults the index and the `brain-recall` agent.
- "remember that X" stores a fact.
- "brain status": queue, failed captures, log tail (`~/.claude/brain/`).

## Test

`node test/run.mjs`

## Testing

`CLAUDE_BRAIN_VAULT` in the `env` of `~/.claude/settings.json` overrides the process environment inside every `claude` session. Setting it in your shell does not change a test session.

To test against another vault, pass an env override with `--settings`:

```
claude -p --settings '{"env":{"CLAUDE_BRAIN_VAULT":"/tmp/test-vault","CLAUDE_BRAIN_STATE":"/tmp/test-state"}}' "question"
```

Slash commands (`/compact`, `/exit`) do not work via `-p`. To test PreCompact and SessionEnd on a live session, run it in a herdr-core terminal and send the keys with `hc keys`, for example `hc keys <terminal> / c o m p a c t enter` (one key name per argument). `node test/run.mjs` covers the scripts with a stub claude (`CLAUDE_BRAIN_CLAUDE_BIN`) and never touches a real vault.

## Notes

Brain-written notes carry `brain: <topic>` frontmatter. Existing notes are never modified. Review what the brain wrote with `git log` in the vault. Capture spends Sonnet usage in the background.

MIT licensed.
