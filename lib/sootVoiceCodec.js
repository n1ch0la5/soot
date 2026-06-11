/* ────────────────────────────────────────────────────────────
   Soot voice codec — the picture itself carries the voice.

   Encode: mono 8 kHz audio → short-time Fourier transform →
   dB-quantized magnitudes painted as visible spectrogram strips
   on the card PNG, plus a bit-block header with the frame count.

   Decode: read the strip pixels back into magnitudes and
   resynthesize audio with Griffin-Lim phase reconstruction.
   Lossy by design — the voice comes back smoky and robotic,
   but understandable. No audio file ever travels with the image.
   ──────────────────────────────────────────────────────────── */

export const CODEC = {
  SR: 8000, // codec sample rate (telephone band)
  FFT: 256, // analysis window (32 ms)
  HOP: 64, // hop size (8 ms per pixel column); 75% overlap keeps Griffin-Lim smooth
  BINS: 128, // stored frequency bins (0–4 kHz)
  COLS: 936, // pixel columns per strip
  MAX_STRIPS: 2, // 2 strips ≈ 15 s capacity
  DB_RANGE: 60, // dynamic range mapped onto pixel brightness
  MAGIC: 0xa55e,
  VERSION: 5,
  HEADER_BITS: 36, // 16 magic + 4 version + 12 frame count + 4 column scale
  MAX_SCALE: 12, // short messages stretch to fill the strip (wider columns)
};

const PRE_EMPH = 0.95; // encode boosts highs, decode mirrors it back down
const GATE_V = 0.08; // spectral floor: bins below ~-55 dB are written as silence

/* Fixed card geometry, in card pixels (1080×1350). Decode reads
   proportionally, so a uniformly scaled copy still decodes. */
export const LAYOUT = {
  W: 1080,
  H: 1350,
  X: 72, // strips' left edge; width = COLS
  HEADER_Y: 760,
  HEADER_H: 12,
  STRIP_Y: [792, 934],
  STRIP_H: 128, // = BINS, one pixel row per bin
};

const IVORY = [244, 236, 220];
const IVORY_LUM = 0.2126 * IVORY[0] + 0.7152 * IVORY[1] + 0.0722 * IVORY[2];

/* ---------- DSP primitives ---------- */

function hann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n));
  return w;
}

/* In-place iterative radix-2 FFT. */
function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const vr = re[b] * cr - im[b] * ci;
        const vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi;
        re[a] += vr; im[a] += vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

/* Fast Griffin-Lim (momentum-accelerated): recover a time signal from
   magnitude-only spectra by iteratively re-estimating phase, extrapolating
   each projection toward the previous step. Converges to a noticeably less
   metallic voice than plain Griffin-Lim at the same iteration count.
   mags: per-frame Float32Array(BINS+1). */
