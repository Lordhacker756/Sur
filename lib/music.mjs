// ---------------------------------------------------------------------------
// Sur — the music layer: swaras, pitch naming, harmonium keys, thaats,
// alankars, Sa selection from a measured range, and range tailoring.
//
// Pure ES module, no browser or Node specifics: the app, the server and the
// tests all import this same file.
// ---------------------------------------------------------------------------

/* ------------------------------------------------------------- swaras --- */
// Just-intonation values are the conventional 5-limit shruti ratios; teevra Ma
// uses 45/32, the Hindustani prati ma, not the 64/45 or 729/512 "chyuta pa".
export const SWARAS = [
  { i: 0,  s: 'S', name: 'Sa',        full: 'Shadja',         dev: 'सा', et: 0,    ji: 0,       kind: 'achal'   },
  { i: 1,  s: 'r', name: 'komal Re',  full: 'Komal Rishabh',  dev: 'रे', et: 100,  ji: 111.73,  kind: 'komal'   },
  { i: 2,  s: 'R', name: 'Re',        full: 'Shuddha Rishabh',dev: 'रे', et: 200,  ji: 203.91,  kind: 'shuddha' },
  { i: 3,  s: 'g', name: 'komal Ga',  full: 'Komal Gandhar',  dev: 'ग',  et: 300,  ji: 315.64,  kind: 'komal'   },
  { i: 4,  s: 'G', name: 'Ga',        full: 'Shuddha Gandhar',dev: 'ग',  et: 400,  ji: 386.31,  kind: 'shuddha' },
  { i: 5,  s: 'm', name: 'Ma',        full: 'Shuddha Madhyam',dev: 'म',  et: 500,  ji: 498.04,  kind: 'shuddha' },
  { i: 6,  s: 'M', name: 'teevra Ma', full: 'Teevra Madhyam', dev: 'म',  et: 600,  ji: 590.22,  kind: 'teevra'  },
  { i: 7,  s: 'P', name: 'Pa',        full: 'Pancham',        dev: 'प',  et: 700,  ji: 701.96,  kind: 'achal'   },
  { i: 8,  s: 'd', name: 'komal Dha', full: 'Komal Dhaivat',  dev: 'ध',  et: 800,  ji: 813.69,  kind: 'komal'   },
  { i: 9,  s: 'D', name: 'Dha',       full: 'Shuddha Dhaivat',dev: 'ध',  et: 900,  ji: 884.36,  kind: 'shuddha' },
  { i: 10, s: 'n', name: 'komal Ni',  full: 'Komal Nishad',   dev: 'नि', et: 1000, ji: 996.09,  kind: 'komal'   },
  { i: 11, s: 'N', name: 'Ni',        full: 'Shuddha Nishad', dev: 'नि', et: 1100, ji: 1088.27, kind: 'shuddha' },
];

export const SAPTAK = { '-2': 'ati-mandra', '-1': 'mandra', 0: 'madhya', 1: 'taar', 2: 'ati-taar' };

export function targets(tuning = 'et') {
  return SWARAS.map((s) => (tuning === 'ji' ? s.ji : s.et));
}

/* ------------------------------------------------------ western pitch --- */
export const PC_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

export function hzToMidi(hz, a4 = 440) { return 69 + 12 * Math.log2(hz / a4); }
export function midiToHz(midi, a4 = 440) { return a4 * Math.pow(2, (midi - 69) / 12); }
export function midiToName(midi) {
  const m = Math.round(midi);
  return PC_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}
export function hzToName(hz, a4 = 440) { return midiToName(hzToMidi(hz, a4)); }

/* -------------------------------------------------- harmonium keys ------ */
// Indian musicians name their Sa by harmonium key: the white keys are
// "safed" 1-7 and the black keys "kali" 1-5, counting from C within an octave.
// The NAME fixes the pitch class; the octave comes from the singer's voice.
export const HARMONIUM = [
  { pc: 0,  key: 'safed 1', white: true  },
  { pc: 1,  key: 'kali 1',  white: false },
  { pc: 2,  key: 'safed 2', white: true  },
  { pc: 3,  key: 'kali 2',  white: false },
  { pc: 4,  key: 'safed 3', white: true  },
  { pc: 5,  key: 'safed 4', white: true  },
  { pc: 6,  key: 'kali 3',  white: false },
  { pc: 7,  key: 'safed 5', white: true  },
  { pc: 8,  key: 'kali 4',  white: false },
  { pc: 9,  key: 'safed 6', white: true  },
  { pc: 10, key: 'kali 5',  white: false },
  { pc: 11, key: 'safed 7', white: true  },
];
export function harmoniumKey(midi) { return HARMONIUM[((Math.round(midi) % 12) + 12) % 12].key; }

