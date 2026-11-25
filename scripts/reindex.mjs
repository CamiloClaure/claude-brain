import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { vaultPath, acquireLock, releaseLock, log, runClaude, pluginRoot } from './lib.mjs';

const vault = vaultPath();
if (!vault) { console.error('CLAUDE_BRAIN_VAULT unset or missing'); process.exit(1); }
const git = (...a) => execFileSync('git', a, { cwd: vault, encoding: 'utf8' }).trim();
const tryGit = (...a) => { try { return git(...a); } catch { return ''; } };
const markerPath = path.join(vault, '_brain', '.indexed-commit');

if (!acquireLock()) { console.error('brain lock held (capture worker running); retry later'); process.exit(1); }
let code = 0;
try {
  let changed = 'FULL REINDEX: no previous index; consider every .md file in the vault.';
  if (fs.existsSync(markerPath)) {
    const prev = fs.readFileSync(markerPath, 'utf8').trim();
    const diff = git('diff', '--name-only', prev, 'HEAD');
    const untracked = git('ls-files', '--others', '--exclude-standard');
    const list = [...new Set((diff + '\n' + untracked).split('\n').map(s => s.trim()).filter(f => f.endsWith('.md') && !f.startsWith('_brain/')))];
    changed = `INCREMENTAL REINDEX since ${prev}. Changed/new .md files (vault-relative):\n${list.join('\n') || '(none)'}`;
  }
  const prompt = `${fs.readFileSync(path.join(pluginRoot(), 'prompts', 'reindex.md'), 'utf8')}\n\nVAULT PATH: ${vault}\n\n${changed}\n`;
  log('reindex: start');
  const r = await runClaude(prompt, vault, vault, 30 * 60 * 1000);
  if (r.code !== 0) {
    log(`reindex FAILED code=${r.code} ${r.stderr.slice(0, 1000)}`);
    console.error(r.stderr);
    code = 1;
  } else {
    git('add', '-A');
    tryGit('commit', '-m', 'brain: reindex');
    fs.mkdirSync(path.dirname(markerPath), { recursive: true });
    fs.writeFileSync(markerPath, git('rev-parse', 'HEAD') + '\n');
    git('add', '-A');
    tryGit('commit', '-m', 'brain: indexed marker');
    log('reindex: ok');
    console.log(r.stdout.trim());
  }
} catch (e) {
  log(`reindex error: ${(e && e.stack) || e}`);
  console.error(e);
  code = 1;
} finally { releaseLock(); }
process.exit(code);