function griffinLim(mags, iterations = 60, momentum = 0.9) {
  const { FFT: N, HOP } = CODEC;
  const K = (N >> 1) + 1;
  const F = mags.length;
  const outLen = (F - 1) * HOP + N;
  const win = hann(N);
  const re = new Float32Array(N);
  const im = new Float32Array(N);

  // c = magnitude-projected spectra, h = momentum-extrapolated spectra.
  // Phases start coherent — each bin advancing per frame exactly as a steady
  // tone at that frequency would — rather than random. Random init leaves a
  // frame-rate (62.5 Hz) buzz that GL can't fully repair in finite iterations.
  const cRe = new Float32Array(F * K), cIm = new Float32Array(F * K);
  const hRe = new Float32Array(F * K), hIm = new Float32Array(F * K);
  const dphi = (2 * Math.PI * HOP) / N;
  for (let k = 0; k < K; k++) {
    let ph = 0;
    for (let f = 0; f < F; f++) {
      const m = mags[f][k];
      const i0 = f * K + k;
      cRe[i0] = m * Math.cos(ph);
      cIm[i0] = m * Math.sin(ph);
      hRe[i0] = cRe[i0];
      hIm[i0] = cIm[i0];
      ph += dphi * k;
    }
  }

  const sig = new Float32Array(outLen);
  const wsum = new Float32Array(outLen);

  const synth = (srcRe, srcIm) => {
    sig.fill(0);
    wsum.fill(0);
    for (let f = 0; f < F; f++) {
      const base = f * K;
      for (let k = 0; k < K; k++) {
        re[k] = srcRe[base + k];
        im[k] = srcIm[base + k];
      }
      for (let k = K; k < N; k++) {
        re[k] = re[N - k];
        im[k] = -im[N - k];
      }
      fft(re, im, true);
      const off = f * HOP;
      for (let n = 0; n < N; n++) {
        sig[off + n] += re[n] * win[n];
        wsum[off + n] += win[n] * win[n];
      }
    }
    for (let i = 0; i < outLen; i++) sig[i] /= Math.max(wsum[i], 0.1);
  };

  for (let it = 0; it < iterations; it++) {
    synth(hRe, hIm);
    for (let f = 0; f < F; f++) {
      const off = f * HOP;
      for (let n = 0; n < N; n++) {
        re[n] = sig[off + n] * win[n];
        im[n] = 0;
      }
      fft(re, im, false);
      const m = mags[f];
      const base = f * K;
      for (let k = 0; k < K; k++) {
        const len = Math.hypot(re[k], im[k]) || 1e-12;
        const nr = (re[k] / len) * m[k];
        const ni = (im[k] / len) * m[k];
        const i0 = base + k;
        hRe[i0] = nr + momentum * (nr - cRe[i0]);
        hIm[i0] = ni + momentum * (ni - cIm[i0]);
        cRe[i0] = nr;
        cIm[i0] = ni;
      }
    }
  }
  synth(cRe, cIm);

  let peak = 1e-9;
  for (let i = 0; i < outLen; i++) peak = Math.max(peak, Math.abs(sig[i]));
  const g = 0.85 / peak;
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = sig[i] * g;
  return out;
}

/* ---------- audio utilities ---------- */

export function resampleLinear(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const n = Math.max(1, Math.round((input.length * toRate) / fromRate));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const pos = (i * fromRate) / toRate;
    const a = Math.min(input.length - 1, Math.floor(pos));
    const b = Math.min(input.length - 1, a + 1);
    const t = pos - a;
    out[i] = input[a] * (1 - t) + input[b] * t;
  }
  return out;
}

/* Decode a recorded blob to mono samples at the codec rate. */
export async function blobToSamples(blob, targetRate = CODEC.SR) {
  const arr = await blob.arrayBuffer();
  const ACtx = window.AudioContext || window.webkitAudioContext;
  const actx = new ACtx();
  try {
    const ab = await actx.decodeAudioData(arr);
    const n = ab.length;
    const mono = new Float32Array(n);
    for (let c = 0; c < ab.numberOfChannels; c++) {
      const ch = ab.getChannelData(c);
      for (let i = 0; i < n; i++) mono[i] += ch[i] / ab.numberOfChannels;
    }
    return resampleLinear(mono, ab.sampleRate, targetRate);
  } finally {
    actx.close();
  }
}

/* Deterministic voice-like murmur for the demo message: seeded noise
   through a swept bandpass, shaped by the amplitude envelope. */
export function makeDemoVoice(amps, durSec, sr = CODEC.SR) {
  let seed = 13;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const n = Math.max(CODEC.FFT, Math.floor(durSec * sr));
  const out = new Float32Array(n);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < n; i++) {
    const pos = (i / n) * (amps.length - 1);
    const a0 = Math.floor(pos);
    const ft = pos - a0;
    const a = amps[a0] * (1 - ft) + amps[Math.min(amps.length - 1, a0 + 1)] * ft;
    const w = (2 * Math.PI * (280 + a * 360)) / sr;
    const alpha = Math.sin(w) / (2 * 1.4);
    const x = rnd() * 2 - 1;
    const y = (alpha * x - alpha * x2 + 2 * Math.cos(w) * y1 - (1 - alpha) * y2) / (1 + alpha);
    x2 = x1; x1 = x;
    y2 = y1; y1 = y;
    out[i] = y * a;
  }
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = 0.8 / peak;
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

