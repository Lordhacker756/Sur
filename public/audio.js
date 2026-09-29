// ---------------------------------------------------------------------------
// Sur — microphone, pitch tracking and the tanpura drone.
// ---------------------------------------------------------------------------

import { createDetector } from '/lib/pitch.mjs';

export const FFT_SIZE = 4096;            // room for the detector's 2048 window
// 2048 (43 ms at 48k) measures good down to 65 Hz, but at 44.1 kHz that is
// only ~2.9 periods, right at MPM's cliff. A singer whose range reaches below
// 150 Hz gets the longer window instead.
export const DET_WINDOW = 2048;
export const DET_WINDOW_LOW = 4096;
export const GATE_RMS = 0.004;
// Measured on real voices: a sung vowel sits well above 0.75 even when very
// breathy, vocal fry lands near 0.51 (which the app wants to CATCH, not
// reject), and room tone sits under 0.3. 0.45/0.35 rejects nothing real while
// keeping the room out. The flute app's 0.32 was tuned for a quieter signal.
export const CLARITY_ON = 0.45;
export const CLARITY_OFF = 0.35;         // hysteresis, so a breathy tail holds
export const F_MIN = 65;                 // below the lowest bass
export const F_MAX = 1300;               // above the highest soprano

const MEDIAN_N = 5;

export class Mic {
  /** @param {number} [lowestHz] the lowest note this singer will be asked for */
  constructor(lowestHz) {
    this.window = (lowestHz && lowestHz < 150) ? DET_WINDOW_LOW : DET_WINDOW;
    this.ctx = null; this.stream = null; this.src = null;
    this.analyser = null; this.buf = null; this.det = null;
    this.running = false; this.raf = 0;
    this.med = [];
    this.onFrame = null;                 // (sample) => void
    this.constraintWarning = null;
    // Drone-bleed guard. A tanpura through laptop speakers is picked up by the
    // microphone, and the detector will happily lock onto it and report a
    // flawless Sa forever. A bansuri is loud enough to mask its own drone; a
    // voice at riyaz volume is not.
    this.dronePitches = null;
    this.bleeding = false;
    this.live = { hz: -1, clarity: 0, rms: 0, db: -140, voiced: false };
  }

  static describeError(e) {
    const n = (e && e.name) || 'Error';
    if (n === 'NotAllowedError' || n === 'SecurityError') {
      return { t: 'Microphone blocked',
        m: 'Your browser or your operating system is refusing access. Click the microphone icon in the address bar and allow it, then check your system privacy settings.' };
    }
    if (n === 'NotFoundError' || n === 'OverconstrainedError') {
      return { t: 'No microphone found', m: 'No input device is available. Plug one in or enable your built-in mic, then try again.' };
    }
    if (n === 'NotReadableError') {
      return { t: 'The microphone is busy', m: 'Another app is holding it — a call, a recorder, or another tab. Close that and try again.' };
    }
    if (!window.isSecureContext || !navigator.mediaDevices) {
      return { t: 'This page needs localhost or https',
        m: 'Browsers only allow microphone access over a secure origin. Open Sur through http://localhost rather than from the file itself.' };
    }
    return { t: 'Could not start listening', m: (e && e.message) || String(e) };
  }

