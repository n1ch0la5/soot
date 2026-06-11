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
  VERSION: 6,
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
  HEADER_PITCH: 12, // compact centered run, sits within the voice strip
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

/* 8th-order Butterworth low-pass (four cascaded biquads). */
function lowpass(input, sr, fc) {
  let out = input;
  for (const Q of [0.5098, 0.6013, 0.9, 2.5629]) {
    const w = (2 * Math.PI * fc) / sr;
    const cosw = Math.cos(w);
    const alpha = Math.sin(w) / (2 * Q);
    const b0 = (1 - cosw) / 2;
    const b1 = 1 - cosw;
    const b2 = (1 - cosw) / 2;
    const a0 = 1 + alpha;
    const a1 = -2 * cosw;
    const a2 = 1 - alpha;
    const y = new Float32Array(out.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < out.length; i++) {
      const x = out[i];
      const v = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = v;
      y[i] = v;
    }
    out = y;
  }
  return out;
}

/* Downsampling MUST low-pass first: anything above the target's Nyquist
   doesn't vanish, it folds back into the band as static — sibilants
   especially, since /s/ energy lives above 4 kHz. */
export function downsample(input, fromRate, toRate) {
  if (fromRate <= toRate) return resampleLinear(input, fromRate, toRate);
  return resampleLinear(lowpass(input, fromRate, toRate * 0.425), fromRate, toRate);
}

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
    return downsample(mono, ab.sampleRate, targetRate);
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

  // header as a compact dotted line, centered like the strip below it, on
  // its own dark backing pill (the card theme may be light): 1-bits are
  // ivory dots, 0-bits read as the dark backing
  const { HEADER_PITCH } = LAYOUT;
  const headW = HEADER_BITS * HEADER_PITCH + 14;
  const hx0 = Math.floor(LAYOUT.W / 2 - headW / 2);
  for (let y = HEADER_Y - 2; y < HEADER_Y + HEADER_H + 2; y++) {
    for (let x = hx0; x < hx0 + headW; x++) set(x, y, 0, 0, 0);
  }
  const scale = columnScale(frames);
  const bits = packHeaderBits(frames, scale);
  const cy = HEADER_Y + HEADER_H / 2;
  const r = 4;
  for (let i = 0; i < HEADER_BITS; i++) {
    if (!bits[i]) continue;
    const cx = LAYOUT.W / 2 + (i + 0.5 - HEADER_BITS / 2) * HEADER_PITCH;
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

  const { X, HEADER_Y, HEADER_H, HEADER_PITCH, STRIP_Y } = LAYOUT;
  const { BINS, COLS, HEADER_BITS, MAGIC, MAX_STRIPS } = CODEC;
  const bits = [];
  for (let i = 0; i < HEADER_BITS; i++) {
    const cx = LAYOUT.W / 2 + (i + 0.5 - HEADER_BITS / 2) * HEADER_PITCH;
    bits.push(lum(cx * sx, (HEADER_Y + HEADER_H / 2) * sy) > 120 ? 1 : 0);
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

/* Shared decode tail: de-emphasis, hiss cleanup, edge fades, level. */
function polishOutput(raw) {
  const n = raw.length;
  let samples = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    prev = raw[i] + PRE_EMPH * prev;
    samples[i] = prev;
  }
  samples = spectralClean(samples);
  const fade = Math.min(64, n >> 1); // 8 ms at 8 kHz
  for (let i = 0; i < fade; i++) {
    samples[i] *= i / fade;
    samples[n - 1 - i] *= i / fade;
  }
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(samples[i]));
  for (let i = 0; i < n; i++) samples[i] *= 0.85 / peak;
  return samples;
}

/* ---------- decode: image pixels → audible samples ---------- */

export function decodeImage(imageData, { iterations = 60, momentum = 0.9 } = {}) {
  const { bytes, frames } = readSoundBlock(imageData);
  const mags = despeckle(bytesToMags(bytes, frames));
  const samples = polishOutput(griffinLim(mags, iterations, momentum));
  return {
    samples,
    sr: CODEC.SR,
    frames,
    durationSec: samples.length / CODEC.SR,
  };
}

/* ────────────────────────────────────────────────────────────
   Voice-in-a-link: a few seconds of voice packed into a URL
   fragment, so a QR code on a poster IS the recording.
   Pipeline: mel-band spectrogram (28 bands, 4-bit, 50 fps) →
   per-band temporal deltas → deflate → base64url.
   ──────────────────────────────────────────────────────────── */

