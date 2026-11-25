// Fake claude for worker tests. STUB_MODE: ok | fail | limit
import fs from 'node:fs';
fs.readFileSync(0); // drain prompt
const m = process.env.STUB_MODE || 'ok';
if (m === 'limit') { console.log('Claude usage limit reached'); process.exit(1); }
if (m === 'fail') { console.error('boom'); process.exit(1); }
console.log('stub ok');
