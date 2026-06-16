/* Print-and-photograph kill-test (run with `npm run robustness`).

   The card stores audio as ANALOG pixel brightness (~6 useful bits/pixel),
   read by a single-pixel proportional sampler with NO payload error
   correction (see readSoundBlock in lib/sootVoiceCodec.js). This harness
   throws realistic print->photo degradations at a pixel-perfect card and
   measures whether the voice still comes back:

     - JPEG (real 8x8 DCT luma quantization) at several qualities
     - optical blur (camera/lens softening)
     - downscale (limited camera resolution / app rescale)
     - luminance gradient (uneven lighting / auto white balance)
     - mild keystone + rotation (photographed slightly off-square)
     - print posterization + sensor noise
     - composite "phone photo" pipelines stacking the above

   It runs two cards: a SHORT clip (wide ~4px columns, the robust case) and a
   near-max clip (1px columns, the fragile case the roadmap predicted). The
   decoder reads luminance only, so every transform operates on a luminance
   buffer that is fed back as a gray image — faithful to what decode sees.

   This is a measurement, not a pass/fail gate. The bottom line is the verdict:
   does the analog-brightness print channel survive a casual photo at all? */

import {
  CODEC,
  LAYOUT,
  makeDemoVoice,
  encodeVoice,
  writeSoundBlock,
  readSoundBlock,
  decodeImage,
} from "../lib/sootVoiceCodec.js";

/* ---------- deterministic RNG (stable results across runs) ---------- */
let _seed = 0x9e3779b1;
const rand = () => {
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff;
  return _seed / 0x7fffffff;
};
const gauss = () => {
  const u = Math.max(1e-9, rand()), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/* ---------- luminance <-> image plumbing ---------- */
const W = LAYOUT.W, H = LAYOUT.H;
const LUMA = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function toLuma(rgba, w, h) {
  const Y = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) Y[i] = LUMA(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  return Y;
}
function toImageData(Y, w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = Y[i];
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}
const sample = (Y, w, h, fx, fy) => {
  fx = Math.max(0, Math.min(w - 1, fx));
  fy = Math.max(0, Math.min(h - 1, fy));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const a = Y[y0 * w + x0], b = Y[y0 * w + x1], c = Y[y1 * w + x0], d = Y[y1 * w + x1];
  return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
};

/* ---------- transforms (each takes & returns {Y, w, h}) ---------- */

// Real JPEG luminance path: 8x8 DCT, scaled standard quant table, inverse DCT.
const JPEG_Q = [
  16,11,10,16,24,40,51,61, 12,12,14,19,26,58,60,55, 14,13,16,24,40,57,69,56,
  14,17,22,29,51,87,80,62, 18,22,37,56,68,109,103,77, 24,35,55,64,81,104,113,92,
  49,64,78,87,103,121,120,101, 72,92,95,98,112,100,103,99,
];
const A8 = Array.from({ length: 8 }, (_, u) => (u === 0 ? Math.sqrt(1 / 8) : Math.sqrt(2 / 8)));
const COS8 = Array.from({ length: 8 }, (_, u) =>
  Array.from({ length: 8 }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / 16)));
function dct8(v, inv) {
  const o = new Float64Array(8);
  if (!inv) for (let u = 0; u < 8; u++) { let s = 0; for (let x = 0; x < 8; x++) s += v[x] * COS8[u][x]; o[u] = A8[u] * s; }
  else for (let x = 0; x < 8; x++) { let s = 0; for (let u = 0; u < 8; u++) s += A8[u] * v[u] * COS8[u][x]; o[x] = s; }
  return o;
}
function jpeg({ Y, w, h }, quality) {
  const scale = quality < 50 ? 5000 / quality : 200 - 2 * quality;
  const q = JPEG_Q.map((b) => Math.max(1, Math.floor((b * scale + 50) / 100)));
  const out = Float32Array.from(Y);
  const blk = new Float64Array(64), col = new Float64Array(8);
  for (let by = 0; by < h; by += 8) {
    for (let bx = 0; bx < w; bx += 8) {
      for (let y = 0; y < 8; y++) {
        const row = new Float64Array(8);
        for (let x = 0; x < 8; x++) {
          const sx = Math.min(w - 1, bx + x), sy = Math.min(h - 1, by + y);
          row[x] = Y[sy * w + sx] - 128;
        }
        const r = dct8(row, false);
        for (let x = 0; x < 8; x++) blk[y * 8 + x] = r[x];
      }
      for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 8; y++) col[y] = blk[y * 8 + x];
        const c = dct8(col, false);
        for (let y = 0; y < 8; y++) blk[y * 8 + x] = Math.round(c[y] / q[y * 8 + x]) * q[y * 8 + x];
      }
      for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 8; y++) col[y] = blk[y * 8 + x];
        const c = dct8(col, true);
        for (let y = 0; y < 8; y++) blk[y * 8 + x] = c[y];
      }
      for (let y = 0; y < 8; y++) {
        const row = new Float64Array(8);
        for (let x = 0; x < 8; x++) row[x] = blk[y * 8 + x];
        const r = dct8(row, true);
        for (let x = 0; x < 8; x++) {
          const dx = bx + x, dy = by + y;
          if (dx < w && dy < h) out[dy * w + dx] = Math.max(0, Math.min(255, r[x] + 128));
        }
      }
    }
  }
  return { Y: out, w, h };
}

