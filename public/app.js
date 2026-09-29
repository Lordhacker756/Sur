// ---------------------------------------------------------------------------
// Sur — front end: onboarding, the range test, Sa selection, practice, progress.
// ---------------------------------------------------------------------------

import * as M from '/lib/music.mjs';
import { Mic, Tanpura, playReference, DET_WINDOW, DET_WINDOW_LOW } from '/audio.js';

const $ = (id) => document.getElementById(id);
const el = new Proxy({}, { get: (_, k) => $(k) });

/* ------------------------------------------------------------- state --- */
const S = {
  singer: null, stats: null, history: [], sessions: [],
  screen: 'welcome',
  theme: localStorage.getItem('sur.theme') || 'auto',
  tbl: M.targets('et'),
};
const mic = new Mic();
let tanpura = null;

/* --------------------------------------------------------------- api --- */
async function api(path, opts) {
  const r = await fetch('/api' + path, {
    headers: { 'content-type': 'application/json' },
    ...opts,
    body: opts && opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error((body && body.error) || ('HTTP ' + r.status));
  return body;
}

/* ------------------------------------------------------------ canvas --- */
function fitCanvas(cv) {
  const r = cv.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * dpr));
  const h = Math.max(1, Math.round((r.height || cv.height) * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // setTransform, never scale(): scale is cumulative
  return { ctx, w: w / dpr, h: h / dpr, dpr };
}
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function hairline(ctx, y, x0, x1, dpr) {
  const yy = (Math.round(y * dpr) + 0.5) / dpr;
  ctx.lineWidth = 1 / dpr; ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); ctx.stroke();
}

/* ------------------------------------------------------------ screens -- */
const SCREENS = ['welcome', 'warmup', 'test', 'result', 'practice', 'range', 'progress'];
function show(name) {
  S.screen = name;
  for (const s of SCREENS) { const n = $('s-' + s); if (n) n.hidden = s !== name; }
  const onboarding = name === 'welcome' || name === 'warmup' || name === 'test' || name === 'result';
  el.tabs.hidden = onboarding;
  el.who.hidden = onboarding;
  document.querySelectorAll('#tabs button').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.screen === name)));
  if (name === 'practice') practice.enter();
  if (name === 'range') { renderVoice(); }
  if (name === 'progress') renderProgress();
  if (name === 'result') requestAnimationFrame(drawRangeStrip);
  window.scrollTo(0, 0);
}