/* ------------------------------------------------------------- thaats --- */
// The ten Bhatkhande thaats, as semitone offsets from Sa.
export const THAATS = [
  { id: 'bilawal',  name: 'Bilawal',  dev: 'बिलावल',  degrees: [0, 2, 4, 5, 7, 9, 11], note: 'all shuddha — start here' },
  { id: 'kalyan',   name: 'Kalyan',   dev: 'कल्याण',  degrees: [0, 2, 4, 6, 7, 9, 11], note: 'teevra Ma' },
  { id: 'khamaj',   name: 'Khamaj',   dev: 'खमाज',    degrees: [0, 2, 4, 5, 7, 9, 10], note: 'komal Ni' },
  { id: 'kafi',     name: 'Kafi',     dev: 'काफ़ी',    degrees: [0, 2, 3, 5, 7, 9, 10], note: 'komal Ga and Ni' },
  { id: 'asavari',  name: 'Asavari',  dev: 'आसावरी',  degrees: [0, 2, 3, 5, 7, 8, 10], note: 'komal Ga, Dha, Ni' },
  { id: 'bhairavi', name: 'Bhairavi', dev: 'भैरवी',   degrees: [0, 1, 3, 5, 7, 8, 10], note: 'all four komal' },
  { id: 'bhairav',  name: 'Bhairav',  dev: 'भैरव',    degrees: [0, 1, 4, 5, 7, 8, 11], note: 'komal Re and Dha' },
  { id: 'marwa',    name: 'Marwa',    dev: 'मारवा',   degrees: [0, 1, 4, 6, 7, 9, 11], note: 'komal Re, teevra Ma' },
  { id: 'purvi',    name: 'Purvi',    dev: 'पूर्वी',   degrees: [0, 1, 4, 6, 7, 8, 11], note: 'komal Re and Dha, teevra Ma' },
  { id: 'todi',     name: 'Todi',     dev: 'तोड़ी',    degrees: [0, 1, 3, 6, 7, 8, 11], note: 'komal Re, Ga, Dha, teevra Ma' },
];
export function thaatById(id) { return THAATS.find((t) => t.id === id) || THAATS[0]; }

/* ----------------------------------------------------------- alankars --- */
// A palta is a short motif shifted up the scale one degree at a time, then
// mirrored coming down. Encoding the motif rather than the full sequence is
// how they are actually taught, and it lets the engine stop wherever the
// singer's range runs out.
//
// Degrees are scale positions, not semitones: 0 = Sa, 1 = Re, ... 7 = taar Sa.
export const ALANKARS = [
  { id: 'aroha',   n: 1,  name: 'Aroha–Avaroha',   motif: [0],             span: 7, perBeat: 1, teaches: 'the scale itself, up and down' },
  { id: 'p3',      n: 2,  name: 'Teen swar',       motif: [0, 1, 2],       span: 7, perBeat: 3, teaches: 'three-note groups' },
  { id: 'p4',      n: 3,  name: 'Chaar swar',      motif: [0, 1, 2, 3],    span: 7, perBeat: 4, teaches: 'four-note groups, the classic palta' },
  { id: 'pairs',   n: 4,  name: 'Jod swar',        motif: [0, 0, 1, 1],    span: 7, perBeat: 4, teaches: 'repeating each swara, for steadiness' },
  { id: 'zigzag',  n: 5,  name: 'Vakra',           motif: [0, 2, 1, 3],    span: 7, perBeat: 4, teaches: 'leaping and returning' },
  { id: 'turn',    n: 6,  name: 'Aavartan',        motif: [0, 1, 2, 1],    span: 7, perBeat: 4, teaches: 'turning back on the phrase' },
  { id: 'p5',      n: 7,  name: 'Paanch swar',     motif: [0, 1, 2, 3, 4], span: 7, perBeat: 5, teaches: 'longer breath spans' },
  { id: 'skip',    n: 8,  name: 'Antar',           motif: [0, 2, 4],       span: 7, perBeat: 3, teaches: 'thirds — harder to pitch' },
  { id: 'down3',   n: 9,  name: 'Utra teen',       motif: [2, 1, 0],       span: 7, perBeat: 3, teaches: 'descending groups' },
  { id: 'wave',    n: 10, name: 'Lehar',           motif: [0, 1, 0, 2],    span: 7, perBeat: 4, teaches: 'returning to the base swara' },
];
export function alankarById(id) { return ALANKARS.find((a) => a.id === id) || ALANKARS[0]; }