const LINK = {
  DB_RANGE: 48,
  MAGIC: 0x53,
  VERSION: 3,
  F0_MIN: 60,
  F0_MAX: 400,
  // band count and hop travel in the payload header, so profiles can differ:
  // "card" favors voice quality, "lean" favors a smaller, prettier QR
  PROFILES: {
    card: { bands: 20, hop: 192 },
    lean: { bands: 18, hop: 256 },
  },
};

const MELS = {};
function melBank(bands) {
  if (MELS[bands]) return MELS[bands];
  const { FFT, SR } = CODEC;
  const K = (FFT >> 1) + 1;
  const mel = (f) => 2595 * Math.log10(1 + f / 700);
  const imel = (m) => 700 * (Math.pow(10, m / 2595) - 1);
  const lo = mel(60);
  const hi = mel(SR / 2);
  const centers = [];
  for (let i = 0; i < bands + 2; i++) {
    centers.push((imel(lo + ((hi - lo) * i) / (bands + 1)) * FFT) / SR);
  }
  const w = [];
  for (let m = 0; m < bands; m++) {
    const row = new Float32Array(K);
    const a = centers[m], b = centers[m + 1], c = centers[m + 2];
    for (let k = 0; k < K; k++) {
      if (k > a && k < c) row[k] = k <= b ? (k - a) / (b - a) : (c - k) / (c - b);
    }
    w.push(row);
  }
  const norm = new Float32Array(K);
  for (let m = 0; m < bands; m++) for (let k = 0; k < K; k++) norm[k] += w[m][k];
  MELS[bands] = { w, norm };
  return MELS[bands];
}

/* A faint pair of feedback combs — just enough room tone that the
   reconstructed voice reads as smoky rather than metallic. */
function smokeTail(input, sr) {
  const tail = Math.floor(sr * 0.22);
  const n = input.length + tail;
  const d1 = 311, d2 = 433, fb = 0.45, wet = 0.16;
  const c1 = new Float32Array(n);
  const c2 = new Float32Array(n);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i < input.length ? input[i] : 0;
    c1[i] = x + (i >= d1 ? c1[i - d1] * fb : 0);
    c2[i] = x + (i >= d2 ? c2[i - d2] * fb : 0);
    out[i] = x + (c1[i] - x + (c2[i] - x)) * (wet / 2);
  }
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  for (let i = 0; i < n; i++) out[i] *= 0.85 / peak;
  return out;
}