function applyTheme() {
  if (S.theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', S.theme);
  localStorage.setItem('sur.theme', S.theme);
}

/* ══════════════════════════════════════════════════════ range test ═══ */
// Protocol: find a comfortable starting note the singer chooses themselves
// (never assume a starting pitch from gender), then step down a semitone at a
// time to the lowest note they can hold easily, then up to the highest.
//
// The edge of the comfortable range is decided by BOTH the singer and the
// audio. The singer's own "that is as far as I go" always wins, because the
// only person who can feel strain is them.
const TEST = {
  HOLD_MS: 1500,            // how long a note must be held to count
  MATCH_CENTS: 70,          // within this of the target counts as "on the note"
  ATTEMPT_MS: 7000,         // give up on a step after this
  MAX_STEPS: 18,            // never march further than an octave and a half either way
  SHAKY_SD: 38,             // cents SD above which a held note is at the edge
  BREATHY: 0.45,            // clarity below which the tone has gone
};

/** Name a pitch as a swara relative to a reference Sa, which is how a singer
 *  hears it. Western names stay available as small secondary text for anyone
 *  cross-checking against a keyboard or a tuner. */
export function swaraLabel(midi, saMidi) {
  const n = M.nearestSwara((midi - saMidi) * 100, M.targets('et'));
  if (!n) return { dev: '', name: M.midiToName(midi), west: M.midiToName(midi) };
  const sw = M.SWARAS[n.idx];
  const oct = n.octave;
  const prefix = oct < -1 ? 'ati-mandra ' : oct === -1 ? 'mandra ' : oct === 1 ? 'taar ' : oct > 1 ? 'ati-taar ' : '';
  return { dev: sw.dev, name: prefix + sw.name, west: M.midiToName(midi), sw, octave: oct };
}

const test = {
  dir: 'down', startMidi: null, cur: null, low: null, high: null,
  heldMs: 0, t0: 0, fails: 0, steps: 0, samples: [], active: false, phase: 'find-start',

  begin() {
    this.dir = 'down'; this.startMidi = null; this.cur = null;
    this.low = null; this.high = null; this.fails = 0; this.steps = 0;
    this.phase = 'find-start'; this.active = true;
    el.testStep.textContent = 'Step 2 of 3 · finding a comfortable note';
    el.testTitle.textContent = 'Sing any comfortable note';
    el.testHint.textContent = 'Sing “aa” at whatever pitch feels easiest — the note you would hum without thinking. Hold it steady.';
    el.targetDev.textContent = '\u2014';
    el.targetNote.textContent = '\u2014';
    el.targetHz.textContent = 'listening';
    el.playTarget.hidden = true;
    el.tooFar.hidden = true;
    el.skipNote.hidden = true;
    this._resetHold();
    show('test');
  },

  _resetHold() { this.heldMs = 0; this.samples = []; this.t0 = performance.now(); this._ring(0); },
  _ring(p) {
    const C = 2 * Math.PI * 52;
    el.holdRing.style.strokeDashoffset = String(C * (1 - Math.max(0, Math.min(1, p))));
  },

  /** called every audio frame */
  frame(live, dt) {
    if (!this.active) return;

    if (this.phase === 'find-start') {
      if (live.voiced) {
        this.samples.push(live.hz);
        this.heldMs += dt * 1000;
        this._ring(this.heldMs / 1200);
        el.holdLabel.textContent = 'good';
        if (this.heldMs >= 1200 && this.samples.length > 20) {
          const sorted = this.samples.slice().sort((a, b) => a - b);
          const hz = sorted[sorted.length >> 1];
          this.startMidi = Math.round(M.hzToMidi(hz, S.singer.a4));
          this.low = this.startMidi; this.high = this.startMidi;
          this.phase = 'step';
          this.dir = 'down';
          this.cur = this.startMidi;
          el.playTarget.hidden = false; el.tooFar.hidden = false; el.skipNote.hidden = false;
          el.testHint.textContent = 'Good — we will call that your Sa for now, and name everything from it. Sing each swara you hear and hold it steady.';
          this._next(-1);
        }
      } else { this.heldMs = Math.max(0, this.heldMs - dt * 600); this._ring(this.heldMs / 1200); el.holdLabel.textContent = 'sing'; }
      drawLadder();
      return;
    }

    const targetHz = M.midiToHz(this.cur, S.singer.a4);
    const cents = live.voiced ? 1200 * Math.log2(live.hz / targetHz) : null;

    el.matchYou.style.opacity = cents === null ? '0' : '1';
    if (cents !== null) {
      el.matchYou.style.left = (50 + Math.max(-1, Math.min(1, cents / 150)) * 50) + '%';
      const good = Math.abs(cents) <= TEST.MATCH_CENTS;
      el.matchYou.style.background = good ? 'var(--good)' : 'var(--accent)';
      el.matchCents.textContent = (cents >= 0 ? '+' : '−') + Math.abs(Math.round(cents)) + '¢';
    } else el.matchCents.textContent = '—';

    const on = cents !== null && Math.abs(cents) <= TEST.MATCH_CENTS;
    if (on) {
      this.heldMs += dt * 1000;
      this.samples.push(cents);
      el.holdLabel.textContent = 'hold…';
    } else {
      this.heldMs = Math.max(0, this.heldMs - dt * 700);
      this.samples.length = 0;
      el.holdLabel.textContent = live.voiced ? 'find the note' : 'sing';
    }
    this._ring(this.heldMs / TEST.HOLD_MS);

    if (this.heldMs >= TEST.HOLD_MS) { this._reached(live); return; }
    if (performance.now() - this.t0 > TEST.ATTEMPT_MS) { this._failed(); return; }
    drawLadder();
  },

  _stats() {
    const a = this.samples;
    if (a.length < 4) return { sd: 0 };
    const mu = a.reduce((x, y) => x + y, 0) / a.length;
    return { sd: Math.sqrt(a.reduce((s, v) => s + (v - mu) * (v - mu), 0) / a.length) };
  },

  _reached(live) {
    const { sd } = this._stats();
    // A note that was reached but wobbled badly, or went breathy, is the edge
    // of the comfortable range rather than a note to build exercises on.
    const shaky = sd > TEST.SHAKY_SD || live.clarity < TEST.BREATHY;
    if (this.dir === 'down') this.low = Math.min(this.low, this.cur);
    else this.high = Math.max(this.high, this.cur);
    this.fails = 0;
    if (shaky) { this._edge('That one was getting shaky, so we will call it the edge.'); return; }
    this._next(this.dir === 'down' ? -1 : 1);
  },

  _failed() {
    this.fails++;
    if (this.fails >= 2) { this._edge('That note is out of reach today — which is exactly what we needed to know.'); return; }
    this._next(0);       // retry the same note once
  },

  _edge(msg) {
    if (this.dir === 'down') {
      this.dir = 'up'; this.fails = 0; this.steps = 0;
      this.cur = this.startMidi;
      el.testStep.textContent = 'Step 2 of 3 · now going up';
      el.testHint.textContent = msg + ' Now the other direction — same thing, and stop the moment it feels like work.';
      this._next(1);
    } else {
      this.finish();
    }
  },

  _next(delta) {
    if (delta !== 0) this.steps++;
    if (this.steps > TEST.MAX_STEPS) { this._edge('That is plenty in this direction.'); return; }
    this.cur += delta;
    if (this.cur < 30 || this.cur > 96) { this._edge('We have reached the end of the useful range.'); return; }
    const hz = M.midiToHz(this.cur, S.singer.a4);
    const lab = swaraLabel(this.cur, this.startMidi);
    el.testTitle.textContent = 'Sing this swara';
    el.testStep.textContent = 'Step 2 of 3 · ' + (this.dir === 'down' ? 'going down' : 'going up');
    el.targetDev.textContent = lab.dev;
    el.targetNote.textContent = lab.name;
    el.targetHz.textContent = lab.west + ' · ' + hz.toFixed(1) + ' Hz';
    playReference(mic.ctx, hz);
    this._resetHold();
    drawLadder();
  },

  giveUp() {
    if (!this.active) return;
    if (this.phase === 'find-start') return;
    this._edge('Good — that is the honest answer.');
  },

  skip() { if (this.active && this.phase === 'step') this._next(this.dir === 'down' ? -1 : 1); },

  async finish() {
    this.active = false;
    const a4 = S.singer.a4;
    const lowHz = M.midiToHz(this.low, a4), highHz = M.midiToHz(this.high, a4);
    const rec = M.recommendSa(lowHz, highHz, a4);
    S.pending = {
      low_hz: lowHz, high_hz: highHz,
      low_note: M.midiToName(this.low), high_note: M.midiToName(this.high),
      semitones: this.high - this.low, tier: rec.tier, warmed_up: S.warmedUp ? 1 : 0,
      rec,
    };
    // show first, then render: a canvas measured while its screen is still
    // hidden reports a zero-width box and comes out one pixel wide.
    show('result');
    renderResult();
  },
};

function drawLadder() {
  const cv = el.ladder; if (!cv || cv.offsetParent === null) return;
  const { ctx, w, h, dpr } = fitCanvas(cv);
  ctx.fillStyle = css('--surface'); ctx.fillRect(0, 0, w, h);
  const lo = (test.low ?? test.startMidi ?? 60) - 4;
  const hi = (test.high ?? test.startMidi ?? 60) + 4;
  const pad = 16, span = Math.max(12, hi - lo);
  const Y = (m) => h - pad - ((m - lo) / span) * (h - pad * 2);

  const ref = test.startMidi;
  ctx.textBaseline = 'middle';
  for (let m = Math.ceil(lo); m <= hi; m++) {
    const y = Y(m);
    const isSa = ref !== null && ((m - ref) % 12 + 12) % 12 === 0;
    ctx.strokeStyle = isSa ? css('--grid-strong') : css('--grid');
    hairline(ctx, y, 42, w - 10, dpr);
    if (ref === null) {
      if (((m % 12) + 12) % 12 === 0) {
        ctx.font = '11px "DM Mono", monospace'; ctx.fillStyle = css('--faint');
        ctx.fillText(M.midiToName(m), 6, y);
      }
      continue;
    }
    const lab = swaraLabel(m, ref);
    ctx.font = (isSa ? '600 ' : '') + '12px "Newsreader", serif';
    ctx.fillStyle = isSa ? css('--text') : css('--faint');
    const mark = lab.octave < 0 ? '\u0323' : lab.octave > 0 ? '\u0307' : '';
    ctx.fillText(lab.sw.s + mark, 6, y);
  }
  if (test.low !== null && test.high !== null) {
    ctx.fillStyle = css('--accent-wash');
    ctx.fillRect(42, Y(test.high), w - 52, Math.max(2, Y(test.low) - Y(test.high)));
    ctx.strokeStyle = css('--accent'); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(46, Y(test.low)); ctx.lineTo(w - 14, Y(test.low)); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(46, Y(test.high)); ctx.lineTo(w - 14, Y(test.high)); ctx.stroke();
  }
  if (test.cur !== null && test.active) {
    ctx.fillStyle = css('--accent');
    const y = Y(test.cur);
    ctx.beginPath(); ctx.arc(w - 20, y, 5, 0, 7); ctx.fill();
  }
  if (mic.live.voiced) {
    const m = M.hzToMidi(mic.live.hz, S.singer ? S.singer.a4 : 440);
    if (m >= lo && m <= hi) {
      ctx.fillStyle = css('--good');
      ctx.beginPath(); ctx.arc(52, Y(m), 5, 0, 7); ctx.fill();
    }
  }
}

/* ══════════════════════════════════════════════════════════ result ═══ */
let chosenSa = null;
function renderResult() {
  const p = S.pending; if (!p) return;
  const oct = Math.floor(p.semitones / 12), rem = p.semitones % 12;
  el.rSpan.textContent = (oct ? oct + (oct > 1 ? ' octaves' : ' octave') : '') + (oct && rem ? ' and ' : '') + (rem ? rem + ' semitones' : '') || p.semitones + ' semitones';

  el.rangeNote.hidden = !p.rec.warning;
  if (p.rec.warning) el.rangeNote.textContent = p.rec.warning;

  chosenSa = p.rec.candidates[0] || null;
  updateRangeWords();          // only meaningful once a Sa is chosen
  el.saChoices.innerHTML = '';
  for (const c of p.rec.candidates) {
    const b = document.createElement('button');
    b.className = 'sachoice';
    b.type = 'button';
    b.setAttribute('aria-pressed', String(c === chosenSa));
    b.innerHTML =
      `<span class="big">${c.note}</span>` +
      `<span><span class="lab">${c.label} · ${c.key}</span><span class="why">${c.why}</span></span>` +
      `<span class="tag">${c.hz.toFixed(1)} Hz<br>down to ${swaraLabel(Math.round(M.hzToMidi(p.low_hz, S.singer.a4)), c.midi).name}<br>up to ${swaraLabel(Math.round(M.hzToMidi(p.high_hz, S.singer.a4)), c.midi).name}</span>`;
    b.onclick = () => {
      chosenSa = c;
      [...el.saChoices.children].forEach((n, i) => n.setAttribute('aria-pressed', String(p.rec.candidates[i] === c)));
      updateRangeWords(); drawRangeStrip();
    };
    el.saChoices.appendChild(b);
  }
  drawRangeStrip();
}

/** The range, said in swaras relative to whichever Sa is currently selected. */
function updateRangeWords() {
  const p = S.pending; if (!p) return;
  const a4 = S.singer.a4;
  const loM = Math.round(M.hzToMidi(p.low_hz, a4)), hiM = Math.round(M.hzToMidi(p.high_hz, a4));
  if (chosenSa) {
    const lo = swaraLabel(loM, chosenSa.midi), hi = swaraLabel(hiM, chosenSa.midi);
    el.rLow.textContent = lo.name;
    el.rHigh.textContent = hi.name;
    el.rLowW.textContent = lo.west;
    el.rHighW.textContent = hi.west;
  } else {
    el.rLow.textContent = p.low_note; el.rHigh.textContent = p.high_note;
    el.rLowW.textContent = ''; el.rHighW.textContent = '';
  }
}

function drawRangeStrip() {
  const cv = el.rangeStrip; if (!cv) return;
  const { ctx, w, h, dpr } = fitCanvas(cv);
  ctx.fillStyle = css('--surface'); ctx.fillRect(0, 0, w, h);
  const p = S.pending || (S.singer && S.singer.low_hz
    ? { low_hz: S.singer.low_hz, high_hz: S.singer.high_hz } : null);
  if (!p) return;
  const a4 = S.singer.a4;
  const loM = M.hzToMidi(p.low_hz, a4), hiM = M.hzToMidi(p.high_hz, a4);
  const from = loM - 3, to = hiM + 3;
  const X = (m) => 10 + ((m - from) / (to - from)) * (w - 20);
  const barTop = 30, barH = 26;

  // the range itself
  ctx.fillStyle = css('--surface-2');
  ctx.fillRect(10, barTop, w - 20, barH);
  ctx.fillStyle = css('--accent-wash');
  ctx.fillRect(X(loM), barTop, X(hiM) - X(loM), barH);
  ctx.strokeStyle = css('--accent'); ctx.lineWidth = 2;
  ctx.strokeRect(X(loM) + 1, barTop + 1, X(hiM) - X(loM) - 2, barH - 2);

  // swaras of the chosen Sa, so the strip is read in the singer's own terms
  const saM = chosenSa ? chosenSa.midi
            : (S.singer && S.singer.sa_hz ? Math.round(M.hzToMidi(S.singer.sa_hz, a4)) : null);
  if (saM === null) return;
  ctx.textAlign = 'center';
  for (let m = Math.ceil(from); m <= to; m++) {
    const rel = ((m - saM) % 12 + 12) % 12;
    const isSa = rel === 0, isPa = rel === 7;
    if (!isSa && !isPa && (to - from) > 26) continue;
    const x = X(m), inR = m >= loM - 0.5 && m <= hiM + 0.5;
    ctx.strokeStyle = isSa ? css('--text') : css('--grid-strong');
    ctx.lineWidth = isSa ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x, barTop - (isSa ? 8 : 3));
    ctx.lineTo(x, barTop + barH + (isSa ? 8 : 3));
    ctx.stroke();
    const lab = swaraLabel(m, saM);
    const oct = lab.octave;
    ctx.fillStyle = isSa ? css('--text') : (inR ? css('--muted') : css('--faint'));
    ctx.font = (isSa ? '600 ' : '') + '12px "Newsreader", serif';
    ctx.fillText(lab.sw.s + (oct < 0 ? '\u0323' : oct > 0 ? '\u0307' : ''), x, barTop - 12);
  }
  // the two ends, named
  ctx.font = '11px "DM Mono", monospace'; ctx.fillStyle = css('--faint');
  ctx.textAlign = 'left';  ctx.fillText(M.midiToName(Math.round(loM)), X(loM), h - 6);
  ctx.textAlign = 'right'; ctx.fillText(M.midiToName(Math.round(hiM)), X(hiM), h - 6);
  ctx.textAlign = 'left';
}

