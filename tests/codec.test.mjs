/* Codec test suite — run with `npm test` (plain Node, no framework).
   Covers: card pixel round-trip, scaled-copy decode, light-background decode,
   voice-in-URL round-trip, pitch vocoder accuracy, and anti-alias filtering. */

import {
  CODEC,
  LAYOUT,
  makeDemoVoice,
  encodeVoice,
  writeSoundBlock,
  readSoundBlock,
  decodeImage,
  encodeVoiceUrl,
  decodeVoiceUrl,
  resampleLinear,
  downsample,
  usedStrips,
} from "../lib/sootVoiceCodec.js";

let failures = 0;
const check = (name, cond, detail = "") => {
  console.log(`${cond ? "ok " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!cond) failures++;
};
const rms = (x) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);

const amps = Array.from({ length: 240 }, (_, i) => 0.2 + 0.6 * Math.abs(Math.sin(i * 0.4)));

/* ---------- card: pixel round-trip ---------- */
{
  const samples = makeDemoVoice(amps, 3.2);
  const { bytes, frames } = encodeVoice(samples);
  const pixels = new Uint8ClampedArray(LAYOUT.W * LAYOUT.H * 4);
  writeSoundBlock(pixels, LAYOUT.W, LAYOUT.H, bytes, frames);
  const imageData = { data: pixels, width: LAYOUT.W, height: LAYOUT.H };

  const rb = readSoundBlock(imageData);
  let maxErr = 0;
  for (let i = 0; i < bytes.length; i++) maxErr = Math.max(maxErr, Math.abs(rb.bytes[i] - bytes[i]));
  check("card pixel round-trip", rb.frames === frames && maxErr <= 3, `maxErr ${maxErr}/255`);

  const dec = decodeImage(imageData, { iterations: 20 });
  check("card decode produces audio", dec.samples.every(Number.isFinite) && rms(dec.samples) > 0.01);

  // spectral fidelity
  const re = encodeVoice(dec.samples);
  const n = Math.min(re.bytes.length, bytes.length);
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += bytes[i]; sb += re.bytes[i]; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) {
    const da = bytes[i] - ma, db = re.bytes[i] - mb;
    cov += da * db; va += da * da; vb += db * db;
  }
  const corr = cov / Math.sqrt(va * vb);
  check("card spectral correlation > 0.9", corr > 0.9, corr.toFixed(3));

  // scaled copy still decodes
  const sw = 810, sh = 1012;
  const scaled = new Uint8ClampedArray(sw * sh * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const ox = Math.min(LAYOUT.W - 1, Math.round(((x + 0.5) * LAYOUT.W) / sw));
      const oy = Math.min(LAYOUT.H - 1, Math.round(((y + 0.5) * LAYOUT.H) / sh));
      const p = (y * sw + x) * 4, q = (oy * LAYOUT.W + ox) * 4;
      scaled[p] = pixels[q]; scaled[p + 1] = pixels[q + 1]; scaled[p + 2] = pixels[q + 2]; scaled[p + 3] = 255;
    }
  }
  const dec2 = decodeImage({ data: scaled, width: sw, height: sh }, { iterations: 8 });
  check("scaled-copy decode", dec2.frames === frames);
}

/* ---------- card: light theme background ---------- */
{
  const { bytes, frames } = encodeVoice(makeDemoVoice(amps, 2));
  const pixels = new Uint8ClampedArray(LAYOUT.W * LAYOUT.H * 4).fill(255);
  writeSoundBlock(pixels, LAYOUT.W, LAYOUT.H, bytes, frames);
  const dec = decodeImage({ data: pixels, width: LAYOUT.W, height: LAYOUT.H }, { iterations: 8 });
  check("light-card decode", dec.frames === frames);
}

/* ---------- card: strip layout ---------- */
{
  for (const [dur, want] of [[2, 1], [7.4, 1]]) {
    const { frames } = encodeVoice(makeDemoVoice(amps, dur));
    check(`${dur}s uses ${want} strip`, usedStrips(frames) === want);
  }
}

/* ---------- voice-in-URL: round-trip + capacity ---------- */
{
  const p3 = await encodeVoiceUrl(makeDemoVoice(amps, 3), "lean");
  check("lean 3s fits a QR comfortably", p3.length + 33 < 1100, `${p3.length + 33} chars`);
  const dec = await decodeVoiceUrl(p3);
  check("URL voice decodes", dec.samples.every(Number.isFinite) && rms(dec.samples) > 0.01);

  const pCard = await encodeVoiceUrl(makeDemoVoice(amps, 7.4), "card");
  check("card-profile 7.4s under QR ceiling", pCard.length + 33 < 2953, `${pCard.length + 33} chars`);
}

/* ---------- pitch vocoder: contour survives the round-trip ---------- */
{
  const sr = CODEC.SR, dur = 3, n = sr * dur;
  const f0at = (t) => 110 + 60 * (t / dur);
  const sig = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    ph += (2 * Math.PI * f0at(t)) / sr;
    let s = 0;
    for (let h = 1; h <= 14; h++) {
      const f = f0at(t) * h;
      if (f > 3800) break;
      const g1 = (f - 650) / 450, g2 = (f - 1700) / 550;
      s += ((Math.exp(-(g1 * g1)) + 0.5 * Math.exp(-(g2 * g2))) / h) * Math.sin(ph * h);
    }
    sig[i] = s * 0.4;
  }
  const dec = await decodeVoiceUrl(await encodeVoiceUrl(sig, "lean"));
  const measure = (x, c) => {
    const W = 600, s0 = Math.floor(c - W / 2);
    const corrAt = (lag) => {
      let num = 0, d1 = 0, d2 = 0;
      for (let i = 0; i < W; i++) {
        const a = x[s0 + i] || 0, b = x[s0 + i + lag] || 0;
        num += a * b; d1 += a * a; d2 += b * b;
      }
      return num / Math.sqrt(d1 * d2 + 1e-12);
    };
    let best = 0, bl = 0;
    for (let lag = 20; lag <= 134; lag++) {
      const r = corrAt(lag);
      if (r > best) { best = r; bl = lag; }
    }
    while (bl >> 1 >= 20 && corrAt(bl >> 1) > 0.9 * best) { bl >>= 1; best = corrAt(bl); }
    return sr / bl;
  };
  let worst = 0;
  for (const frac of [0.2, 0.45, 0.7, 0.88]) {
    const want = f0at(dur * frac);
    const got = measure(dec.samples, Math.floor(dur * frac * sr));
    worst = Math.max(worst, (Math.abs(got - want) / want) * 100);
  }
  check("pitch contour within 10%", worst < 10, `worst ${worst.toFixed(1)}%`);
}

/* ---------- anti-aliasing on downsample ---------- */
{
  const from = 48000, n = from;
  const tone = new Float32Array(n);
  for (let i = 0; i < n; i++) tone[i] = Math.sin((2 * Math.PI * 6000 * i) / from);
  const sup = 20 * Math.log10(rms(resampleLinear(tone, from, 8000)) / rms(downsample(tone, from, 8000)));
  check("6kHz alias suppressed > 30dB", sup > 30, `${sup.toFixed(1)} dB`);
  const inband = new Float32Array(n);
  for (let i = 0; i < n; i++) inband[i] = Math.sin((2 * Math.PI * 1500 * i) / from);
  const level = rms(downsample(inband, from, 8000));
  check("in-band passes intact", Math.abs(level - 0.707) < 0.02, `rms ${level.toFixed(3)}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL CODEC TESTS PASSED");
process.exit(failures ? 1 : 0);