async function deflateBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function b64urlEncode(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(str) {
  const s = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/* Pitch quantization: 6-bit log scale across the speaking range; 0 = unvoiced. */
function quantF0(f0) {
  const { F0_MIN, F0_MAX } = LINK;
  const q = Math.round((63 * Math.log(f0 / F0_MIN)) / Math.log(F0_MAX / F0_MIN));
  return Math.max(1, Math.min(63, q));
}

function dequantF0(q) {
  const { F0_MIN, F0_MAX } = LINK;
  return F0_MIN * Math.pow(F0_MAX / F0_MIN, q / 63);
}

/* Per-frame pitch track via normalized autocorrelation on a low-passed copy
   of the raw input. One byte per frame: 0 = unvoiced, 1–63 = log-scale F0. */
function trackPitch(rawSamples, F, hop) {
  const sr = CODEC.SR;
  const minLag = Math.floor(sr / LINK.F0_MAX);
  const maxLag = Math.ceil(sr / LINK.F0_MIN);
  const W = 384;

  // normalize + one-pole low-pass (~900 Hz) so harmonics don't fool the lags
  let peak = 1e-9;
  for (let i = 0; i < rawSamples.length; i++) peak = Math.max(peak, Math.abs(rawSamples[i]));
  const a = 1 - Math.exp((-2 * Math.PI * 900) / sr);
  const x = new Float32Array(rawSamples.length + maxLag + W);
  let lp = 0;
  for (let i = 0; i < rawSamples.length; i++) {
    lp += a * (rawSamples[i] / peak - lp);
    x[i] = lp;
  }

  const out = new Uint8Array(F);
  for (let f = 0; f < F; f++) {
    const start = Math.max(0, f * hop + (CODEC.FFT >> 1) - (W >> 1));
    let e0 = 0;
    for (let i = 0; i < W; i++) e0 += x[start + i] * x[start + i];
    if (e0 / W < 1e-5) continue; // silence stays unvoiced
    const corrAt = (lag) => {
      let num = 0;
      let den = 0;
      for (let i = 0; i < W; i++) {
        num += x[start + i] * x[start + i + lag];
        den += x[start + i + lag] * x[start + i + lag];
      }
      return num / Math.sqrt(e0 * den + 1e-12);
    };
    let best = 0;
    let bestLag = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const r = corrAt(lag);
      if (r > best) {
        best = r;
        bestLag = lag;
      }
    }
    // the subharmonic (double period) often edges out the true pitch:
    // if half the lag correlates almost as well, it IS the pitch
    while (bestLag >> 1 >= minLag && corrAt(bestLag >> 1) > 0.9 * best) {
      bestLag >>= 1;
      best = corrAt(bestLag);
    }
    if (best > 0.4) out[f] = quantF0(sr / bestLag);
  }

  // 3-point median kills single-frame octave errors
  const med = new Uint8Array(F);
  for (let f = 0; f < F; f++) {
    const t = [out[Math.max(0, f - 1)], out[f], out[Math.min(F - 1, f + 1)]].sort((p, q) => p - q);
    med[f] = t[1];
  }
  return med;
}

export async function encodeVoiceUrl(rawSamples, profileName = "lean") {
  const { FFT: N } = CODEC;
  const { DB_RANGE } = LINK;
  const { bands, hop } = LINK.PROFILES[profileName] || LINK.PROFILES.lean;
  const samples = conditionInput(rawSamples);
  const F = Math.max(1, Math.floor((samples.length - N) / hop) + 1);
  const win = hann(N);
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const { w } = melBank(bands);
  const mels = new Float32Array(F * bands);
  let maxMel = 1e-9;
  for (let f = 0; f < F; f++) {
    const off = f * hop;
    for (let n = 0; n < N; n++) {
      re[n] = (off + n < samples.length ? samples[off + n] : 0) * win[n];
      im[n] = 0;
    }
    fft(re, im, false);
    for (let m = 0; m < bands; m++) {
      let e = 0;
      const row = w[m];
      for (let k = 0; k <= N >> 1; k++) if (row[k]) e += row[k] * Math.hypot(re[k], im[k]);
      mels[f * bands + m] = e;
      if (e > maxMel) maxMel = e;
    }
  }

  // 4-bit dB quantization, then per-band temporal deltas: smooth speech
  // turns into long runs of zeros, which deflate loves
  const nib = new Uint8Array(F * bands);
  for (let i = 0; i < nib.length; i++) {
    const db = 20 * Math.log10(Math.max(mels[i] / maxMel, 1e-9));
    nib[i] = Math.round(Math.max(0, Math.min(1, 1 + db / DB_RANGE)) * 15);
  }
  const delta = new Uint8Array(F * bands);
  for (let m = 0; m < bands; m++) {
    let prev = 0;
    for (let f = 0; f < F; f++) {
      const cur = nib[f * bands + m];
      delta[f * bands + m] = (cur - prev) & 15;
      prev = cur;
    }
  }
  const pitch = trackPitch(rawSamples, F, hop);

  const nibBytes = Math.ceil(delta.length / 2);
  const packed = new Uint8Array(6 + nibBytes + F);
  packed[0] = LINK.MAGIC;
  packed[1] = LINK.VERSION;
  packed[2] = F & 255;
  packed[3] = F >> 8;
  packed[4] = bands;
  packed[5] = hop >> 4; // hop is always a multiple of 16
  for (let i = 0; i < delta.length; i++) {
    packed[6 + (i >> 1)] |= i % 2 === 0 ? delta[i] << 4 : delta[i];
  }
  packed.set(pitch, 6 + nibBytes);
  return b64urlEncode(await deflateBytes(packed));
}

/* Source-filter resynthesis: a pulse train at the transmitted pitch (noise
   when unvoiced) supplies the phases; the transmitted envelope supplies the
   magnitudes. No phase guessing — the buzz of Griffin-Lim never happens. */
function harmonicSynth(mags, pitch, srcHop) {
  const { FFT: N, HOP, SR } = CODEC;
  const K = (N >> 1) + 1;
  const F2 = mags.length;
  const outLen = (F2 - 1) * HOP + N;
  const win = hann(N);

  // excitation: phase-continuous pulse train / noise, following the track
  let seed = 99;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const exc = new Float32Array(outLen);
  let theta = 0;
  for (let n = 0; n < outLen; n++) {
    const pos = Math.min(pitch.length - 1, n / srcHop);
    const a = Math.floor(pos);
    const b = Math.min(pitch.length - 1, a + 1);
    const qa = pitch[a];
    const qb = pitch[b];
    let f0 = 0;
    if (qa && qb) f0 = dequantF0(qa) * (1 - (pos - a)) + dequantF0(qb) * (pos - a);
    else if (qa || qb) f0 = dequantF0(qa || qb);
    if (f0 > 0) {
      const inc = f0 / SR;
      theta += inc;
      if (theta >= 1) {
        theta -= 1;
        // sub-sample pulse placement: whole-sample quantization makes pulse
        // spacing alternate (57,58,57…), an audible false subharmonic
        const frac = theta / inc; // crossing happened `frac` of a sample ago
        if (n > 0) exc[n - 1] += frac;
        exc[n] += 1 - frac;
      }
      exc[n] += (rnd() * 2 - 1) * 0.03; // breath
    } else {
      theta = 0;
      exc[n] = (rnd() * 2 - 1) * 0.5;
    }
  }

  // frame-wise: excitation phases, transmitted magnitudes, overlap-add
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  const sig = new Float32Array(outLen);
  const wsum = new Float32Array(outLen);
  for (let f = 0; f < F2; f++) {
    const off = f * HOP;
    for (let n = 0; n < N; n++) {
      re[n] = exc[off + n] * win[n];
      im[n] = 0;
    }
    fft(re, im, false);
    // source-filter: the envelope SHAPES the excitation (complex multiply).
    // Forcing magnitudes outright would pump energy into the incoherent
    // bins between harmonics — that's where the growl came from.
    const m = mags[f];
    for (let k = 0; k < K; k++) {
      re[k] *= m[k];
      im[k] *= m[k];
    }
    for (let k = K; k < N; k++) {
      re[k] = re[N - k];
      im[k] = -im[N - k];
    }
    fft(re, im, true);
    for (let n = 0; n < N; n++) {
      sig[off + n] += re[n] * win[n];
      wsum[off + n] += win[n] * win[n];
    }
  }
  for (let i = 0; i < outLen; i++) sig[i] /= Math.max(wsum[i], 0.1);
  return sig;
}

export async function decodeVoiceUrl(payload) {
  const bytes = await inflateBytes(b64urlDecode(payload));
  if (bytes[0] !== LINK.MAGIC) throw new Error("not a soot voice link");
  if (bytes[1] !== LINK.VERSION) throw new Error("made with a different version of soot");
  const F = bytes[2] | (bytes[3] << 8);
  const bands = bytes[4];
  const hop = bytes[5] << 4;
  if (!F || bands < 4 || bands > 64 || hop < 64 || hop > 512) {
    throw new Error("corrupted voice link");
  }
  const { DB_RANGE } = LINK;
  const nibBytes = Math.ceil((F * bands) / 2);
  if (bytes.length < 6 + nibBytes + F) throw new Error("corrupted voice link");
  const pitch = bytes.subarray(6 + nibBytes, 6 + nibBytes + F);
  const getDelta = (i) => (i % 2 === 0 ? bytes[6 + (i >> 1)] >> 4 : bytes[6 + (i >> 1)] & 15);

  // undo deltas, dequantize to linear mel energies
  const melF = [];
  const acc = new Uint8Array(bands);
  for (let f = 0; f < F; f++) {
    const m = new Float32Array(bands);
    for (let b = 0; b < bands; b++) {
      acc[b] = (acc[b] + getDelta(f * bands + b)) & 15;
      m[b] = acc[b] === 0 ? 0 : Math.pow(10, ((acc[b] / 15) * DB_RANGE - DB_RANGE) / 20);
    }
    melF.push(m);
  }

  // interpolate onto the synthesis hop grid, expand mel → linear bins
  const { w, norm } = melBank(bands);
  const K = (CODEC.FFT >> 1) + 1;
  const ratio = hop / CODEC.HOP;
  const F2 = Math.max(2, Math.round((F - 1) * ratio) + 1);
  const mags = [];
  for (let f2 = 0; f2 < F2; f2++) {
    const pos = Math.min(F - 1, f2 / ratio);
    const a = Math.floor(pos);
    const t = pos - a;
    const b = Math.min(F - 1, a + 1);
    const lin = new Float32Array(K);
    for (let m = 0; m < bands; m++) {
      const e = melF[a][m] * (1 - t) + melF[b][m] * t;
      if (!e) continue;
      const row = w[m];
      for (let k = 0; k < K; k++) if (row[k]) lin[k] += row[k] * e;
    }
    for (let k = 0; k < K; k++) if (norm[k] > 0) lin[k] /= norm[k];
    lin[0] = 0;
    lin[1] = 0;
    mags.push(lin);
  }
  const samples = smokeTail(polishOutput(harmonicSynth(mags, pitch, hop)), CODEC.SR);
  return { samples, sr: CODEC.SR, durationSec: samples.length / CODEC.SR };
}