function blur({ Y, w, h }, sigma) {
  const rad = Math.max(1, Math.ceil(3 * sigma));
  const k = []; let sum = 0;
  for (let i = -rad; i <= rad; i++) { const g = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(g); sum += g; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0; for (let i = -rad; i <= rad; i++) s += k[i + rad] * Y[y * w + Math.max(0, Math.min(w - 1, x + i))];
    tmp[y * w + x] = s;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0; for (let i = -rad; i <= rad; i++) s += k[i + rad] * tmp[Math.max(0, Math.min(h - 1, y + i)) * w + x];
    out[y * w + x] = s;
  }
  return { Y: out, w, h };
}

function downscale({ Y, w, h }, targetW) {
  if (targetW >= w) return { Y, w, h };
  const tw = targetW, th = Math.round((h * targetW) / w);
  const out = new Float32Array(tw * th);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++)
    out[y * tw + x] = sample(Y, w, h, ((x + 0.5) * w) / tw - 0.5, ((y + 0.5) * h) / th - 0.5);
  return { Y: out, w: tw, h: th };
}

function gradient({ Y, w, h }, lo, hi) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = (x / w + y / h) / 2; // diagonal light falloff
    out[y * w + x] = Math.max(0, Math.min(255, Y[y * w + x] * (lo + (hi - lo) * t)));
  }
  return { Y: out, w, h };
}

// mild perspective: keystone (horizontal scale varies with row) + small rotation
function keystone({ Y, w, h }, k, deg) {
  const out = new Float32Array(w * h);
  const cx = w / 2, cy = h / 2, th = (deg * Math.PI) / 180, cs = Math.cos(th), sn = Math.sin(th);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = 1 + k * ((y - cy) / h); // top vs bottom horizontal stretch
    let ix = cx + (x - cx) / sx, iy = y;
    const dx = ix - cx, dy = iy - cy;
    ix = cx + dx * cs + dy * sn; iy = cy - dx * sn + dy * cs;
    out[y * w + x] = sample(Y, w, h, ix, iy);
  }
  return { Y: out, w, h };
}

function printNoise({ Y, w, h }, levels, noiseStd) {
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const q = Math.round((Y[i] / 255) * levels) / levels * 255; // posterize
    out[i] = Math.max(0, Math.min(255, q + gauss() * noiseStd));
  }
  return { Y: out, w, h };
}

/* ---------- reference cards ---------- */
const amps = Array.from({ length: 240 }, (_, i) => 0.2 + 0.6 * Math.abs(Math.sin(i * 0.4)));
function makeCard(durSec) {
  const samples = makeDemoVoice(amps, durSec);
  const { bytes, frames } = encodeVoice(samples);
  const pixels = new Uint8ClampedArray(W * H * 4);
  writeSoundBlock(pixels, W, H, bytes, frames);
  // recover the column scale the codec chose (header bits 32..36)
  const rb0 = readSoundBlock({ data: pixels, width: W, height: H });
  return { bytes, frames, Y: toLuma(pixels, W, H), refScale: rb0 };
}

/* ---------- metric: feed a degraded luminance buffer through decode ---------- */
const pearson = (a, b, n) => {
  let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; cov += da * db; va += da * da; vb += db * db; }
  return cov / Math.sqrt(va * vb + 1e-12);
};
function measure(card, deg) {
  const img = toImageData(deg.Y, deg.w, deg.h);
  let headerOk = true, framesOk = false, byteMae = 255, corr = 0, note = "";
  try {
    const rb = readSoundBlock(img);
    framesOk = rb.frames === card.frames;
    if (framesOk) {
      let sum = 0; const n = card.bytes.length;
      for (let i = 0; i < n; i++) sum += Math.abs(rb.bytes[i] - card.bytes[i]);
      byteMae = sum / n;
    }
  } catch (e) { headerOk = false; note = e.message; }
  if (headerOk && framesOk) {
    try {
      const dec = decodeImage(img, { iterations: 12 });
      const re = encodeVoice(dec.samples);
      corr = pearson(re.bytes, card.bytes, Math.min(re.bytes.length, card.bytes.length));
    } catch (e) { note = "decode: " + e.message; }
  }
  return { headerOk, framesOk, byteMae, corr, note };
}