/* ---------- encode: samples → quantized spectrogram bytes ---------- */

/* Input conditioning: high-pass (~80 Hz) drops DC and rumble, pre-emphasis
   lifts consonants above the quantization floor, peak normalization makes
   quiet recordings use the full dynamic range. */
function conditionInput(samples) {
  const n = samples.length;
  const out = new Float32Array(n);
  const a = Math.exp((-2 * Math.PI * 80) / CODEC.SR);
  let hp = 0, prevX = 0, prevHp = 0;
  for (let i = 0; i < n; i++) {
    hp = a * (hp + samples[i] - prevX);
    prevX = samples[i];
    out[i] = hp - PRE_EMPH * prevHp;
    prevHp = hp;
  }
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] /= peak;
  return out;
}

export function encodeVoice(rawSamples) {
  const { FFT: N, HOP, BINS, COLS, MAX_STRIPS, DB_RANGE } = CODEC;
  const samples = conditionInput(rawSamples);
  const maxFrames = COLS * MAX_STRIPS;
  const F = Math.max(1, Math.min(maxFrames, Math.floor((samples.length - N) / HOP) + 1));
  const win = hann(N);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const mags = new Float32Array(F * BINS);
  let maxMag = 1e-9;
  for (let f = 0; f < F; f++) {
    const off = f * HOP;
    for (let n = 0; n < N; n++) {
      const idx = off + n;
      re[n] = (idx < samples.length ? samples[idx] : 0) * win[n];
      im[n] = 0;
    }
    fft(re, im, false);
    for (let k = 0; k < BINS; k++) {
      const m = Math.hypot(re[k], im[k]);
      mags[f * BINS + k] = m;
      if (m > maxMag) maxMag = m;
    }
  }
  const bytes = new Uint8Array(F * BINS);
  for (let i = 0; i < bytes.length; i++) {
    // bins below ~80 Hz carry only rumble; bins under the gate are hiss
    if (i % BINS < 2) continue;
    const db = 20 * Math.log10(Math.max(mags[i] / maxMag, 1e-9));
    const v = Math.max(0, Math.min(1, 1 + db / DB_RANGE));
    bytes[i] = v < GATE_V ? 0 : Math.round(v * 255);
  }
  // fill single-frame gate flickers: one silent frame between two voiced
  // ones decodes as 62.5 Hz amplitude flutter (warble), not as silence
  for (let k = 2; k < BINS; k++) {
    let prevOrig = bytes[k];
    for (let f = 1; f < F - 1; f++) {
      const i = f * BINS + k;
      const cur = bytes[i];
      if (cur === 0 && prevOrig > 0 && bytes[i + BINS] > 0) {
        bytes[i] = Math.min(prevOrig, bytes[i + BINS]);
      }
      prevOrig = cur;
    }
  }
  return { bytes, frames: F };
}

function bytesToMags(bytes, frames) {
  const { BINS, DB_RANGE } = CODEC;
  const mags = [];
  for (let f = 0; f < frames; f++) {
    const m = new Float32Array(BINS + 1); // last entry = Nyquist, always 0
    for (let k = 0; k < BINS; k++) {
      const v = bytes[f * BINS + k] / 255;
      m[k] = v <= 0 ? 0 : Math.pow(10, ((v - 1) * DB_RANGE) / 20);
    }
    mags.push(m);
  }
  return mags;
}

/* ---------- pixels: write & read the sound block ---------- */

function packHeaderBits(frames, scale) {
  const bits = new Array(CODEC.HEADER_BITS).fill(0);
  let i = 0;
  const put = (value, n) => {
    for (let b = n - 1; b >= 0; b--) bits[i++] = (value >> b) & 1;
  };
  put(CODEC.MAGIC, 16);
  put(CODEC.VERSION, 4);
  put(frames, 12);
  put(scale, 4);
  return bits;
}

