import fs from 'node:fs';
import path from 'node:path';
import { vaultPath, acquireLock, releaseLock, touchLock, queueDir, pendingQueue, log, runClaude, pluginRoot, requeueFailed, RATE_LIMIT_RE, MAX_ATTEMPTS, baseName } from './lib.mjs';

// Spawned WITH CLAUDE_BRAIN_CAPTURE=1 on purpose, so no recursion guard here.
try {
  const vault = vaultPath();
  if (!vault) process.exit(0);
  if (!acquireLock()) { log('worker: lock held, exiting (holder drains queue)'); process.exit(0); }
  try {
    requeueFailed();
    const base = fs.readFileSync(path.join(pluginRoot(), 'prompts', 'capture.md'), 'utf8');
    for (;;) {
      const q = pendingQueue(); // re-read each loop: new files queued meanwhile are drained before release
      if (!q.length) break;
      const f = q[0];
      const qp = path.join(queueDir(), f);
      const delta = fs.readFileSync(qp, 'utf8');
      log(`worker: processing ${f}`);
      const prompt = `${base}\n\nVAULT PATH: ${vault}\nTODAY: ${new Date().toLocaleDateString('sv')}\n\n=== SESSION DELTA ===\n${delta}`;
      const r = await runClaude(prompt, vault, vault);
      touchLock();
      if (r.code === 0) {
        fs.rmSync(qp);
        if (r.stdout.trim() === 'NOOP') { log(`worker: noop ${f}`); continue; }
        log(`worker: ok ${f}: ${r.stdout.trim().slice(0, 300).replace(/\s+/g, ' ')}`);
      } else if (RATE_LIMIT_RE.test(r.stdout + r.stderr)) {
        log(`worker: rate limit on ${f}, stopping run (file stays queued, no attempt counted)`);
        break;
      } else {
        const n = Number((f.match(/\.a(\d+)\.md$/) || [])[1] || 0) + 1;
        const nf = baseName(f).replace(/\.md$/, `.a${n}.md`);
        fs.mkdirSync(path.join(queueDir(), 'failed'), { recursive: true });
        fs.renameSync(qp, path.join(queueDir(), 'failed', nf));
        if (n >= MAX_ATTEMPTS) log(`worker: GAVE UP ${nf} after ${n} attempts, left in queue/failed`);
        log(`worker: FAILED ${f} (attempt ${n}) code=${r.code} stderr=${r.stderr.slice(0, 1000)} stdout=${r.stdout.slice(0, 300).replace(/\s+/g, " ")}`);
      }
    }
  } finally { releaseLock(); }
} catch (e) { log(`worker error: ${(e && e.stack) || e}`); }
process.exit(0);