/* ---------- scenarios ---------- */
const scenarios = [
  ["clean (control)", (c) => c],
  ["JPEG q85", (c) => jpeg(c, 85)],
  ["JPEG q70", (c) => jpeg(c, 70)],
  ["JPEG q50", (c) => jpeg(c, 50)],
  ["blur sigma 0.8", (c) => blur(c, 0.8)],
  ["downscale -> 720w", (c) => downscale(c, 720)],
  ["downscale -> 480w", (c) => downscale(c, 480)],
  ["light gradient .8-1.15", (c) => gradient(c, 0.8, 1.15)],
  ["keystone+rotate (mild)", (c) => keystone(c, 0.06, 1.5)],
  ["posterize+noise", (c) => printNoise(c, 48, 4)],
  ["PHONE PHOTO (cooperative)", (c) =>
    printNoise(downscale(jpeg(gradient(blur(c, 0.7), 0.85, 1.1), 75), 900), 64, 3)],
  ["PHONE PHOTO (casual/tilted)", (c) =>
    printNoise(downscale(jpeg(gradient(blur(keystone(c, 0.08, 2.5), 1.0), 0.75, 1.2), 60), 600), 48, 5)],
];

/* ---------- run ---------- */
const profiles = [
  ["SHORT ~1.5s (wide cols)", 1.5],
  ["NEAR-MAX ~7.4s (1px cols)", 7.4],
];

const fmt = (n, p = 2) => (n < 0 ? "" : " ") + n.toFixed(p);
const verdict = (m) => !m.headerOk ? "DEAD (no header)" : !m.framesOk ? "DEAD (frames)" : m.corr > 0.85 ? "ALIVE" : m.corr > 0.6 ? "WEAK" : "DEAD (garbled)";

console.log("\n=== Soot print-and-photograph kill-test ===");
console.log("metric: header survival, payload byte MAE (/255), audio spectral corr vs original\n");

const summary = {};
for (const [pname, dur] of profiles) {
  const card = makeCard(dur);
  const scale = card.refScale ? "" : "";
  console.log(`\n--- profile: ${pname}  (frames ${card.frames}) ---`);
  console.log("scenario".padEnd(30) + "header  framesOK  byteMAE   corr    verdict");
  for (const [sname, fn] of scenarios) {
    const m = measure(card, fn({ Y: Float32Array.from(card.Y), w: W, h: H }));
    const v = verdict(m);
    summary[`${pname} | ${sname}`] = v;
    console.log(
      sname.padEnd(30) +
      (m.headerOk ? "ok    " : "FAIL  ") + "  " +
      (m.framesOk ? "yes     " : "no      ") + " " +
      (m.framesOk ? fmt(m.byteMae).padStart(7) : "   -   ") + "  " +
      (m.framesOk ? fmt(m.corr).padStart(6) : "   -  ") + "   " + v
    );
  }
}

/* ---------- bottom line ---------- */
console.log("\n=== VERDICT ===");
const phoneShort = summary["SHORT ~1.5s (wide cols) | PHONE PHOTO (cooperative)"];
const phoneMax = summary["NEAR-MAX ~7.4s (1px cols) | PHONE PHOTO (cooperative)"];
console.log(`Cooperative phone photo, wide-column short clip : ${phoneShort}`);
console.log(`Cooperative phone photo, near-max 1px-col clip  : ${phoneMax}`);
const alive = (v) => v === "ALIVE" || v === "WEAK";
if (!alive(phoneShort)) {
  console.log("\n>> Print channel looks DEAD even for the robust wide-column case.");
  console.log(">> The analog-brightness payload cannot survive a casual photo as-is.");
  console.log(">> Do NOT invest in homography/fiducials yet — fix the channel (ECC,");
  console.log(">> adaptive threshold, multi-pixel cell averaging) or route voice via the QR/URL.");
} else if (!alive(phoneMax)) {
  console.log("\n>> Print channel survives ONLY for short/wide-column clips.");
  console.log(">> Near-max 1px columns die on a photo, as predicted. Cap printed-card");
  console.log(">> capacity low, or move long messages to the QR/URL voice path.");
} else {
  console.log("\n>> Print channel survives a cooperative photo for both profiles.");
  console.log(">> Geometry/framing (not grayscale destruction) is the remaining problem —");
  console.log(">> homography + a reticle capture UI are now justified.");
}
console.log("");
