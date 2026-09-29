import * as M from '../lib/music.mjs';
let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + m); } };
const head = t => console.log('\n\x1b[1m' + t + '\x1b[0m');

head('Thaats — all 10, 7 swaras each, ascending, within an octave');
for (const t of M.THAATS) {
  ok(t.degrees.length === 7, `${t.name} has ${t.degrees.length} swaras`);
  ok(t.degrees[0] === 0, `${t.name} must start on Sa`);
  ok(t.degrees.every((d, i, a) => i === 0 || d > a[i - 1]), `${t.name} not ascending`);
  ok(t.degrees.every(d => d >= 0 && d <= 11), `${t.name} out of octave`);
  ok(new Set(t.degrees).size === 7, `${t.name} has a duplicate`);
  const has = new Set(t.degrees);
  ok(has.has(5) !== has.has(6), `${t.name} must have exactly one Ma (shuddha or teevra)`);
  ok(has.has(7) || t.id === 'marwa', `${t.name} should contain Pa`);
}
console.log('  ' + M.THAATS.map(t => `${t.name} ${t.degrees.join(',')}`).join('\n  '));

head('Harmonium keys');
console.log('  ' + M.HARMONIUM.map(h => `${M.PC_NAMES[h.pc]}=${h.key}`).join('  '));
ok(M.harmoniumKey(61) === 'kali 1', 'C#4 should be kali 1');
ok(M.harmoniumKey(60) === 'safed 1', 'C4 should be safed 1');
ok(M.HARMONIUM.filter(h => h.white).length === 7, 'seven white keys');
ok(M.HARMONIUM.filter(h => !h.white).length === 5, 'five black keys');

head('Sa recommendation from a measured range');
const voices = [
  ['bass',            'E2',  'E4'],
  ['baritone',        'G2',  'G4'],
  ['tenor',           'C3',  'C5'],
  ['alto',            'F3',  'F5'],
  ['soprano',         'G3',  'G5'],
  ['untrained, ~1 octave', 'A3', 'A4'],
  ['very narrow, a fifth', 'C4', 'G4'],
];
const nm2hz = n => {
  const pc = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].indexOf(n.replace(/\d/,''));
  return M.midiToHz(12 * (parseInt(n.match(/\d/)[0], 10) + 1) + pc);
};
console.log('  voice'.padEnd(24) + 'range'.padEnd(12) + 'semis'.padStart(6) + '  tier'.padEnd(11) + 'Sa'.padEnd(8) + 'key'.padEnd(10) + 'below/above');
for (const [label, lo, hi] of voices) {
  const r = M.recommendSa(nm2hz(lo), nm2hz(hi));
  const c = r.candidates[0];
  ok(!!c, `${label}: no Sa recommended`);
  if (!c) continue;
  console.log('  ' + label.padEnd(24) + `${lo}-${hi}`.padEnd(12) + String(r.semitones).padStart(6) +
    '  ' + r.tier.padEnd(11) + c.note.padEnd(8) + c.key.padEnd(10) + `${c.belowSa}/${c.aboveSa}`);
  ok(c.hz > nm2hz(lo) * 0.98 && c.hz < nm2hz(hi) * 1.02, `${label}: Sa ${c.note} outside the measured range`);
  if (r.tier === 'minimal') {
    ok(c.belowSa >= 4, `${label}: should reach ~a fourth below Sa, got ${c.belowSa}`);
    ok(c.aboveSa >= 11, `${label}: should reach ~an octave above Sa, got ${c.aboveSa}`);
  }
}
ok(M.recommendSa(0, 0).candidates.length === 0, 'a bad range must not produce a Sa');
ok(M.recommendSa(400, 200).candidates.length === 0, 'inverted range must not produce a Sa');
{
  // A Sa outside the plausible human band almost always means the detector
  // read an octave wrong somewhere; the app must say so, not ship a bad Sa.
  const r = M.recommendSa(nm2hz('C4'), nm2hz('C6'));
  ok(r.candidates.length === 0 && r.tier === 'implausible', 'an implausibly high Sa must be refused');
  ok(/octave/.test(r.warning || ''), 'and must explain why');
  console.log('  implausible range (C4-C6) -> refused: "' + (r.warning || '').slice(0, 64) + '..."');
}
{
  // With a span under ~21 semitones there is one honest answer, not three.
  const narrow = M.recommendSa(nm2hz('A3'), nm2hz('G4'));
  ok(narrow.candidates.length === 1, 'a narrow range must offer exactly one Sa, got ' + narrow.candidates.length);
  const wide = M.recommendSa(nm2hz('G2'), nm2hz('G4'));
  ok(new Set(wide.candidates.map(c => c.midi)).size === wide.candidates.length, 'Sa options must be distinct');
  console.log('  narrow range -> 1 option · wide range -> ' + wide.candidates.length + ' distinct options');
}

