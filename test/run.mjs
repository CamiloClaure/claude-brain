import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extract } from '../scripts/extract.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const fixture = path.join(here, 'fixture.jsonl');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-test-'));
let fails = 0;
const t = (name, fn) => { try { fn(); console.log('ok   ' + name); } catch (e) { fails++; console.log('FAIL ' + name + '\n' + e.message); } };

t('extract strips reminders, truncates tools, skips noise', () => {
  const { text, lines } = extract(fixture);
  assert.equal(lines, 8);
  assert.ok(!text.includes('REMINDER') && !text.includes('only reminder'));
  assert.ok(text.includes('U: Fix the acme-api login bug'));
  assert.ok(text.includes('A: Decision: use cookies because SSR.'));
  const tool = text.split('\n').find(l => l.startsWith('T: Read'));
  assert.ok(tool && tool.length <= 'T: Read '.length + 303, 'tool truncated');
  const res = text.split('\n').find(l => l.startsWith('R: '));
  assert.ok(res && res.length <= 3 + 203, 'result truncated');
  assert.ok(!text.includes('attachment'));
});

t('extract respects fromLine', () => {
  const { text } = extract(fixture, 5);
  assert.ok(text.includes('Decision') && !text.includes('acme-api login'));
});

const run = (script, input, env) => spawnSync(process.execPath, [path.join(root, 'scripts', script)], {
  input: JSON.stringify(input), encoding: 'utf8',
  env: { ...process.env, CLAUDE_BRAIN_STATE: path.join(tmp, 'state'), CLAUDE_BRAIN_VAULT: tmp, CLAUDE_BRAIN_NO_SPAWN: '1', ...env },
});
const hook = { session_id: 's1', transcript_path: fixture, trigger: 'manual', cwd: tmp };

t('capture with CLAUDE_BRAIN_CAPTURE=1 exits 0 and writes nothing', () => {
  const r = run('capture.mjs', hook, { CLAUDE_BRAIN_CAPTURE: '1' });
  assert.equal(r.status, 0);
  assert.ok(!fs.existsSync(path.join(tmp, 'state')));
});

t('capture below threshold writes no queue file but updates state', () => {
  const r = run('capture.mjs', hook, { CLAUDE_BRAIN_CAPTURE: '' });
  assert.equal(r.status, 0);
  const st = JSON.parse(fs.readFileSync(path.join(tmp, 'state', 'state.json'), 'utf8'));
  assert.equal(st.s1, 8);
  assert.ok(!fs.existsSync(path.join(tmp, 'state', 'queue')));
});

t('capture above threshold queues a delta, incrementally', () => {
  const big = path.join(tmp, 'big.jsonl');
  const line = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(2000) } });
  fs.writeFileSync(big, line + '\n');
  const h = { ...hook, session_id: 's2', transcript_path: big };
  assert.equal(run('capture.mjs', h, { CLAUDE_BRAIN_CAPTURE: '' }).status, 0);
  const q = path.join(tmp, 'state', 'queue');
  assert.equal(fs.readdirSync(q).length, 1);
  assert.equal(run('capture.mjs', h, { CLAUDE_BRAIN_CAPTURE: '' }).status, 0);
  assert.equal(fs.readdirSync(q).length, 1, 'no duplicate delta');
});

t('hooks exit 0 silently without vault', () => {
  for (const s of ['capture.mjs', 'inject.mjs']) {
    const r = run(s, hook, { CLAUDE_BRAIN_VAULT: path.join(tmp, 'missing'), CLAUDE_BRAIN_CAPTURE: '' });
    assert.equal(r.status, 0); assert.equal(r.stdout, '');
  }
});

t('inject emits additionalContext incl. session path on compact', () => {
  fs.mkdirSync(path.join(tmp, '_brain'), { recursive: true });
  fs.writeFileSync(path.join(tmp, '_brain', 'INDEX.md'), 'hdr\nP | code | projects | _brain/P.md\n');
  const r = run('inject.mjs', { session_id: 's9', source: 'compact' }, { CLAUDE_BRAIN_CAPTURE: '' });
  const o = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(o.hookEventName, 'SessionStart');
  assert.ok(o.additionalContext.includes('P | code') && o.additionalContext.includes('s9.md'));
});

