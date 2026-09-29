import { openDb, streakFrom } from '../lib/db.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + m); } };
const head = t => console.log('\n\x1b[1m' + t + '\x1b[0m');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sur-test-'));
const DB = path.join(tmp, 'test.db');

head('Database — a range measured once must still be there next week');
{
  let db = openDb(DB);
  const s = db.activeSinger();
  ok(!!s && s.id > 0, 'a singer is created on first run');
  ok(s.a4 === 440 && s.tuning === 'ji', 'sensible defaults (just intonation, the right one against a tanpura)');

  db.updateSinger(s.id, {
    sa_hz: 138.59, sa_note: 'C♯3', sa_key: 'kali 1',
    low_hz: 98, high_hz: 392, low_note: 'G2', high_note: 'G4',
    semitones: 24, tier: 'minimal',
  });
  db.addRangeTest(s.id, { low_hz: 98, high_hz: 392, low_note: 'G2', high_note: 'G4', semitones: 24, tier: 'minimal', warmed_up: 1 });

  const sid = db.startSession(s.id, { exercise: 'p3', thaat: 'bilawal', sa_hz: 138.59 });
  db.finishSession(sid, {
    seconds: 612, notes_sung: 84, in_tune: 61, mean_abs_cents: 14.2, longest_hold: 11.4, score: 78,
    swaras: [ { swara: 0, octave: 0, n: 20, mean_cents: 2.1, sd_cents: 6.0 },
              { swara: 4, octave: 0, n: 14, mean_cents: -18.4, sd_cents: 9.1 },
              { swara: 7, octave: 0, n: 12, mean_cents: 1.0, sd_cents: 5.2 } ],
  });
  db.close();

  // reopen: this is the "next week" case
  db = openDb(DB);
  const again = db.activeSinger();
  ok(again.sa_hz === 138.59, `Sa did not survive a restart (got ${again.sa_hz})`);
  ok(again.sa_key === 'kali 1', 'harmonium key did not survive');
  ok(again.low_hz === 98 && again.high_hz === 392, 'range did not survive a restart');
  ok(db.rangeHistory(again.id).length === 1, 'range test history lost');
  const sess = db.sessions(again.id);
  ok(sess.length === 1 && sess[0].score === 78, 'session history lost');
  console.log(`  reopened: Sa ${again.sa_note} (${again.sa_key}), range ${again.low_note}–${again.high_note}, ${sess.length} session kept`);

  const st = db.stats(again.id);
  ok(st.totals.sessions === 1 && st.totals.notes === 84, 'totals wrong');
  ok(st.perSwara.length === 3, 'per-swara stats lost');
  const ga = st.perSwara.find(w => w.swara === 4);
  ok(ga && Math.abs(ga.mean_cents + 18.4) < 0.01, 'per-swara mean wrong');
  console.log(`  stats: ${st.totals.sessions} session, ${st.totals.notes} notes, weakest swara mean ${ga.mean_cents.toFixed(1)}c`);

  // a second singer in the same household
  const other = db.createSinger('Asha');
  ok(db.listSingers().length === 2, 'second singer not created');
  ok(db.activeSinger().id === other.id, 'new singer should become active');
  ok(db.getSinger(again.id).sa_hz === 138.59, 'first singer clobbered by the second');
  db.setActiveSinger(again.id);
  ok(db.activeSinger().name === again.name, 'could not switch back');
  console.log(`  two singers kept apart: ${db.listSingers().map(x => x.name).join(', ')}`);
  db.close();
}

head('Practice streak');
{
  const day = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  ok(streakFrom([]) === 0, 'no days = no streak');
  ok(streakFrom([day(0), day(1), day(2)]) === 3, 'three consecutive days');
  ok(streakFrom([day(1), day(2)]) === 2, 'yesterday still counts');
  ok(streakFrom([day(0), day(0), day(1)]) === 2, 'two sessions in one day count once');
  ok(streakFrom([day(3), day(4)]) === 0, 'a gap breaks the streak');
  ok(streakFrom([day(0), day(2), day(3)]) === 1, 'only the unbroken run counts');
  console.log('  streak arithmetic correct across gaps, duplicates and evening practice');
}

head('HTTP API');
{
  const PORT = 7391;
  const srv = spawn(process.execPath, ['server.mjs', '--port', String(PORT), '--db', path.join(tmp, 'api.db')],
    { cwd: process.cwd(), stdio: 'ignore' });
  const get = async (p, opt) => {
    const r = await fetch(`http://127.0.0.1:${PORT}${p}`, opt);
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  try {
    for (let i = 0; i < 60; i++) {
      try { await fetch(`http://127.0.0.1:${PORT}/api/bootstrap`); break; }
      catch { await new Promise(r => setTimeout(r, 100)); }
    }
    let r = await get('/api/bootstrap');
    ok(r.status === 200 && r.body.singer, 'bootstrap failed');
    console.log(`  GET  /api/bootstrap        -> 200, singer "${r.body.singer.name}"`);

    r = await get('/api/range-test', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ low_hz: 110, high_hz: 440, low_note: 'A2', high_note: 'A4', semitones: 24, tier: 'minimal', warmed_up: 1 }) });
    ok(r.status === 201 && r.body.singer.low_hz === 110, 'range test not saved');
    console.log(`  POST /api/range-test       -> 201, working range now ${r.body.singer.low_note}–${r.body.singer.high_note}`);

    r = await get('/api/range-test', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ low_hz: 400, high_hz: 200 }) });
    ok(r.status === 400, 'an inverted range should be rejected, got ' + r.status);
    console.log(`  POST /api/range-test (bad) -> ${r.status}, rejected`);

    r = await get('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ exercise: 'p4', thaat: 'kafi', sa_hz: 220 }) });
    const sid = r.body.id;
    ok(r.status === 201 && sid > 0, 'session not started');
    r = await get(`/api/session/${sid}`, { method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ seconds: 300, notes_sung: 40, in_tune: 33, score: 82,
        swaras: [{ swara: 0, octave: 0, n: 10, mean_cents: 1, sd_cents: 4 }] }) });
    ok(r.status === 200 && r.body.score === 82, 'session not finished');
    console.log(`  POST+PUT /api/session      -> session ${sid} recorded, score ${r.body.score}`);

    r = await get('/api/stats');
    ok(r.body.totals.sessions === 1, 'stats not aggregating');
    console.log(`  GET  /api/stats            -> ${r.body.totals.sessions} session, streak ${r.body.streak}`);

    r = await get('/api/../../../etc/passwd');
    ok(r.status === 404 || r.status === 200 && !String(r.body).includes('root:'), 'path traversal must not escape');
    const rawTraversal = await fetch(`http://127.0.0.1:${PORT}/lib/../server.mjs`);
    const txt = await rawTraversal.text();
    ok(!txt.includes('createServer'), 'must not serve files outside public/ and lib/');
    console.log('  path traversal              -> blocked');

    r = await get('/api/nope');
    ok(r.status === 404, 'unknown endpoint should 404');
  } finally { srv.kill(); }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('\n' + (fail ? `\x1b[31m${fail} FAILURES\x1b[0m` : '\x1b[32mAll persistence tests passed.\x1b[0m'));
process.exit(fail ? 1 : 0);
