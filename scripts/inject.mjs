import fs from 'node:fs';
import path from 'node:path';
import { guardRecursion, vaultPath, readStdinJSON, log, pendingQueue, lockHeld, spawnWorker, requeueFailed } from './lib.mjs';

try {
  if (guardRecursion()) process.exit(0);
  const vault = vaultPath();
  if (!vault) process.exit(0);
  const inp = await readStdinJSON();
  requeueFailed();
  if (pendingQueue().length && !lockHeld()) { spawnWorker(); log('inject: recovering queue'); }

  const idx = path.join(vault, '_brain', 'INDEX.md');
  if (!fs.existsSync(idx)) process.exit(0);
  let ctx = fs.readFileSync(idx, 'utf8').trim() +
    `\n\nBrain rule: for a question about past work or life, FIRST read ${path.join(vault, '_brain', '<CODE>.md')} (absolute path) for the matching category above, THEN grep only the paths that topic lists. NEVER grep the whole vault.` +
    `\nUse the brain-recall agent when the lookup needs more than 2 files. Say 'remember X' to store a fact.`;
  if (inp.source === 'compact' && inp.session_id) {
    const p = path.join(vault, '_brain', 'sessions', `${inp.session_id}.md`);
    ctx += fs.existsSync(p)
      ? `\nSession state saved before compaction: ${p} (read it to resume).`
      : `\nState capture in progress, check ${p} shortly.`;
  }
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx } }));
} catch (e) { log(`inject error: ${(e && e.stack) || e}`); }
process.exit(0);
