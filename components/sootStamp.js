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
