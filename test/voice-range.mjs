import { createDetector } from '../lib/pitch.mjs';
const SR = 48000;
const cents = (a,b)=>1200*Math.log2(a/b);
let seed = 7; const rnd=()=>{seed=(seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff*2-1;};

// Sung-vowel spectra. A voice is far richer than a flute; the fundamental is
// often NOT the strongest partial, and a phone mic attenuates it further.
const VOWEL_AH = [1, .80, .62, .45, .30, .20, .13, .08, .05];
const VOWEL_EE = [1, .55, .70, .40, .55, .25, .18, .10, .06];   // formant bumps
function micRolloff(harm, f0, cutHz) {
  // 2-pole highpass-ish attenuation of each partial, as a phone mic applies
  return harm.map((a, i) => {
    const f = f0 * (i + 1);
    const r = f / cutHz;
    return a * (r * r) / (1 + r * r);
  });
}

function sing(W, f0, harm, { noise = 0, vibRate = 5.5, vibCents = 30, gain = 0.22 } = {}) {
  const x = new Float32Array(W);
  let ph = 0;
  for (let i = 0; i < W; i++) {
    const t = i / SR;
    const f = f0 * Math.pow(2, (vibCents / 1200) * Math.sin(2 * Math.PI * vibRate * t));
    ph += 2 * Math.PI * f / SR;
    let v = 0;
    for (let h = 0; h < harm.length; h++) v += harm[h] * Math.sin((h + 1) * ph + h * 1.7);
    x[i] = gain * v + noise * rnd();      // breath / aspiration noise
  }
  return x;
}

// full singing range: low bass E2 -> high soprano C6
const NOTES = [82.41,98,110,130.81,146.83,164.81,196,220,261.63,329.63,392,440,523.25,659.25,783.99,1046.5];
const NAMES = ['E2','G2','A2','C3','D3','E3','G3','A3','C4','E4','G4','A4','C5','E5','G5','C6'];

console.log('Singing voice, E2 (82 Hz) to C6 (1047 Hz), with vibrato and breath noise.');
console.log('"phone mic" = each partial attenuated by a 2-pole rolloff at 150 Hz — the real cause of octave errors on low male voices.\n');

for (const W of [2048, 4096]) {
  const det = createDetector(W);
  const rows = [];
  let oct = 0, miss = 0, worst = 0, n = 0;
  for (const mic of [null, 150]) {
    for (let i = 0; i < NOTES.length; i++) {
      const f0 = NOTES[i];
      for (const vowel of [VOWEL_AH, VOWEL_EE]) {
        const harm = mic ? micRolloff(vowel, f0, mic) : vowel;
        seed = 7;
        const r = det.detect(sing(W, f0, harm, { noise: 0.02 }), 0, SR, 70, 1300, 0.30);
        n++;
        if (r.frequency <= 0) { miss++; rows.push(`   MISS  W=${W} ${NAMES[i]} ${mic?'phone':'good '} clarity ${r.clarity.toFixed(2)}`); continue; }
        const e = cents(r.frequency, f0);
        if (Math.abs(e) > 600) { oct++; rows.push(`   OCTAVE W=${W} ${NAMES[i]} ${mic?'phone':'good '} ${e.toFixed(0)}c`); continue; }
        if (Math.abs(e) > worst) worst = Math.abs(e);
      }
    }
  }
  const ms = (() => { seed=7; const b = sing(W, 220, VOWEL_AH); const t=process.hrtime.bigint();
    for (let i=0;i<1000;i++) det.detect(b,0,SR,70,1300,0.30);
    return Number(process.hrtime.bigint()-t)/1000/1e6; })();
  console.log(`W=${String(W).padStart(4)} (${(W/SR*1000).toFixed(0)}ms)  ${n} tests  missed ${miss}  octave-errors ${oct}  worst ${worst.toFixed(1)}c  ${ms.toFixed(3)}ms/call (${(ms/16.67*100).toFixed(1)}% frame)`);
  rows.slice(0, 8).forEach(r => console.log(r));
}

// lowest reliably detectable note per window
console.log('\nLowest note each window can hold (needs >= ~2 periods):');
for (const W of [2048, 4096, 8192]) {
  const det = createDetector(W);
  let lowest = null;
  for (let f = 65; f <= 200; f += 1) {
    seed = 7;
    const r = det.detect(sing(W, f, micRolloff(VOWEL_AH, f, 150), { noise: 0.02 }), 0, SR, 60, 1300, 0.30);
    if (r.frequency > 0 && Math.abs(cents(r.frequency, f)) < 50) { lowest = f; break; }
  }
  console.log(`  W=${String(W).padStart(4)} (${(W/SR*1000).toFixed(0)}ms latency): down to ${lowest} Hz  (${(W/SR*1000).toFixed(0)}ms window = ${(W/SR*lowest).toFixed(1)} periods at that pitch)`);
}

// ---- what clarity gate is safe for a voice? ------------------------------
console.log('\n=== CLARITY SWEEP: how many real sung notes each gate would reject ===');
for (const gate of [0.26, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60]) {
  const det = createDetector(2048);
  let missed = 0, n = 0, minClar = 1;
  for (const [i, f0] of NOTES.entries()) {
    for (const vowel of [VOWEL_AH, VOWEL_EE]) {
      for (const mic of [null, 150]) {
        for (const noise of [0.02, 0.06, 0.12]) {   // up to a very breathy tone
          const harm = mic ? micRolloff(vowel, f0, mic) : vowel;
          seed = 7; n++;
          const r = det.detect(sing(2048, f0, harm, { noise }), 0, SR, 70, 1300, gate);
          if (r.frequency <= 0) missed++;
          if (r.clarity < minClar) minClar = r.clarity;
        }
      }
    }
  }
  console.log(`  gate ${gate.toFixed(2)}  rejects ${String(missed).padStart(3)}/${n} real sung notes   (lowest clarity seen ${minClar.toFixed(2)})`);
}
