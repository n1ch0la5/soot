import qrcode from "qrcode-generator";

/* The Soot stamp: a QR code wrapped in a ring of voice, drawn transparent
   in a single mark color — light marks for dark backgrounds, dark marks for
   light ones. Drawn in an 800-unit design space and scaled, so the about
   page and the card corner render the identical mark at any size. */

export const INK = "#1B130A";
export const IVORY = "#F4ECDC";

function withAlpha(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function makeStampAmps() {
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out = [];
  for (let i = 0; i < 220; i++) {
    const t = i / 220;
    const syllable = Math.abs(Math.sin(t * Math.PI * 7));
    out.push(0.15 + 0.85 * syllable * (0.5 + 0.5 * rnd()));
  }
  return out;
}
const STAMP_AMPS = makeStampAmps();

function roundRectPath(ctx, x, y, w, h, r) {
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/* A QR drawn as soot: round dots for data, custom rounded "eyes" in the
   accent color, and (when the code is big enough) a small knockout in the
   middle wearing the wordmark — error correction absorbs the hole. */
export function drawStyledQr(ctx, x, y, size, text, { fg = INK, accent } = {}) {
  let qr;
  try {
    qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
  } catch (e) {
    qr = qrcode(0, "L");
    qr.addData(text);
    qr.make();
  }
  const n = qr.getModuleCount();
  const cell = size / n;
  const mid = n / 2;
  const holeR = n >= 45 ? 4.6 : 0; // modules; ~3% of the code, well under EC
  const inFinder = (r, c) =>
    (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  const inHole = (r, c) => holeR && Math.hypot(r + 0.5 - mid, c + 0.5 - mid) < holeR;

  ctx.save();
  ctx.translate(x, y);

  ctx.fillStyle = fg;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c) || inFinder(r, c) || inHole(r, c)) continue;
      ctx.beginPath();
      ctx.arc((c + 0.5) * cell, (r + 0.5) * cell, cell * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const eye = (er, ec) => {
    const ex = ec * cell;
    const ey = er * cell;
    ctx.fillStyle = fg;
    ctx.beginPath();
    roundRectPath(ctx, ex, ey, 7 * cell, 7 * cell, 2.4 * cell);
    roundRectPath(ctx, ex + cell, ey + cell, 5 * cell, 5 * cell, 1.7 * cell);
    ctx.fill("evenodd");
    ctx.fillStyle = accent || fg;
    ctx.beginPath();
    roundRectPath(ctx, ex + 2 * cell, ey + 2 * cell, 3 * cell, 3 * cell, 1.1 * cell);
    ctx.fill();
  };
  eye(0, 0);
  eye(0, n - 7);
  eye(n - 7, 0);

  if (holeR) {
    ctx.fillStyle = fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `italic ${Math.round(holeR * cell * 1.15)}px 'Instrument Serif', Georgia, serif`;
    ctx.fillText("S", mid * cell, (mid + 0.1) * cell);
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();
}

/* A dense data QR on a cream panel: posters get scanned by cameras under
   real-world light, so this one stays dark-on-light for reliability. */
export function drawQrPanel(ctx, x, y, size, url) {
  let qr;
  try {
    qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
  } catch (e) {
    qr = qrcode(0, "L"); // overflowed at M: drop to L for capacity
    qr.addData(url);
    qr.make();
  }
  const n = qr.getModuleCount();
  const cell = Math.floor((size * 0.88) / n);
  const inner = cell * n;
  const pad = Math.floor((size - inner) / 2);
  ctx.fillStyle = IVORY;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, size, size, 28);
  else ctx.rect(x, y, size, size);
  ctx.fill();
  ctx.fillStyle = INK;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect(x + pad + c * cell, y + pad + r * cell, cell, cell);
    }
  }
}

export function drawStamp(ctx, x, y, size, link, { wordmark = false, fg = INK } = {}) {
  const S = 800;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / S, size / S);

  // waveform ring
  const cx = S / 2;
  const cy = wordmark ? S / 2 - 30 : S / 2;
  const base = wordmark ? 226 : 256;
  ctx.strokeStyle = fg;
  ctx.lineWidth = 3.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i < STAMP_AMPS.length; i++) {
    const ang = -Math.PI / 2 + (i / STAMP_AMPS.length) * Math.PI * 2;
    const len = STAMP_AMPS[i] * 64;
    const r0 = base - len * 0.3;
    const r1 = base + len * 0.7;
    ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
    ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
  }
  ctx.stroke();

  // QR in the middle
  const qr = qrcode(0, "M");
  qr.addData(link);
  qr.make();
  const n = qr.getModuleCount();
  const cell = Math.floor(290 / n);
  const qsize = n * cell;
  const qx = cx - qsize / 2;
  const qy = cy - qsize / 2;
  ctx.fillStyle = fg;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect(qx + c * cell, qy + r * cell, cell, cell);
    }
  }

  if (wordmark) {
    ctx.fillStyle = fg;
    ctx.textAlign = "center";
    ctx.font = "italic 60px 'Instrument Serif', Georgia, serif";
    ctx.fillText("Soot", cx, S - 110);
    ctx.fillStyle = withAlpha(fg, 0.65);
    ctx.font = "22px 'Space Mono', monospace";
    ctx.fillText("a voice hidden in a picture", cx, S - 64);
  }

  ctx.restore();
}