  /** Must be called from inside a user gesture. */
  async start() {
    if (this.running) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw Object.assign(new Error('insecure context'), { name: 'SecurityError' });
    }
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
    }
    // resume synchronously, before any await, or Safari has already dropped
    // the transient activation. 'interrupted' is a real iOS state.
    if (this.ctx.state !== 'running') { try { this.ctx.resume(); } catch {} }

    const stream = await navigator.mediaDevices.getUserMedia({
      // Never {exact:false}: Safari does not implement two of these and would
      // throw OverconstrainedError.
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    this.stream = stream;
    if (this.ctx.state !== 'running') { try { this.ctx.resume(); } catch {} }

    const track = stream.getAudioTracks()[0];
    let st = track.getSettings ? track.getSettings() : {};
    if ((st.autoGainControl || st.noiseSuppression || st.echoCancellation) && track.applyConstraints) {
      try {
        await track.applyConstraints({ echoCancellation: false, noiseSuppression: false, autoGainControl: false });
        st = track.getSettings();
      } catch {}
    }
    const on = [];
    if (st.autoGainControl) on.push('automatic gain control');
    if (st.noiseSuppression) on.push('noise suppression');
    if (st.echoCancellation) on.push('echo cancellation');
    this.constraintWarning = on.length
      ? `Your browser kept ${on.join(' and ')} switched on despite being asked not to. Pitch stays accurate; loudness readings will be flattened. Firefox and Safari usually honour the request.`
      : null;

    this.src = this.ctx.createMediaStreamSource(stream);   // keep the reference:
                                                           // Firefox has collected it early
    // A gentle high-pass only. The flute app could cut at 130 Hz; for a voice
    // that would sit on top of a bass singer's fundamental and hand the
    // detector the second harmonic — a confident octave error.
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 45; hp.Q.value = 0.707;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 6000; lp.Q.value = 0.707;

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.src.connect(hp); hp.connect(lp); lp.connect(this.analyser);

    // Some engines will not pull a graph that ends in an analyser.
    const sink = this.ctx.createGain(); sink.gain.value = 0;
    this.analyser.connect(sink); sink.connect(this.ctx.destination);

    this.buf = new Float32Array(this.analyser.fftSize);   // fftSize, not frequencyBinCount
    this.det = createDetector(this.window);
    this.running = true;
    this.med.length = 0;
    this._last = 0;
    this.raf = requestAnimationFrame((t) => this._loop(t));
  }

  stop() {
    this.running = false;
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null; }
    if (this.src) { try { this.src.disconnect(); } catch {} this.src = null; }
    this.live = { hz: -1, clarity: 0, rms: 0, db: -140, voiced: false };
  }

  _median(x) {
    this.med.push(x);
    if (this.med.length > MEDIAN_N) this.med.shift();
    const a = this.med.slice().sort((p, q) => p - q);
    return a[a.length >> 1];
  }

  _loop(now) {
    if (!this.running) { this.raf = 0; return; }
    this.raf = requestAnimationFrame((t) => this._loop(t));
    const dt = this._last ? Math.max(0.004, Math.min(0.05, (now - this._last) / 1000)) : 1 / 60;
    this._last = now;

    const sr = this.ctx.sampleRate;      // read fresh: iOS can change it on capture
    this.analyser.getFloatTimeDomainData(this.buf);

    const r = this.det.detect(this.buf, FFT_SIZE - this.window, sr, F_MIN, F_MAX, CLARITY_OFF);
    const voiced = r.frequency > 0 && r.rms > GATE_RMS &&
                   r.clarity > (this.live.voiced ? CLARITY_OFF : CLARITY_ON);

    const db = Math.max(-140, 20 * Math.log10(Math.max(r.rms, 1e-7)));

    // Sitting on a drone pitch, quiet, and implausibly pure: that is the
    // speakers, not the singer.
    let bleed = false;
    if (voiced && this.dronePitches && db < -40 && r.clarity > 0.95) {
      for (const d of this.dronePitches) {
        if (Math.abs(1200 * Math.log2(r.frequency / d)) < 15) { bleed = true; break; }
      }
    }
    this.bleeding = bleed;
    const reallyVoiced = voiced && !bleed;

    let hz = -1;
    if (reallyVoiced) hz = this._median(r.frequency);
    else this.med.length = 0;

    this.live = { hz, clarity: r.clarity, rms: r.rms, db, voiced: reallyVoiced, bleeding: bleed };
    if (this.onFrame) this.onFrame(this.live, dt, this.ctx.currentTime);
  }
}

