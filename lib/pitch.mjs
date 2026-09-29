// ---------------------------------------------------------------------------
// Sur — pitch detection core (McLeod Pitch Method / NSDF over an FFT autocorrelation)
//
// A plain ES module with no browser or Node specifics, so the app, the server
// and the test suite all run the same code.
//
// Ported from the bansuri app's detector, which was swept and measured, then
// retuned for the singing voice. The voice differences that matter:
//   - the range runs far lower (a bass fundamental sits near 80 Hz), which
//     needs a longer analysis window than a flute ever did;
//   - the fundamental is often weak, especially through a phone microphone,
//     which is the classic cause of octave errors on low male voices;
//   - a sung vowel is much richer in harmonics than a flute tone.
// ---------------------------------------------------------------------------

/** Measured on the flute app: zero octave errors across k = 0.80–0.98, breaks
 *  at 0.99. 0.93 sits mid-plateau. */
export const MPM_K = 0.93;

// ---- radix-2 iterative FFT -------------------------------------------------
function makeFFT(n) {
  const levels = Math.log2(n) | 0;
  if (1 << levels !== n) throw new Error('FFT size must be a power of two');
  const cos = new Float32Array(n / 2);
  const sin = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = Math.sin((2 * Math.PI * i) / n);
  }
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let x = i, r = 0;
    for (let j = 0; j < levels; j++) { r = (r << 1) | (x & 1); x >>= 1; }
    rev[i] = r;
  }
  return function transform(re, im) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cos[k] + im[l] * sin[k];
          const tim = -re[l] * sin[k] + im[l] * cos[k];
          re[l] = re[j] - tre; im[l] = im[j] - tim;
          re[j] += tre;        im[j] += tim;
        }
      }
    }
  };
}

/**
 * @param {number} windowSize  samples analysed per call. 4096 @48k (85 ms) for
 *   a voice that reaches below ~150 Hz, 2048 (43 ms) for higher voices.
 */
export function createDetector(windowSize) {
  // Pad to at least windowSize + maxLag so the circular correlation the FFT
  // gives us does not wrap and contaminate the long-lag key maxima that are
  // exactly what protect against octave-up errors.
  const fftSize = 1 << Math.ceil(Math.log2(windowSize * 2));
  const transform = makeFFT(fftSize);
  const re = new Float32Array(fftSize);
  const im = new Float32Array(fftSize);
  const nsdf = new Float32Array(windowSize);
  const work = new Float32Array(windowSize);
  const maxPos = new Int32Array(96);

  /**
   * @param {Float32Array} buf     source samples
   * @param {number} offset        index in buf to start at
   * @param {number} sampleRate
   * @param {number} minFreq       Hz
   * @param {number} maxFreq       Hz
   * @param {number} clarityFloor  reject below this NSDF peak height
   * @returns {{frequency:number, clarity:number, rms:number}} frequency -1 if unvoiced
   */
  function detect(buf, offset, sampleRate, minFreq, maxFreq, clarityFloor) {
    let mean = 0;
    for (let i = 0; i < windowSize; i++) mean += buf[offset + i];
    mean /= windowSize;

    let energy = 0;
    for (let i = 0; i < windowSize; i++) {
      const v = buf[offset + i] - mean;     // a mic DC offset badly biases the NSDF
      work[i] = v;
      energy += v * v;
    }
    const rms = Math.sqrt(energy / windowSize);
    if (rms < 1e-6) return { frequency: -1, clarity: 0, rms };

    // autocorrelation by Wiener-Khinchin: IFFT(|FFT(x)|^2)
    re.fill(0); im.fill(0);
    for (let i = 0; i < windowSize; i++) re[i] = work[i];
    transform(re, im);
    for (let i = 0; i < fftSize; i++) {
      const p = re[i] * re[i] + im[i] * im[i];
      re[i] = p; im[i] = 0;
    }
    transform(re, im);                      // real and even, so inverse by symmetry
    const inv = 1 / fftSize;
    for (let i = 0; i < windowSize; i++) re[i] *= inv;

    const tauMax = Math.min(windowSize - 2, Math.floor(sampleRate / minFreq));
    const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
    if (tauMax <= tauMin + 2) return { frequency: -1, clarity: 0, rms };

    // NSDF via the incremental m'(tau) recurrence:
    //   m'(0) = 2*sum(x^2),  m'(t) = m'(t-1) - x[t-1]^2 - x[W-t]^2
    let m = 2 * energy;
    nsdf[0] = 1;
    for (let tau = 1; tau <= tauMax; tau++) {
      m -= work[tau - 1] * work[tau - 1] + work[windowSize - tau] * work[windowSize - tau];
      nsdf[tau] = m > 1e-12 ? (2 * re[tau]) / m : 0;
    }

    // Key maxima: the highest point between a positive-going and the next
    // negative-going zero crossing.
    // The lobe skip MUST start at tau = 0, not at tauMin. For a high note the
    // whole first lobe can sit below tauMin; starting there lands mid-lobe,
    // skips the true peak and locks onto twice the period — a confident
    // reading exactly one octave low.
    let nMax = 0, tau = 1;
    while (tau < tauMax && nsdf[tau] > 0) tau++;
    while (tau < tauMax && nsdf[tau] <= 0) tau++;
    while (tau < tauMax && nMax < maxPos.length) {
      let best = tau, bestV = nsdf[tau];
      while (tau < tauMax && nsdf[tau] > 0) {
        if (nsdf[tau] > bestV) { bestV = nsdf[tau]; best = tau; }
        tau++;
      }
      if (bestV > 0 && best >= tauMin && best < tauMax - 1) maxPos[nMax++] = best;
      while (tau < tauMax && nsdf[tau] <= 0) tau++;
    }
    if (nMax === 0) return { frequency: -1, clarity: 0, rms };

    let highest = 0;
    for (let i = 0; i < nMax; i++) if (nsdf[maxPos[i]] > highest) highest = nsdf[maxPos[i]];
    if (highest < clarityFloor) return { frequency: -1, clarity: highest, rms };

    const thresh = MPM_K * highest;
    let chosen = maxPos[0];
    for (let i = 0; i < nMax; i++) if (nsdf[maxPos[i]] >= thresh) { chosen = maxPos[i]; break; }

    const y0 = nsdf[chosen - 1], y1 = nsdf[chosen], y2 = nsdf[chosen + 1];
    const den = 2 * (2 * y1 - y0 - y2);
    let shift = den !== 0 ? (y2 - y0) / den : 0;
    if (shift > 1) shift = 1; else if (shift < -1) shift = -1;

    const clarity = Math.max(0, Math.min(1, y1 + 0.25 * (y2 - y0) * shift));
    const frequency = sampleRate / (chosen + shift);
    if (frequency < minFreq || frequency > maxFreq) return { frequency: -1, clarity, rms };
    return { frequency, clarity, rms };
  }

  return { windowSize, fftSize, detect };
}
