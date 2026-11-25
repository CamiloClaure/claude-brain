import fs from 'node:fs';
import path from 'node:path';
import { guardRecursion, vaultPath, readStdinJSON, readJSON, writeJSON, log, stateDir, queueDir, spawnWorker } from './lib.mjs';
import { extract } from './extract.mjs';

const MIN_CHARS = 1500;

try {
  if (guardRecursion()) process.exit(0);
  if (!vaultPath()) process.exit(0);
  const inp = await readStdinJSON();
  const { session_id: sid, transcript_path: tp } = inp;
  if (!sid || !tp || !fs.existsSync(tp)) { log(`capture: missing session/transcript (${sid})`); process.exit(0); }

  const statePath = path.join(stateDir(), 'state.json');
  const state = readJSON(statePath, {});
  const from = state[sid] || 0;
  const { text, lines } = extract(tp, from);
  const why = inp.trigger || inp.reason || inp.hook_event_name || '?';

  if (text.length < MIN_CHARS) {
    state[sid] = lines; writeJSON(statePath, state);
    log(`capture ${sid} (${why}): delta ${text.length} chars < ${MIN_CHARS}, skipped`);
    process.exit(0);
  }
  fs.mkdirSync(queueDir(), { recursive: true });
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${sid}.md`;
  const header = `session_id: ${sid}\ncwd: ${inp.cwd || ''}\ntrigger: ${why}\nlines: ${from}-${lines}\n\n--- DELTA ---\n`;
  fs.writeFileSync(path.join(queueDir(), name), header + text);
  state[sid] = lines; writeJSON(statePath, state);
  log(`capture ${sid} (${why}): queued ${name} (${text.length} chars)`);
  if (!process.env.CLAUDE_BRAIN_NO_SPAWN) spawnWorker();
} catch (e) {
  log(`capture error: ${(e && e.stack) || e}`);
}
process.exit(0);