head('Alankar expansion');
const bil = M.thaatById('bilawal');
for (const al of M.ALANKARS) {
  const seq = M.expandAlankar(al, bil, 7, true);
  ok(seq.length > 0, `${al.name} expanded to nothing`);
  ok(seq[0].degree === al.motif[0], `${al.name} should start on the motif's first degree`);
  ok(seq.every(s => s.degree >= 0 && s.degree <= 7), `${al.name} escaped 0..7`);
  ok(seq.every(s => Number.isFinite(s.semitone)), `${al.name} produced a non-finite semitone`);
}
const p3 = M.expandAlankar(M.alankarById('p3'), bil, 7, false);
console.log('  Teen swar ascending: ' + p3.map(s => M.degreeName(s.degree, bil)).join(' ').replace(/(\S+ \S+ \S+) /g, '$1 · '));
const p4 = M.expandAlankar(M.alankarById('p4'), bil, 7, false);
console.log('  Chaar swar ascending: ' + p4.map(s => M.degreeName(s.degree, bil)).join(' '));

head('Range tailoring — the whole point of the app');
const sa = nm2hz('C4');
for (const [label, hi] of [['full octave above Sa', nm2hz('C5')], ['only up to Pa', nm2hz('G4')], ['only up to Ga', nm2hz('E4')]]) {
  console.log(`  singer can reach ${label} (top degree ${M.topDegreeFor(bil, sa, hi)}):`);
  for (const al of M.ALANKARS.slice(0, 5)) {
    const f = M.fitExercise(al, bil, sa, sa, hi);
    console.log('    ' + al.name.padEnd(16) + (f.fits ? `runs to ${M.degreeName(f.topDegree, bil)}${f.truncated ? '  (shortened)' : '  (full)'}` : `skipped — ${f.reason}`));
    if (f.fits) {
      const maxDeg = Math.max(...f.sequence.map(s => s.degree));
      ok(maxDeg <= f.topDegree, `${al.name} exceeded the singer's top degree`);
      const topHz = sa * Math.pow(2, f.sequence.reduce((m, s) => Math.max(m, s.semitone), 0) / 12);
      ok(topHz <= hi * 1.01, `${al.name} demands ${topHz.toFixed(0)}Hz but singer tops out at ${hi.toFixed(0)}Hz`);
    }
  }
}

head('Frequency <-> swara round trip');
const tbl = M.targets('et');
let rt = 0;
for (const tuning of ['et', 'ji']) {
  const T = M.targets(tuning);
  for (let o = -1; o <= 1; o++) for (let i = 0; i < 12; i++) {
    const hz = 261.63 * Math.pow(2, M.idealCents(i, o, T) / 1200);
    const g = M.nearestSwara(M.centsFromSa(hz, 261.63), T);
    ok(g && g.idx === i && g.octave === o, `${tuning} ${i}/${o} round trip`);
    rt++;
  }
}
console.log(`  ${rt} exact round trips`);
ok(M.nearestSwara(1e9, tbl) === null, 'absurd input must return null');

console.log('\n' + (fail ? `\x1b[31m${fail} FAILURES\x1b[0m` : '\x1b[32mAll music tests passed.\x1b[0m'));
process.exit(fail ? 1 : 0);
