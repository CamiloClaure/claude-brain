import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const strip = s => s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
const cut = (s, n) => (s.length > n ? s.slice(0, n) + '...' : s);
const oneLine = s => s.replace(/\s+/g, ' ').trim();

function resultText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(b => (b && b.type === 'text' ? b.text : '')).join(' ');
  return '';
}

// Returns {text, lines}; lines = total line count (store it as the next fromLine).
export function extract(transcriptPath, fromLine = 0) {
  const all = fs.readFileSync(transcriptPath, 'utf8').split('\n');
  if (all.length && all[all.length - 1] === '') all.pop();
  const out = [];
  for (let i = fromLine; i < all.length; i++) {
    let o;
    try { o = JSON.parse(all[i]); } catch { continue; }
    if (o.type !== 'user' && o.type !== 'assistant') continue;
    const c = o.message && o.message.content;
    const blocks = typeof c === 'string' ? [{ type: 'text', text: c }] : Array.isArray(c) ? c : [];
    const tag = o.type === 'user' ? 'U' : 'A';
    for (const b of blocks) {
      if (!b) continue;
      if (b.type === 'text') {
        const t = strip(b.text || '');
        if (t) out.push(`${tag}: ${t}`);
      } else if (b.type === 'tool_use') {
        out.push(`T: ${b.name} ${cut(JSON.stringify(b.input ?? {}), 300)}`);
      } else if (b.type === 'tool_result') {
        const t = oneLine(strip(resultText(b.content)));
        if (t) out.push(`R: ${cut(t, 200)}`);
      }
    }
  }
  return { text: out.join('\n'), lines: all.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [p, from] = process.argv.slice(2);
  if (!p) { console.error('usage: node extract.mjs <path> [fromLine]'); process.exit(2); }
  console.log(extract(p, Number(from) || 0).text);
}