/* ════════════════════════════════════════════════════════ practice ═══ */
const practice = {
  ex: 'p3', thaat: 'bilawal', seq: [], pos: 0, marks: [],
  hist: [], sessionId: null, t0: 0, notes: [], stat: new Map(),
  lastIdx: -1, labelRun: 0, dispCents: 0, held: 0, cur: null,

  enter() {
    if (!S.singer || !S.singer.sa_hz) { show('welcome'); return; }
    el.pSa.textContent = S.singer.sa_note || (S.singer.sa_hz.toFixed(1) + ' Hz');
    el.pKey.textContent = S.singer.sa_key || '';
    if (!el.exSelect.options.length) {
      el.exSelect.innerHTML = M.ALANKARS.map((a) => `<option value="${a.id}">${a.n}. ${a.name}</option>`).join('');
      el.thaatSelect.innerHTML = M.THAATS.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
    }
    el.exSelect.value = this.ex;
    el.thaatSelect.value = S.singer.thaat || this.thaat;
    this.thaat = el.thaatSelect.value;
    this.build();
  },

  build() {
    const th = M.thaatById(this.thaat);
    const al = M.alankarById(this.ex);
    const fit = M.fitExercise(al, th, S.singer.sa_hz, S.singer.low_hz || S.singer.sa_hz,
                              S.singer.high_hz || S.singer.sa_hz * 2, S.singer.a4);
    el.exTitle.textContent = al.name;
    this.seq = fit.fits ? fit.sequence : [];
    this.pos = 0; this.marks = [];
    if (!fit.fits) {
      el.seq.innerHTML = '';
      el.exFoot.textContent = 'This one does not fit your range yet — it ' + fit.reason + '. Try a shorter pattern, or retest after a warm-up.';
      el.exMeta.textContent = 'out of range';
      return;
    }
    el.exMeta.textContent = al.teaches;
    el.exFoot.textContent = fit.truncated
      ? fit.reason + ' That is not a limitation to worry about — it is the exercise fitting you rather than the other way round.'
      : 'Full pattern, Sa to taar Sa.';
    this.renderSeq();
  },

  renderSeq() {
    const th = M.thaatById(this.thaat);
    const al = M.alankarById(this.ex);
    let html = '';
    this.seq.forEach((s, i) => {
      if (i && i % al.motif.length === 0) html += '<span class="bar"></span>';
      const cls = this.marks[i] === 1 ? 'hit' : this.marks[i] === 2 ? 'miss' : i === this.pos ? 'now' : '';
      html += `<span class="${cls}">${M.degreeName(s.degree, th)}</span>`;
    });
    el.seq.innerHTML = html;
  },

  frame(live, dt, atime) {
    const sa = S.singer.sa_hz;
    const voiced = live.voiced;
    el.bignote.classList.toggle('idle', !voiced);

    let dev = 0, idx = -1, oct = 0;
    if (voiced) {
      const c = M.centsFromSa(live.hz, sa);
      const n = M.nearestSwara(c, S.tbl);
      if (n) {
        dev = n.cents; idx = n.idx; oct = n.octave;
        if (idx !== this.lastIdx) { if (++this.labelRun >= 3) { this.lastIdx = idx; this.lastOct = oct; this.labelRun = 0; } }
        else this.labelRun = 0;
      }
    } else { this.labelRun = 0; }

    this.dispCents += ((voiced ? dev : 0) - this.dispCents) * (1 - Math.exp(-dt / 0.07));
    this.hist.push({ t: atime, c: voiced ? M.centsFromSa(live.hz, sa) : null, dev, ok: voiced });
    if (this.hist.length > 1200) this.hist.shift();

    if (voiced && this.lastIdx >= 0) {
      const sw = M.SWARAS[this.lastIdx];
      el.bigDev.textContent = sw.dev;
      el.bigName.textContent = sw.name;
      el.bigOct.textContent = (M.SAPTAK[this.lastOct] || '') + ' saptak';
      const tol = S.singer.tol_cents || 25;
      const inTune = Math.abs(this.dispCents) <= tol;
      el.needle.style.opacity = '1';
      el.needle.style.left = (50 + Math.max(-1, Math.min(1, this.dispCents / 50)) * 50) + '%';
      el.needle.style.background = inTune ? 'var(--good)' : Math.abs(this.dispCents) <= tol * 2 ? 'var(--warn)' : 'var(--bad)';
      el.bigCents.textContent = (this.dispCents >= 0 ? '+' : '−') + Math.abs(Math.round(this.dispCents)) + ' cents' + (inTune ? ' · in tune' : this.dispCents > 0 ? ' · sharp' : ' · flat');
      el.bigCents.style.color = inTune ? 'var(--good)' : '';

      // record per-swara accuracy for the session summary
      const key = this.lastIdx + ':' + this.lastOct;
      let st = this.stat.get(key);
      if (!st) { st = { swara: this.lastIdx, octave: this.lastOct, n: 0, sum: 0, sum2: 0 }; this.stat.set(key, st); }
      st.n++; st.sum += dev; st.sum2 += dev * dev;

      // advance the exercise when the expected swara is held in tune
      const want = this.seq[this.pos];
      if (want) {
        const th = M.thaatById(this.thaat);
        const wantIdx = th.degrees[((want.degree % 7) + 7) % 7];
        const wantOct = Math.floor(want.degree / 7);
        if (this.lastIdx === wantIdx && this.lastOct === wantOct && inTune) {
          this.held += dt * 1000;
          if (this.held > 420) { this.marks[this.pos] = 1; this.pos++; this.held = 0; this.renderSeq(); this.checkDone(); }
        } else this.held = Math.max(0, this.held - dt * 400);
      }
    } else if (live.bleeding) {
      // We can hear the tanpura but not the singer over it.
      el.bigDev.textContent = '—';
      el.bigName.textContent = 'Tanpura only';
      el.bigOct.textContent = 'Sur cannot hear you over it';
      el.bigCents.textContent = 'use headphones';
      el.bigCents.style.color = 'var(--warn)';
      el.needle.style.opacity = '0';
    } else {
      el.bigDev.textContent = '—'; el.bigName.textContent = 'Silence';
      el.bigOct.textContent = 'sing something'; el.bigCents.textContent = '—';
      el.bigCents.style.color = ''; el.needle.style.opacity = '0';
    }
    drawRibbon(atime);
  },

  checkDone() {
    if (this.pos < this.seq.length) return;
    const hits = this.marks.filter((m) => m === 1).length;
    addCoach('✓', 'Run complete', `${hits} of ${this.seq.length} swaras landed in tune. ` +
      (hits === this.seq.length ? 'Every one. Go again a little faster.' : 'Go again — the ones you missed will come.'), 'good');
    this.pos = 0; this.marks = []; this.renderSeq();
  },

  async startSession() {
    this.t0 = performance.now(); this.stat.clear(); this.hist.length = 0;
    try {
      const r = await api('/session', { method: 'POST', body: { exercise: this.ex, thaat: this.thaat, sa_hz: S.singer.sa_hz } });
      this.sessionId = r.id;
    } catch { this.sessionId = null; }
  },

  async endSession() {
    if (!this.sessionId) return;
    const seconds = (performance.now() - this.t0) / 1000;
    const swaras = [...this.stat.values()].map((s) => ({
      swara: s.swara, octave: s.octave, n: s.n,
      mean_cents: s.sum / s.n,
      sd_cents: Math.sqrt(Math.max(0, s.sum2 / s.n - (s.sum / s.n) ** 2)),
    }));
    const total = swaras.reduce((a, s) => a + s.n, 0);
    const tol = S.singer.tol_cents || 25;
    const inTune = swaras.reduce((a, s) => a + (Math.abs(s.mean_cents) <= tol ? s.n : 0), 0);
    const meanAbs = total ? swaras.reduce((a, s) => a + Math.abs(s.mean_cents) * s.n, 0) / total : null;
    try {
      await api('/session/' + this.sessionId, { method: 'PUT', body: {
        seconds, notes_sung: total, in_tune: inTune, mean_abs_cents: meanAbs,
        score: total ? Math.round(100 * inTune / total) : null, swaras } });
    } catch {}
    this.sessionId = null;
    await refresh();
  },
};

