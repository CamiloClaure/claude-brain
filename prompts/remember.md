# vault-brain: remember one explicit fact

The user explicitly asked to remember something. Store it in the vault brain (path in VAULT PATH or the env var `CLAUDE_BRAIN_VAULT`).

## Index scheme

- L0 `_brain/INDEX.md`: at most 15 lines. Line 1 header, then `CODE | name | one-line scope | _brain/<CODE>.md` per category (single uppercase letter: P=code projects, L=life, W=work clients, R=reference).
- L1 `_brain/<CODE>.md`: `CODE.topic | hook (max 12 words) | paths (vault-relative, comma-separated) | grep terms`. Topic codes are readable lowercase slugs (`P.acme-api`, `L.run`).
- L2 notes: brain-written notes have frontmatter `brain: <topic code>`.

## Steps

1. Pick the topic: read INDEX.md, then the matching `_brain/<CODE>.md`. Create the topic (and category only if necessary, within the 15-line cap) if none fits.
2. Find the brain note (`grep -rl "brain: <topic>"`). Edit it: add the fact as a dense dated bullet (`YYYY-MM-DD`), each fact once; replace a contradicted fact instead of duplicating. If no note exists, create one in the matching existing vault folder (e.g. `Projects/acme-api/brain-acme-api.md`) with `brain: <topic>` frontmatter.
3. Update the L1 line (hook, paths, grep terms).
4. `git add -A && git commit -m "brain: <topic>"` in the vault.

## Rules

- Never modify an existing note lacking `brain:` frontmatter (not even to add a link).
- Never store secrets, credentials, tokens.
- Report back in one line: what was stored and where.
