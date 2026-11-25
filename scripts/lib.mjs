import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const stateDir = () =>
  process.env.CLAUDE_BRAIN_STATE || path.join(os.homedir(), '.claude', 'brain');
export const queueDir = () => path.join(stateDir(), 'queue');
export const pluginRoot = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Returns vault path or null (hooks must exit 0 silently when null).
export function vaultPath() {
  const v = process.env.CLAUDE_BRAIN_VAULT;
  try { return v && fs.statSync(v).isDirectory() ? v : null; } catch { return null; }
}

export const guardRecursion = () => process.env.CLAUDE_BRAIN_CAPTURE === '1';

export function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

export function writeJSON(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, p);
}

export function log(msg) {
  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.appendFileSync(path.join(stateDir(), 'log.txt'), `${new Date().toISOString()} [${process.pid}] ${msg}\n`);
  } catch { /* logging must never throw */ }
}

const STALE_MS = 15 * 60 * 1000;
const lockPath = () => path.join(stateDir(), 'lock');

export function lockHeld() {
  try { return Date.now() - fs.statSync(lockPath()).mtimeMs < STALE_MS; } catch { return false; }
}

export function acquireLock() {
  fs.mkdirSync(stateDir(), { recursive: true });
  try { fs.mkdirSync(lockPath()); return true; } catch { /* exists */ }
  if (lockHeld()) return false;
  try {
    fs.rmSync(lockPath(), { recursive: true, force: true });
    fs.mkdirSync(lockPath());
    log('stale lock replaced');
    return true;
  } catch { return false; }
}
export const touchLock = () => { try { const t = new Date(); fs.utimesSync(lockPath(), t, t); } catch { /* ignore */ } };
export const releaseLock = () => { try { fs.rmSync(lockPath(), { recursive: true, force: true }); } catch { /* ignore */ } };

export async function readStdinJSON() {
  if (process.stdin.isTTY) return {};
  let s = '';
  for await (const c of process.stdin) s += c;
  try { return JSON.parse(s); } catch { return {}; }
}

export function pendingQueue() {
  try { return fs.readdirSync(queueDir()).filter(f => f.endsWith('.md')).sort(); } catch { return []; }
}

export const MAX_ATTEMPTS = 3;
export const RETRY_WAIT_MS = 30 * 60 * 1000;
export const RATE_LIMIT_RE = /usage limit|rate limit|limit reached/i;
const attemptsOf = f => Number((f.match(/\.a(\d+)\.md$/) || [])[1] || 0);
export const baseName = f => f.replace(/\.a\d+\.md$/, '.md');
// Failed files carry their attempt count as `.aN.md`; a legacy file without it counts as 1 attempt.
export function requeueFailed(now = Date.now()) {
  const dir = path.join(queueDir(), 'failed');
  let n = 0;
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')); } catch { return 0; }
  for (const f of files) {
    try {
      const a = attemptsOf(f) || 1;
      if (a >= MAX_ATTEMPTS || now - fs.statSync(path.join(dir, f)).mtimeMs < RETRY_WAIT_MS) continue;
      fs.renameSync(path.join(dir, f), path.join(queueDir(), baseName(f).replace(/\.md$/, `.a${a}.md`)));
      log(`requeue: ${f} (attempts so far ${a})`);
      n++;
    } catch { /* ignore */ }
  }
  return n;
}

export function spawnWorker() {
  if (process.env.CLAUDE_BRAIN_NO_SPAWN) return;
  const worker = path.join(pluginRoot(), 'scripts', 'worker.mjs');
  spawn(process.execPath, [worker], {
    detached: true, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, CLAUDE_BRAIN_CAPTURE: '1' },
  }).unref();
}

// Run headless Sonnet with the prompt on stdin. Resolves {code, stdout, stderr}.
export function runClaude(prompt, cwd, vault, timeoutMs = 10 * 60 * 1000) {
  const stub = process.env.CLAUDE_BRAIN_CLAUDE_BIN; // test override: a node script standing in for claude
  const args = [...(stub ? [stub] : []), '-p', '--model', 'sonnet', '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Read,Write,Edit,Glob,Grep,Bash(git:*)',
    '--add-dir', vault, '--no-session-persistence',
    '--settings', '{"disableAllHooks":true}'];
  const env = { ...process.env, CLAUDE_BRAIN_CAPTURE: '1' };
  const exe = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  const direct = process.platform === 'win32' && fs.existsSync(exe);
  const tryRun = (cmd, shell) => new Promise(resolve => {
    let out = '', err = '', done = false, t;
    const finish = r => { if (!done) { done = true; clearTimeout(t); resolve(r); } };
    const a = shell ? args.map(x => `"${x.replace(/"/g, '\\"')}"`) : args;
    const child = spawn(cmd, a, { cwd, env, shell, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    t = setTimeout(() => { err += '\ntimeout'; child.kill(); finish({ code: -1, stdout: out, stderr: err }); }, timeoutMs);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => finish({ code: -2, stdout: out, stderr: String(e), spawnError: true }));
    child.on('close', code => finish({ code, stdout: out, stderr: err }));
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
  });
  return (async () => {
    if (stub) return tryRun(process.execPath, false);
    if (direct) return tryRun(exe, false);
    let r = await tryRun('claude', false);
    if (r.spawnError) r = await tryRun('claude', true);
    return r;
  })();
}