function addCoach(sw, title, msg, tone) {
  if (el.coach.firstElementChild && el.coach.firstElementChild.className === 'empty') el.coach.innerHTML = '';
  const d = document.createElement('div');
  d.className = 'coachcard';
  const col = tone === 'good' ? 'var(--good)' : tone === 'bad' ? 'var(--bad)' : 'var(--warn)';
  d.innerHTML = `<div class="sw">${sw}</div><div class="msg"><span class="l" style="color:var(--text);font-weight:600">${title}</span><span class="l">${msg}</span></div><div class="sc" style="color:${col}">·</div>`;
  el.coach.insertBefore(d, el.coach.firstChild);
  while (el.coach.children.length > 30) el.coach.removeChild(el.coach.lastChild);
}

function drawRibbon(now) {
  const cv = el.ribbon; if (!cv || cv.offsetParent === null) return;
  const { ctx, w, h, dpr } = fitCanvas(cv);
  ctx.fillStyle = css('--surface'); ctx.fillRect(0, 0, w, h);
  const span = 12, t0 = now - span;
  const padL = 34;
  const lo = -700, hi = 1500;          // mandra Pa to a little over taar Sa
  const X = (t) => padL + ((t - t0) / span) * (w - padL - 8);
  const Y = (c) => h - 8 - ((c - lo) / (hi - lo)) * (h - 16);
  const th = M.thaatById(practice.thaat);

  ctx.font = '10px "DM Mono", monospace'; ctx.textBaseline = 'middle';
  for (let o = -1; o <= 1; o++) {
    for (const st of th.degrees) {
      const c = o * 1200 + st;
      if (c < lo || c > hi) continue;
      const y = Y(c), isSa = st === 0;
      ctx.strokeStyle = isSa ? css('--grid-strong') : css('--grid');
      hairline(ctx, y, padL, w - 8, dpr);
      ctx.fillStyle = isSa ? css('--text') : css('--faint');
      ctx.fillText(M.SWARAS[st].s + (o > 0 ? '̇' : o < 0 ? '̣' : ''), 6, y);
    }
  }
  const tol = S.singer ? (S.singer.tol_cents || 25) : 25;
  const good = new Path2D(), near = new Path2D(), off = new Path2D();
  let prev = false, pb = -1;
  for (const s of practice.hist) {
    if (s.t < t0) continue;
    if (!s.ok || s.c === null) { prev = false; continue; }
    const a = Math.abs(s.dev);
    const b = a <= tol ? 0 : a <= tol * 2 ? 1 : 2;
    const p = b === 0 ? good : b === 1 ? near : off;
    const x = X(s.t), y = Y(s.c);
    if (!prev || b !== pb) p.moveTo(x, y); else p.lineTo(x, y);
    prev = true; pb = b;
  }
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = css('--good'); ctx.stroke(good);
  ctx.strokeStyle = css('--warn'); ctx.stroke(near);
  ctx.strokeStyle = css('--bad');  ctx.stroke(off);
  el.ribbonMeta.textContent = 'last 12 s';
}