/* Column scale: use the fewest strips the message can fit in (one row
   whenever possible), then the widest columns that fill that row. */
function columnScale(frames) {
  const { COLS, MAX_STRIPS, MAX_SCALE } = CODEC;
  const strips = Math.min(MAX_STRIPS, Math.ceil(frames / COLS));
  let k = Math.max(1, Math.min(MAX_SCALE, Math.floor((COLS * strips) / frames)));
  while (k > 1 && Math.ceil(frames / Math.floor(COLS / k)) > strips) k--;
  return k;
}

/* How many strip rows a message occupies — for laying out the card art. */
export function usedStrips(frames) {
  return stripLayout(frames, columnScale(frames)).strips;
}

/* Strip layout shared by writer and reader: frames split evenly across the
   strips they need, each row centered — two equal bars, not a bar and a stub.
   Fully derived from (frames, scale), so nothing extra travels in the header. */
function stripLayout(frames, scale) {
  const capacity = Math.floor(CODEC.COLS / scale);
  const strips = Math.ceil(frames / capacity);
  const cpf = Math.ceil(frames / strips); // columns per strip
  const colsIn = (s) => Math.min(cpf, frames - s * cpf);
  const offset = (s) => Math.floor((CODEC.COLS - colsIn(s) * scale) / 2);
  return { strips, cpf, colsIn, offset };
}

/* Paint header + strips into a full-size card pixel buffer (RGBA).
   Must be called on a native-resolution card (LAYOUT.W wide). */
export function writeSoundBlock(pixels, width, height, bytes, frames) {
  if (width !== LAYOUT.W || height !== LAYOUT.H) {
    throw new Error("sound block must be written on a native-size card");
  }
  const { X, HEADER_Y, HEADER_H, STRIP_Y, STRIP_H } = LAYOUT;
  const { BINS, COLS, HEADER_BITS } = CODEC;
  const set = (x, y, r, g, b) => {
    const p = (y * width + x) * 4;
    pixels[p] = r;
    pixels[p + 1] = g;
    pixels[p + 2] = b;
    pixels[p + 3] = 255;
  };

  // header as a quiet dotted line on its own dark backing (the card theme
  // may be light): 1-bits are ivory dots, 0-bits read as the dark backing
  for (let y = HEADER_Y - 2; y < HEADER_Y + HEADER_H + 2; y++) {
    for (let x = X; x < X + COLS; x++) set(x, y, 0, 0, 0);
  }
  const scale = columnScale(frames);
  const bits = packHeaderBits(frames, scale);
  const bw = COLS / HEADER_BITS;
  const cy = HEADER_Y + HEADER_H / 2;
  const r = 5;
  for (let i = 0; i < HEADER_BITS; i++) {
    if (!bits[i]) continue;
    const cx = X + (i + 0.5) * bw;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        set(Math.floor(cx + dx), Math.floor(cy + dy), IVORY[0], IVORY[1], IVORY[2]);
      }
    }
  }

  // each frame is a `scale`-wide column; rows are evenly filled and centered,
  // with the black backing hugging the content
  const layout = stripLayout(frames, scale);
  for (let s = 0; s < layout.strips; s++) {
    const cols = layout.colsIn(s);
    const x0 = X + layout.offset(s);
    const backL = Math.max(X, x0 - 8);
    const backR = Math.min(X + COLS, x0 + cols * scale + 8);
    for (let y = STRIP_Y[s]; y < STRIP_Y[s] + STRIP_H; y++) {
      for (let x = backL; x < backR; x++) set(x, y, 0, 0, 0);
    }
    for (let col = 0; col < cols; col++) {
      const f = s * layout.cpf + col;
      for (let bin = 0; bin < BINS; bin++) {
        const v = bytes[f * BINS + bin] / 255;
        if (v <= 0) continue;
        const y = STRIP_Y[s] + (BINS - 1 - bin); // low frequencies at the bottom
        for (let dx = 0; dx < scale; dx++) {
          set(
            x0 + col * scale + dx,
            y,
            Math.round(IVORY[0] * v),
            Math.round(IVORY[1] * v),
            Math.round(IVORY[2] * v)
          );
        }
      }
    }
  }
}