/**
 * Expand an alankar into the actual sequence of scale degrees.
 * Returns [{ degree, semitone, octave }] where degree can exceed 6 (taar).
 * @param {object} al      an ALANKARS entry
 * @param {object} thaat   a THAATS entry
 * @param {number} topDegree  highest scale degree the singer can reach (7 = taar Sa)
 * @param {boolean} descend   append the mirrored descent
 */
export function expandAlankar(al, thaat, topDegree = 7, descend = true) {
  const deg = thaat.degrees;
  const semitoneOf = (d) => {
    const oct = Math.floor(d / 7);
    return deg[((d % 7) + 7) % 7] + 12 * oct;
  };
  const motifTop = Math.max(...al.motif);
  const out = [];

  // ascending: shift the motif from Sa upward while it still fits
  for (let base = 0; base + motifTop <= topDegree; base++) {
    for (const m of al.motif) {
      const d = base + m;
      out.push({ degree: d, semitone: semitoneOf(d) });
    }
  }
  if (!descend) return out;

  // descending: mirror the motif and walk back down
  const motifDown = al.motif.map((m) => motifTop - m);
  for (let base = topDegree - motifTop; base >= 0; base--) {
    for (const m of motifDown) {
      const d = base + m;
      out.push({ degree: d, semitone: semitoneOf(d) });
    }
  }
  return out;
}

/* ------------------------------------------- range -> Sa, and tailoring -- */

/**
 * Riyaz asks for roughly mandra Pa (a fourth below Sa) up to taar Sa (an
 * octave above) — about an octave and a fifth centred a little above Sa.
 * These are the semitone offsets from Sa that each tier of practice demands.
 */
export const DEMAND = {
  minimal:  { low: -5, high: 12, label: 'mandra Pa to taar Sa' },   // the classic ask
  reduced:  { low:  0, high: 12, label: 'Sa to taar Sa' },          // one octave
  narrow:   { low:  0, high:  7, label: 'Sa to Pa' },               // a fifth
};

/**
 * Recommend a Sa from a measured comfortable range.
 *
 * The traditional placement puts Sa so the singer can reach a fourth below and
 * an octave above without strain. When the measured range is too small for
 * that, we relax the demand rather than inventing range the singer does not
 * have — and say so, so the UI can be honest about it.
 *
 * @param {number} lowHz   lowest comfortable note
 * @param {number} highHz  highest comfortable note
 * @param {number} a4
 * @returns {{ candidates: Array, tier: string, semitones: number, warning: string|null }}
 */
export function recommendSa(lowHz, highHz, a4 = 440) {
  if (!(lowHz > 0) || !(highHz > lowHz)) {
    return { candidates: [], tier: 'none', semitones: 0, warning: 'That range does not look right — try the test again.' };
  }
  const lowMidi = hzToMidi(lowHz, a4);
  const highMidi = hzToMidi(highHz, a4);
  const semitones = highMidi - lowMidi;

  let tier = 'narrow';
  if (semitones >= 17) tier = 'minimal';
  else if (semitones >= 12) tier = 'reduced';

  const d = DEMAND[tier];
  const span = d.high - d.low;
  // Centre the demand inside the measured range, then snap to a semitone.
  const slack = semitones - span;
  const saMidi = Math.round(lowMidi - d.low + slack / 2);

  const mk = (midi, label, why) => {
    const hz = midiToHz(midi, a4);
    return {
      midi, hz,
      note: midiToName(midi),
      key: harmoniumKey(midi),
      label, why,
      reachLow: midiToName(Math.round(lowMidi)),
      reachHigh: midiToName(Math.round(highMidi)),
      belowSa: Math.round(saMidi - lowMidi),
      aboveSa: Math.round(highMidi - saMidi),
    };
  };

  // Plausibility gate. A recommended Sa below F2 or above E4 almost always
  // means the detector octave-halved or doubled somewhere in the sweep, not
  // that this is an exceptional voice. Say so rather than ship a bad Sa.
  const PLAUSIBLE = { lo: 41, hi: 64 };          // F2 .. E4
  if (saMidi < PLAUSIBLE.lo || saMidi > PLAUSIBLE.hi) {
    return {
      candidates: [], tier: 'implausible', semitones: Math.round(semitones * 10) / 10,
      warning: 'That came out at an unlikely pitch for a human voice, which usually means a '
             + 'note got measured an octave out. Warm up and run the test again — and if it '
             + 'happens twice, set your Sa by hand under My voice.',
    };
  }

  const candidates = [mk(saMidi, 'Recommended', 'Sits your voice evenly around Sa, ' + d.label + '.')];
  // Alternatives are only honest when there is genuinely room to move Sa and
  // still meet the demand. Below about 21 semitones there is one answer, and
  // showing three near-identical cards makes the app look like it is guessing.
  if (semitones >= 21) {
    const lower = saMidi - 2, higher = saMidi + 2;
    if (lower - d.low >= lowMidi - 0.5 && lower + d.high <= highMidi + 0.5 && lower >= PLAUSIBLE.lo) {
      candidates.push(mk(lower, 'Lower', 'A little deeper — better for kharaj sadhana, the low-register work.'));
    }
    if (higher - d.low >= lowMidi - 0.5 && higher + d.high <= highMidi + 0.5 && higher <= PLAUSIBLE.hi) {
      candidates.push(mk(higher, 'Higher', 'A little brighter — more room above for taans.'));
    }
  }
  // never offer the same semitone twice
  const seen = new Set();
  const unique = candidates.filter((c) => (seen.has(c.midi) ? false : (seen.add(c.midi), true)));
  candidates.length = 0; candidates.push(...unique);

  let warning = null;
  if (tier === 'narrow') {
    warning = 'Your comfortable range is under an octave today. That is completely normal when you are starting, or singing cold — it widens with practice. Exercises will stay inside what you have.';
  } else if (tier === 'reduced') {
    warning = 'You have about an octave to work with, so exercises will stay between Sa and taar Sa for now.';
  }
  return { candidates, tier, semitones: Math.round(semitones * 10) / 10, warning };
}