/* ══════════════════════════════════════════════════════ my voice ═════ */
function rangeWords(s) {
  if (!s.sa_hz || !s.low_hz || !s.high_hz) return '—';
  const saM = Math.round(M.hzToMidi(s.sa_hz, s.a4));
  const lo = swaraLabel(Math.round(M.hzToMidi(s.low_hz, s.a4)), saM);
  const hi = swaraLabel(Math.round(M.hzToMidi(s.high_hz, s.a4)), saM);
  return lo.name + ' – ' + hi.name;
}

function renderVoice() {
  const s = S.singer;
  el.voiceSummary.innerHTML = s.sa_hz
    ? `<div class="rangecard-row">
         <div><span class="k">Sa</span><span class="v mono">${s.sa_note} <small style="font-size:13px;color:var(--accent)">${s.sa_key || ''}</small></span></div>
         <div><span class="k">Range</span><span class="v">${rangeWords(s)}</span><span class="sub mono">${s.low_note || '?'} – ${s.high_note || '?'}</span></div>
         <div><span class="k">Span</span><span class="v">${s.semitones || '?'} semitones</span></div>
       </div>`
    : '<p class="lede">No range measured yet.</p>';
  el.setName.value = s.name || '';
  el.setSaHz.value = s.sa_hz ? Number(s.sa_hz).toFixed(2) : '';
  el.setSaHint.textContent = s.sa_note ? `${s.sa_note} · ${s.sa_key}` : 'set by the range test';
  el.setA4.value = s.a4;
  el.setTol.value = s.tol_cents;
  el.setTolHint.textContent = `±${s.tol_cents} cents — ${s.tol_cents >= 35 ? 'gentle, good while learning' : s.tol_cents >= 20 ? 'normal' : 'strict'}`;
  document.querySelectorAll('[data-tuning]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tuning === s.tuning)));
  document.querySelectorAll('[data-theme]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === S.theme)));

  el.rangeHistory.innerHTML = S.history.length
    ? '<div class="rows">' + S.history.map((r) =>
        `<div class="row"><span class="when">${new Date(r.taken_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>` +
        `<span class="what">${r.low_note} – ${r.high_note}</span>` +
        `<span class="more">${r.semitones} semitones${r.warmed_up ? '' : ' · not warmed up'}</span></div>`).join('') + '</div>'
    : '<p class="fine">No tests yet.</p>';
}

/* ══════════════════════════════════════════════════════ progress ════ */
function renderProgress() {
  const st = S.stats;
  const mins = Math.round((st.totals.seconds || 0) / 60);
  const acc = st.totals.notes ? Math.round(100 * st.totals.in_tune / st.totals.notes) : null;
  el.statRow.innerHTML = [
    ['Practice streak', st.streak + (st.streak === 1 ? ' day' : ' days')],
    ['Sessions', st.totals.sessions],
    ['Time sung', mins >= 60 ? (mins / 60).toFixed(1) + '<small> hours</small>' : mins + '<small> min</small>'],
    ['In tune', acc === null ? '—' : acc + '<small>%</small>'],
  ].map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');

  drawTrend(); drawSwaraChart();

  el.sessionList.innerHTML = S.sessions.length
    ? '<div class="rows">' + S.sessions.map((s) => {
        const al = M.ALANKARS.find((a) => a.id === s.exercise);
        return `<div class="row"><span class="when">${new Date(s.started_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>` +
          `<span class="what">${al ? al.name : s.exercise || 'Free practice'}</span>` +
          `<span class="more">${Math.round(s.seconds / 60)} min · ${s.score != null ? s.score + '% in tune' : '—'}</span></div>`;
      }).join('') + '</div>'
    : '<p class="fine" style="padding:16px">Nothing yet. Your sessions will collect here.</p>';
}

function drawTrend() {
  const cv = el.trendChart; const { ctx, w, h, dpr } = fitCanvas(cv);
  ctx.fillStyle = css('--surface'); ctx.fillRect(0, 0, w, h);
  const d = (S.stats.rangeTrend || []).filter((r) => r.low_hz && r.high_hz);
  if (d.length < 1) { ctx.fillStyle = css('--faint'); ctx.font = '13px "Figtree",sans-serif';
    ctx.fillText('Take the range test a few times and your range over the weeks appears here.', 16, h / 2); return; }
  const a4 = S.singer.a4;
  const mids = d.flatMap((r) => [M.hzToMidi(r.low_hz, a4), M.hzToMidi(r.high_hz, a4)]);
  const lo = Math.floor(Math.min(...mids)) - 2, hi = Math.ceil(Math.max(...mids)) + 2;
  const padL = 40, padB = 22;
  const X = (i) => padL + (d.length === 1 ? (w - padL - 12) / 2 : (i / (d.length - 1)) * (w - padL - 12));
  const Y = (m) => h - padB - ((m - lo) / (hi - lo)) * (h - padB - 12);
  ctx.strokeStyle = css('--grid'); ctx.font = '10px "DM Mono",monospace'; ctx.textBaseline = 'middle';
  for (let m = Math.ceil(lo); m <= hi; m++) if (((m % 12) + 12) % 12 === 0) {
    hairline(ctx, Y(m), padL, w - 12, dpr);
    ctx.fillStyle = css('--faint'); ctx.fillText(M.midiToName(m), 6, Y(m));
  }
  ctx.fillStyle = css('--accent-wash');
  ctx.beginPath();
  d.forEach((r, i) => { const x = X(i), y = Y(M.hzToMidi(r.high_hz, a4)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  for (let i = d.length - 1; i >= 0; i--) ctx.lineTo(X(i), Y(M.hzToMidi(d[i].low_hz, a4)));
  ctx.closePath(); ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = css('--accent');
  for (const pick of ['high_hz', 'low_hz']) {
    ctx.beginPath();
    d.forEach((r, i) => { const x = X(i), y = Y(M.hzToMidi(r[pick], a4)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
  }
}

function drawSwaraChart() {
  const cv = el.swaraChart; const { ctx, w, h, dpr } = fitCanvas(cv);
  ctx.fillStyle = css('--surface'); ctx.fillRect(0, 0, w, h);
  const rows = (S.stats.perSwara || []).filter((r) => r.n >= 3);
  if (!rows.length) { ctx.fillStyle = css('--faint'); ctx.font = '13px "Figtree",sans-serif';
    ctx.fillText('Sing a few exercises and the swaras you drift on will show up here.', 16, h / 2); return; }
  const agg = new Map();
  for (const r of rows) {
    const a = agg.get(r.swara) || { n: 0, sum: 0 };
    a.n += r.n; a.sum += r.mean_cents * r.n; agg.set(r.swara, a);
  }
  const padB = 26, mid = (h - padB) / 2, maxC = 40;
  const bw = (w - 20) / 12;
  ctx.strokeStyle = css('--grid-strong'); hairline(ctx, mid, 10, w - 10, dpr);
  ctx.font = '11px "Newsreader",serif'; ctx.textAlign = 'center';
  for (let i = 0; i < 12; i++) {
    const x = 10 + i * bw + bw / 2;
    const a = agg.get(i);
    ctx.fillStyle = css('--faint');
    ctx.fillText(M.SWARAS[i].s, x, h - 8);
    if (!a) continue;
    const c = Math.max(-maxC, Math.min(maxC, a.sum / a.n));
    const y = mid - (c / maxC) * (mid - 10);
    const tol = S.singer.tol_cents || 25;
    ctx.fillStyle = Math.abs(c) <= tol ? css('--good') : Math.abs(c) <= tol * 1.8 ? css('--warn') : css('--bad');
    ctx.fillRect(x - bw * 0.3, Math.min(y, mid), bw * 0.6, Math.abs(y - mid));
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = css('--faint'); ctx.font = '10px "DM Mono",monospace';
  ctx.fillText('sharp', 12, 14); ctx.fillText('flat', 12, h - padB - 2);
}

/* ══════════════════════════════════════════════════════════ boot ════ */
async function refresh() {
  const b = await api('/bootstrap');
  S.singer = b.singer; S.stats = b.stats; S.history = b.rangeHistory; S.sessions = b.sessions;
  S.tbl = M.targets(S.singer.tuning);
  el.who.textContent = S.singer.name;
  if (tanpura && S.singer.sa_hz) tanpura.setSa(S.singer.sa_hz);
}

async function ensureMic() {
  try {
    // A low voice needs the longer analysis window; pick it from the range we
    // already know about before the microphone is opened.
    const low = S.singer && S.singer.low_hz;
    mic.window = (low && low < 150) ? DET_WINDOW_LOW : DET_WINDOW;
    await mic.start();
    if (!tanpura) tanpura = new Tanpura(mic.ctx);
    if (S.singer && S.singer.sa_hz) tanpura.setSa(S.singer.sa_hz);
    el.pracWarn.hidden = !mic.constraintWarning;
    if (mic.constraintWarning) el.pracWarn.textContent = mic.constraintWarning;
    return true;
  } catch (e) {
    const d = Mic.describeError(e);
    el.welcomeErr.hidden = false;
    el.welcomeErr.innerHTML = '';
    const b = document.createElement('b'); b.textContent = d.t;
    const s = document.createElement('span'); s.textContent = d.m;
    el.welcomeErr.append(b, s);
    return false;
  }
}

mic.onFrame = (live, dt, atime) => {
  if (S.screen === 'test') test.frame(live, dt);
  else if (S.screen === 'practice') practice.frame(live, dt, atime);
  if (S.screen === 'test') {
    el.liveNote.textContent = live.voiced ? M.hzToName(live.hz, S.singer.a4) + ' · ' + live.hz.toFixed(0) + ' Hz' : '—';
    el.liveSteady.textContent = live.voiced ? (live.clarity > 0.9 ? 'Steady' : live.clarity > 0.7 ? 'Wavering' : 'Breathy') : '—';
    el.liveTone.textContent = live.voiced ? Math.round(live.clarity * 100) + '%' : '—';
  }
};

/* ------------------------------------------------------------ wiring -- */
function wire() {
  el.beginBtn.onclick = async () => { if (await ensureMic()) startWarmup(); };
  el.skipToPractice.onclick = () => show('practice');
  el.warmStart.onclick = startWarmupTimer;
  el.warmSkip.onclick = () => { S.warmedUp = false; test.begin(); };
  el.playTarget.onclick = () => test.cur && playReference(mic.ctx, M.midiToHz(test.cur, S.singer.a4));
  el.tooFar.onclick = () => test.giveUp();
  el.skipNote.onclick = () => test.skip();
  el.retest.onclick = () => test.begin();
  el.retestBtn.onclick = async () => { if (await ensureMic()) startWarmup(); };

  el.acceptSa.onclick = async () => {
    const p = S.pending; if (!p || !chosenSa) return;
    await api('/range-test', { method: 'POST', body: {
      low_hz: p.low_hz, high_hz: p.high_hz, low_note: p.low_note, high_note: p.high_note,
      semitones: p.semitones, tier: p.tier, warmed_up: p.warmed_up } });
    await api('/singer/' + S.singer.id, { method: 'PUT', body: {
      sa_hz: chosenSa.hz, sa_note: chosenSa.note, sa_key: chosenSa.key } });
    S.pending = null;
    await refresh();
    show('practice');
  };

  document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => show(b.dataset.screen); });

  el.exSelect.onchange = () => { practice.ex = el.exSelect.value; practice.build(); };
  el.thaatSelect.onchange = async () => {
    practice.thaat = el.thaatSelect.value; practice.build();
    await api('/singer/' + S.singer.id, { method: 'PUT', body: { thaat: practice.thaat } });
  };
  el.droneBtn.onclick = async () => {
    if (!mic.ctx) { if (!(await ensureMic())) return; }
    if (!tanpura) tanpura = new Tanpura(mic.ctx);
    if (tanpura.on) { tanpura.stop(); el.droneBtn.setAttribute('aria-pressed', 'false'); }
    else { tanpura.setSa(S.singer.sa_hz); tanpura.start(); el.droneBtn.setAttribute('aria-pressed', 'true'); }
  };
  el.micBtn.onclick = async () => {
    if (mic.running) {
      await practice.endSession(); mic.stop();
      el.micBtn.textContent = 'Start singing'; el.micBtn.classList.remove('live');
    } else if (await ensureMic()) {
      await practice.startSession();
      el.micBtn.textContent = 'Stop'; el.micBtn.classList.add('live');
    }
  };

  const save = async (patch) => { await api('/singer/' + S.singer.id, { method: 'PUT', body: patch }); await refresh(); renderVoice(); };
  el.setName.onchange = () => save({ name: el.setName.value.trim() || 'Me' });
  el.setSaHz.onchange = () => {
    const v = parseFloat(el.setSaHz.value);
    if (v > 60 && v < 900) {
      const midi = Math.round(M.hzToMidi(v, S.singer.a4));
      save({ sa_hz: v, sa_note: M.midiToName(midi), sa_key: M.harmoniumKey(midi) });
    }
  };
  el.setA4.onchange = () => { const v = parseFloat(el.setA4.value); if (v > 400 && v < 470) save({ a4: v }); };
  el.setTol.oninput = () => { el.setTolHint.textContent = `±${el.setTol.value} cents`; };
  el.setTol.onchange = () => save({ tol_cents: Number(el.setTol.value) });
  document.querySelectorAll('[data-tuning]').forEach((b) => { b.onclick = () => save({ tuning: b.dataset.tuning }); });
  document.querySelectorAll('[data-theme]').forEach((b) => {
    b.onclick = () => { S.theme = b.dataset.theme; applyTheme(); renderVoice(); };
  });

  window.addEventListener('resize', () => {
    if (S.screen === 'result') drawRangeStrip();
    if (S.screen === 'progress') { drawTrend(); drawSwaraChart(); }
  });
  window.addEventListener('pagehide', () => mic.stop());
}

/* --------------------------------------------------------- warm up ---- */
let warmTimer = null;
function startWarmup() { show('warmup'); }
function startWarmupTimer() {
  el.warmStart.disabled = true;
  if (!tanpura) tanpura = new Tanpura(mic.ctx);
  tanpura.setSa(S.singer.sa_hz || 220);
  tanpura.start(0.16);
  let left = 60;
  const C = 2 * Math.PI * 52;
  const tick = () => {
    left--;
    el.warmTime.textContent = '0:' + String(Math.max(0, left)).padStart(2, '0');
    el.warmRing.style.strokeDashoffset = String(C * (left / 60));
    if (left <= 0) {
      clearInterval(warmTimer); tanpura.stop();
      el.warmStart.disabled = false;
      S.warmedUp = true;
      test.begin();
    }
  };
  el.warmTime.textContent = '1:00';
  warmTimer = setInterval(tick, 1000);
}

// Exposed for debugging and for the browser test harness.
window.__sur = { S, test, practice, M, mic, swaraLabel };

/* ------------------------------------------------------------- init --- */
(async function init() {
  applyTheme();
  wire();
  try { await refresh(); } catch (e) {
    el.welcomeErr.hidden = false;
    el.welcomeErr.textContent = 'Could not reach the Sur server: ' + e.message;
    return;
  }
  if (S.singer.sa_hz) { el.skipToPractice.hidden = false; show('practice'); }
  else show('welcome');
})();