/* Read header + strips back from any uniformly-scaled copy of the card. */
export function readSoundBlock(imageData) {
  const { data, width: w, height: h } = imageData;
  const sx = w / LAYOUT.W;
  const sy = h / LAYOUT.H;
  const lum = (cx, cy) => {
    // cx/cy are pixel centers; floor maps a center to its containing pixel
    const x = Math.max(0, Math.min(w - 1, Math.floor(cx)));
    const y = Math.max(0, Math.min(h - 1, Math.floor(cy)));
    const p = (y * w + x) * 4;
    return 0.2126 * data[p] + 0.7152 * data[p + 1] + 0.0722 * data[p + 2];
  };

  const { X, HEADER_Y, HEADER_H, STRIP_Y } = LAYOUT;
  const { BINS, COLS, HEADER_BITS, MAGIC, MAX_STRIPS } = CODEC;
  const bw = COLS / HEADER_BITS;
  const bits = [];
  for (let i = 0; i < HEADER_BITS; i++) {
    bits.push(lum((X + (i + 0.5) * bw) * sx, (HEADER_Y + HEADER_H / 2) * sy) > 120 ? 1 : 0);
  }
  const val = (a, b) => bits.slice(a, b).reduce((acc, bit) => (acc << 1) | bit, 0);
  if (val(0, 16) !== MAGIC) throw new Error("not a soot sound-image");
  // hop/emphasis/layout semantics changed across versions; a mismatched
  // decode would play garbled rather than fail, so reject honestly
  if (val(16, 20) !== CODEC.VERSION) throw new Error("made with a different version of soot");
  const frames = val(20, 32);
  const scale = val(32, 36);
  if (!frames || frames > COLS * MAX_STRIPS || !scale || scale > CODEC.MAX_SCALE) {
    throw new Error("corrupted sound-image header");
  }

  const layout = stripLayout(frames, scale);
  const bytes = new Uint8Array(frames * BINS);
  for (let f = 0; f < frames; f++) {
    const s = Math.floor(f / layout.cpf);
    const col = f % layout.cpf;
    const cx = (X + layout.offset(s) + (col + 0.5) * scale) * sx;
    for (let bin = 0; bin < BINS; bin++) {
      const cy = (STRIP_Y[s] + (BINS - 1 - bin) + 0.5) * sy;
      const v = Math.max(0, Math.min(1, lum(cx, cy) / IVORY_LUM));
      bytes[f * BINS + bin] = Math.round(v * 255);
    }
  }
  return { bytes, frames };
}

/* ---------- post-processing: speck and hiss cleanup ---------- */

/* A lone bin with silence on both temporal neighbors is a stray pixel
   (grain, scaling), not speech — drop it before resynthesis turns it
   into a blip of static. */
function despeckle(mags) {
  const F = mags.length;
  if (F < 3) return mags;
  const K = mags[0].length;
  for (let k = 0; k < K; k++) {
    let prevOrig = mags[0][k];
    for (let f = 1; f < F - 1; f++) {
      const cur = mags[f][k];
      if (cur > 0 && prevOrig === 0 && mags[f + 1][k] === 0) mags[f][k] = 0;
      prevOrig = cur;
    }
  }
  return mags;
}

/* Wiener-style spectral subtraction on the decoded signal: estimate each
   bin's noise floor from its quietest fifth over time, then softly duck
   energy near that floor. Phases are kept, so this is a single cheap pass. */