/* ------------------------------------------------------------ drone --- */
// A tanpura is four strings plucked in a slow cycle, each ringing into the
// next. Pa · Sa · Sa · lower Sa, tuned in JUST intervals — a drone that beats
// against itself is worse than no drone.
export class Tanpura {
  constructor(ctx) { this.ctx = ctx; this.gain = null; this.timer = null; this.on = false; this.step = 0; this.saHz = 220; }

  setSa(hz) { this.saHz = hz; }

  /** Every pitch this drone sounds, with octaves, for the bleed guard. */
  pitches() {
    const out = [];
    for (const r of [0.75, 1, 0.5]) for (const m of [1, 2, 4]) out.push(this.saHz * r * m);
    return out;
  }

  start(volume = 0.22) {
    if (!this.ctx || this.on) return;
    if (this.ctx.state !== 'running') { try { this.ctx.resume(); } catch {} }
    if (!this.gain) { this.gain = this.ctx.createGain(); this.gain.connect(this.ctx.destination); }
    this.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.3);
    this.on = true; this.step = 0;
    this._pluck();
  }

  stop() {
    this.on = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.gain && this.ctx) this.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.2);
  }

  setVolume(v) { if (this.gain && this.ctx && this.on) this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1); }

  _pluck() {
    if (!this.on || !this.ctx) return;
    // Pa - Sa - Sa - mandra Sa. The first string is mandra Pa, a fourth BELOW
    // the singer's Sa (0.75), and the middle two must sound the singer's own
    // madhya Sa: that is the pitch they are matching, so it cannot be
    // transposed down the way a flute drone was.
    const ratios = [0.75, 1, 1, 0.5];
    const f = this.saHz * ratios[this.step % 4];
    this.step++;

    const t0 = this.ctx.currentTime + 0.02;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.6);
    g.connect(this.gain);

    // One oscillator per copy from a cached PeriodicWave, not one per partial:
    // a pluck every 1.15 s with a 3.8 s tail keeps three or four plucks alive,
    // and nine oscillators each would be thirty-odd voices competing with the
    // pitch detector for the main thread.
    //
    // The partials stay HARMONIC. Detuning partial n by n*1.8 cents, which a
    // flute drone can get away with, leaves the 8th partial 14 cents sharp;
    // against a voice that makes the tuning reference itself ambiguous.
    if (!this._wave) {
      const amps = [0, 1, .62, .42, .31, .22, .15, .10, .06, .04];
      const re = new Float32Array(amps.length), im = new Float32Array(amps.length);
      for (let i = 0; i < amps.length; i++) im[i] = amps[i] * 0.15;
      this._wave = this.ctx.createPeriodicWave(re, im);
    }
    for (const cents of [-1.2, 1.2]) {                 // the shimmer, two copies
      const o = this.ctx.createOscillator();
      o.setPeriodicWave(this._wave);
      o.frequency.value = f;
      o.detune.value = cents;
      const og = this.ctx.createGain(); og.gain.value = 0.5;
      o.connect(og); og.connect(g);
      o.start(t0); o.stop(t0 + 3.8);
    }
    this.timer = setTimeout(() => this._pluck(), 1150);
  }
}

/** A short reference tone for the range test — a plain, easy-to-match vowel-ish sound. */
export function playReference(ctx, hz, seconds = 1.4) {
  if (!ctx) return;
  if (ctx.state !== 'running') { try { ctx.resume(); } catch {} }
  const t0 = ctx.currentTime + 0.02;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.05);
  g.gain.setValueAtTime(0.18, t0 + seconds - 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + seconds);
  g.connect(ctx.destination);
  const amps = [1, .5, .28, .14, .07];
  for (let i = 0; i < amps.length; i++) {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = hz * (i + 1);
    const og = ctx.createGain(); og.gain.value = amps[i] * 0.5;
    o.connect(og); og.connect(g);
    o.start(t0); o.stop(t0 + seconds + 0.05);
  }
}