/**
 * How far up the scale can this singer actually go, given their Sa?
 * Returns the highest whole scale degree reachable inside their range.
 */
export function topDegreeFor(thaat, saHz, highHz, a4 = 440) {
  const headroom = 12 * Math.log2(highHz / saHz);     // semitones above Sa
  let top = 0;
  for (let d = 1; d <= 14; d++) {
    const oct = Math.floor(d / 7);
    const st = thaat.degrees[((d % 7) + 7) % 7] + 12 * oct;
    if (st <= headroom + 0.5) top = d; else break;
  }
  return top;
}

/**
 * Decide whether an exercise fits, and how far it should run.
 * Never silently truncates mid-motif: the run always ends on a complete phrase.
 */
export function fitExercise(al, thaat, saHz, lowHz, highHz, a4 = 440) {
  const top = topDegreeFor(thaat, saHz, highHz, a4);
  const motifTop = Math.max(...al.motif);
  const full = 7;                                     // a complete palta reaches taar Sa
  const usable = Math.min(top, full);

  if (usable < motifTop) {
    return { fits: false, topDegree: usable, reason: 'needs ' + (motifTop + 1) + ' notes of range above Sa; you have ' + (usable + 1) };
  }
  const truncated = usable < full;
  const seq = expandAlankar(al, thaat, usable, true);
  const lowDemandHz = saHz;                           // paltas start on Sa
  return {
    fits: true,
    topDegree: usable,
    truncated,
    sequence: seq,
    beats: Math.ceil(seq.length / al.perBeat),
    reason: truncated
      ? 'Shortened to stop at ' + degreeName(usable, thaat) + ', the highest swara inside your range.'
      : null,
    lowDemandHz,
    highDemandHz: saHz * Math.pow(2, (thaat.degrees[usable % 7] + 12 * Math.floor(usable / 7)) / 12),
  };
}

/** Short notation for a scale degree: S, R, G ... with a dot above for taar. */
export function degreeName(d, thaat) {
  const oct = Math.floor(d / 7);
  const semitone = thaat.degrees[((d % 7) + 7) % 7];
  const sw = SWARAS[semitone];
  const name = sw ? sw.s : '?';
  if (oct > 0) return name + '̇';
  if (oct < 0) return name + '̣';
  return name;
}

/* ------------------------------------------------ frequency -> swara ---- */
export function centsFromSa(hz, saHz) { return 1200 * Math.log2(hz / saHz); }

export function nearestSwara(cents, tbl) {
  if (!Number.isFinite(cents) || Math.abs(cents) > 6000) return null;
  const base = Math.floor(cents / 1200);
  let best = null;
  for (let o = base - 1; o <= base + 1; o++) {
    for (let i = 0; i < 12; i++) {
      const ideal = o * 1200 + tbl[i];
      const dev = cents - ideal;
      if (!best || Math.abs(dev) < Math.abs(best.cents)) best = { idx: i, octave: o, cents: dev };
    }
  }
  return best;
}
export function idealCents(idx, octave, tbl) { return octave * 1200 + tbl[idx]; }