function spectralClean(input) {
  const { FFT: N, HOP } = CODEC;
  const K = (N >> 1) + 1;
  const F = Math.floor((input.length - N) / HOP) + 1;
  if (F < 4) return input;
  const GAIN_FLOOR = 0.1; // never duck more than -20 dB, avoids musical noise
  const win = hann(N);
  const re = new Float32Array(N);
  const im = new Float32Array(N);

  const specRe = new Float32Array(F * K);
  const specIm = new Float32Array(F * K);
  const specMag = new Float32Array(F * K);
  for (let f = 0; f < F; f++) {
    const off = f * HOP;
    for (let n = 0; n < N; n++) {
      re[n] = input[off + n] * win[n];
      im[n] = 0;
    }
    fft(re, im, false);
    const base = f * K;
    for (let k = 0; k < K; k++) {
      specRe[base + k] = re[k];
      specIm[base + k] = im[k];
      specMag[base + k] = Math.hypot(re[k], im[k]);
    }
  }

  const noise = new Float32Array(K);
  const col = new Float32Array(F);
  for (let k = 0; k < K; k++) {
    for (let f = 0; f < F; f++) col[f] = specMag[f * K + k];
    col.sort();
    noise[k] = col[Math.floor(F * 0.2)] * 1.4; // mild oversubtraction
  }

  const gains = new Float32Array(F * K);
  for (let i = 0; i < gains.length; i++) {
    const m = specMag[i];
    const nz = noise[i % K];
    gains[i] = Math.max(GAIN_FLOOR, 1 - (nz * nz) / (m * m + 1e-12));
  }
  // light temporal smoothing of the gains so they don't flutter
  const smoothed = new Float32Array(F * K);
  for (let f = 0; f < F; f++) {
    const p = Math.max(0, f - 1) * K;
    const c = f * K;
    const x = Math.min(F - 1, f + 1) * K;
    for (let k = 0; k < K; k++) {
      smoothed[c + k] = 0.25 * gains[p + k] + 0.5 * gains[c + k] + 0.25 * gains[x + k];
    }
  }

  const outLen = (F - 1) * HOP + N;
  const out = new Float32Array(input.length);
  const acc = new Float32Array(outLen);
  const wsum = new Float32Array(outLen);
  for (let f = 0; f < F; f++) {
    const base = f * K;
    for (let k = 0; k < K; k++) {
      const g = smoothed[base + k];
      re[k] = specRe[base + k] * g;
      im[k] = specIm[base + k] * g;
    }
    for (let k = K; k < N; k++) {
      re[k] = re[N - k];
      im[k] = -im[N - k];
    }
    fft(re, im, true);
    const off = f * HOP;
    for (let n = 0; n < N; n++) {
      acc[off + n] += re[n] * win[n];
      wsum[off + n] += win[n] * win[n];
    }
  }
  for (let i = 0; i < Math.min(outLen, input.length); i++) {
    out[i] = acc[i] / Math.max(wsum[i], 0.1);
  }
  return out;
}

/* ---------- decode: image pixels → audible samples ---------- */

export function decodeImage(imageData, { iterations = 60, momentum = 0.9 } = {}) {
  const { bytes, frames } = readSoundBlock(imageData);
  const mags = despeckle(bytesToMags(bytes, frames));
  const raw = griffinLim(mags, iterations, momentum);

  // de-emphasis mirrors the encode-side pre-emphasis
  const n = raw.length;
  let samples = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    prev = raw[i] + PRE_EMPH * prev;
    samples[i] = prev;
  }

  // hiss removal, then short fades kill edge clicks and the level is
  // brought back to a comfortable peak
  samples = spectralClean(samples);
  const fade = Math.min(64, n >> 1); // 8 ms at 8 kHz
  for (let i = 0; i < fade; i++) {
    samples[i] *= i / fade;
    samples[n - 1 - i] *= i / fade;
  }
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(samples[i]));
  for (let i = 0; i < n; i++) samples[i] *= 0.85 / peak;

  return {
    samples,
    sr: CODEC.SR,
    frames,
    durationSec: samples.length / CODEC.SR,
  };
}
