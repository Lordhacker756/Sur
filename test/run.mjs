// Runs every Sur test suite.  node test/run.mjs
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const suites = ['music.mjs', 'voice-range.mjs', 'persistence.mjs'];
let failed = 0;

for (const s of suites) {
  const r = spawnSync(process.execPath, ['--no-warnings', path.join(here, s)],
    { stdio: 'inherit', cwd: path.join(here, '..') });
  if (r.status !== 0) failed++;
}
console.log('\n' + '='.repeat(64));
if (failed) { console.log(`\x1b[31m${failed} suite${failed > 1 ? 's' : ''} failed\x1b[0m`); process.exit(1); }
console.log('\x1b[32mAll Sur test suites passed.\x1b[0m');