// --- retry of failed captures (stub claude) ---
const stub = path.join(here, 'stub-claude.mjs');
const wst = path.join(tmp, 'wstate');
const wq = path.join(wst, 'queue'), wf = path.join(wq, 'failed');
const worker = mode => spawnSync(process.execPath, [path.join(root, 'scripts', 'worker.mjs')], {
  encoding: 'utf8',
  env: { ...process.env, CLAUDE_BRAIN_STATE: wst, CLAUDE_BRAIN_VAULT: tmp, CLAUDE_BRAIN_CLAUDE_BIN: stub, STUB_MODE: mode },
});
const reset = () => { fs.rmSync(wst, { recursive: true, force: true }); fs.mkdirSync(wf, { recursive: true }); };
const old = p => { const d = new Date(Date.now() - 31 * 60 * 1000); fs.utimesSync(p, d, d); };
const ls = d => fs.readdirSync(d).filter(f => f.endsWith('.md')).sort();

t('failure counts attempts in filename, 3rd leaves it in failed', () => {
  reset();
  fs.writeFileSync(path.join(wq, 'x.md'), 'delta');
  worker('fail');
  assert.deepEqual(ls(wf), ['x.a1.md']); assert.deepEqual(ls(wq), []);
  for (const n of [2, 3]) {
    old(path.join(wf, `x.a${n - 1}.md`));
    worker('fail');
    assert.deepEqual(ls(wf), [`x.a${n}.md`]);
  }
  old(path.join(wf, 'x.a3.md'));
  worker('fail');
  assert.deepEqual(ls(wf), ['x.a3.md'], 'no 4th attempt');
  assert.ok(fs.readFileSync(path.join(wst, 'log.txt'), 'utf8').includes('GAVE UP x.a3.md'));
});

t('retry waits 30 min since last failure', () => {
  reset();
  fs.writeFileSync(path.join(wf, 'y.a1.md'), 'd');
  worker('fail');
  assert.deepEqual(ls(wf), ['y.a1.md'], 'too fresh: untouched');
  old(path.join(wf, 'y.a1.md'));
  worker('ok');
  assert.deepEqual(ls(wf), []); assert.deepEqual(ls(wq), []);
});

t('legacy failed file (no counter) is retried once old enough', () => {
  reset();
  fs.writeFileSync(path.join(wf, 'z.md'), 'd'); old(path.join(wf, 'z.md'));
  worker('fail');
  assert.deepEqual(ls(wf), ['z.a2.md']);
});

t('rate limit stops the run, keeps files queued, no attempt counted', () => {
  reset();
  fs.writeFileSync(path.join(wq, 'a.md'), 'd'); fs.writeFileSync(path.join(wq, 'b.md'), 'd');
  worker('limit');
  assert.deepEqual(ls(wq), ['a.md', 'b.md']); assert.deepEqual(ls(wf), []);
  assert.ok(fs.readFileSync(path.join(wst, 'log.txt'), 'utf8').includes('rate limit'));
});

t('inject requeues old failed files', () => {
  reset();
  fs.writeFileSync(path.join(wf, 'q.a1.md'), 'd'); old(path.join(wf, 'q.a1.md'));
  fs.writeFileSync(path.join(wf, 'r.a3.md'), 'd'); old(path.join(wf, 'r.a3.md'));
  fs.writeFileSync(path.join(wf, 's.a1.md'), 'd');
  run('inject.mjs', { session_id: 's9' }, { CLAUDE_BRAIN_CAPTURE: '', CLAUDE_BRAIN_STATE: wst });
  assert.deepEqual(ls(wq), ['q.a1.md']); assert.deepEqual(ls(wf), ['r.a3.md', 's.a1.md']);
});

t('inject rule text is <= 3 lines and names the index first', () => {
  const r = run('inject.mjs', { session_id: 's9' }, { CLAUDE_BRAIN_CAPTURE: '' });
  const c = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  const rule = c.slice(c.indexOf('Brain rule')).trim().split('\n');
  assert.ok(rule.length <= 3 && /FIRST read/.test(rule[0]) && /NEVER grep the whole vault/.test(rule[0]));
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
