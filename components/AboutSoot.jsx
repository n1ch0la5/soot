"use client";

import React, { useEffect, useRef, useState } from "react";
import qrcode from "qrcode-generator";

/* The about page keeps the original soot palette regardless of app theme.
   It's a story about lampblack, after all. */
const C = {
  page: "#1E1813",
  card: "#130F0B",
  cardEdge: "#2A231B",
  ivory: "#F4ECDC",
  ember: "#E8A33D",
  textDim: "#9C9183",
  ink: "#1B130A",
};

/* ---------- the Soot stamp: QR ringed by a waveform, for flyers ---------- */
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

function drawStamp(canvas, link) {
  const S = 800;
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d");

  // cream sticker
  ctx.fillStyle = C.ivory;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(0, 0, S, S, 56);
  else ctx.rect(0, 0, S, S);
  ctx.fill();

  // waveform ring around the center
  const amps = makeStampAmps();
  const cx = S / 2;
  const cy = S / 2 - 30;
  const base = 226;
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 3.4;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i < amps.length; i++) {
    const ang = -Math.PI / 2 + (i / amps.length) * Math.PI * 2;
    const len = amps[i] * 64;
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
  ctx.fillStyle = C.ink;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect(qx + c * cell, qy + r * cell, cell, cell);
    }
  }

  // wordmark + tag
  ctx.fillStyle = C.ink;
  ctx.textAlign = "center";
  ctx.font = "italic 60px 'Instrument Serif', Georgia, serif";
  ctx.fillText("Soot", cx, S - 110);
  ctx.fillStyle = "rgba(27,19,10,0.65)";
  ctx.font = "22px 'Space Mono', monospace";
  ctx.fillText("a voice hidden in a picture", cx, S - 64);
}

export default function AboutSoot() {
  const stampRef = useRef(null);
  const [link, setLink] = useState("");

  useEffect(() => {
    const l = `${window.location.origin}/?d`;
    setLink(l);
    const draw = () => stampRef.current && drawStamp(stampRef.current, l);
    draw();
    try {
      document.fonts.ready.then(draw); // redraw once the serif arrives
    } catch (e) {}
  }, []);

  const downloadStamp = () => {
    const c = stampRef.current;
    if (!c) return;
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = "soot-stamp.png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const css = `
    .about-root { min-height:100vh; background:${C.page}; color:${C.ivory};
      font-family:'Hanken Grotesk',sans-serif; display:flex; justify-content:center;
      padding:36px 20px 72px; }
    .about-wrap { max-width:560px; width:100%; }
    .about-mark { font-family:'Instrument Serif',serif; font-style:italic; font-size:30px; }
    .about-back { color:${C.textDim}; font-size:13px; text-decoration:underline;
      text-underline-offset:3px; }
    .about-back:hover { color:${C.ivory}; }
    .about-eyebrow { font-family:'Space Mono',monospace; font-size:11px; letter-spacing:0.22em;
      text-transform:uppercase; color:${C.ember}; margin-top:48px; }
    .about-h { font-family:'Instrument Serif',serif; font-style:italic; font-size:34px;
      line-height:1.2; margin:10px 0 0; font-weight:normal; }
    .about-p { color:${C.textDim}; font-size:16px; line-height:1.75; margin-top:16px; }
    .about-p strong { color:${C.ivory}; font-weight:500; }
    .about-card { margin-top:20px; background:${C.card}; border:1px solid ${C.cardEdge};
      border-radius:18px; padding:28px; }
    .about-quote { font-family:'Instrument Serif',serif; font-style:italic; font-size:21px;
      line-height:1.5; color:${C.ivory}; }
    .about-cite { font-family:'Space Mono',monospace; font-size:11px; color:${C.textDim};
      margin-top:12px; letter-spacing:0.06em; }
    .about-stamp { display:block; width:min(320px,100%); margin:24px auto 0; border-radius:18px;
      box-shadow:0 18px 40px rgba(0,0,0,0.45); }
    .about-actions { display:flex; gap:18px; justify-content:center; align-items:center;
      margin-top:18px; }
    .about-btn { background:${C.ember}; color:${C.ink}; border:none; border-radius:999px;
      padding:12px 26px; font-size:15px; font-weight:600; font-family:inherit; cursor:pointer; }
    .about-btn:active { transform:scale(.97); }
    .about-cta { display:block; text-align:center; margin-top:56px; }
    .about-cta a { color:${C.ember}; font-size:15px; text-decoration:underline;
      text-underline-offset:4px; }
  `;

  return (
    <div className="about-root">
      <style>{css}</style>
      <div className="about-wrap">
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div className="about-mark">Soot</div>
          <a className="about-back" href="/">
            ← back to the app
          </a>
        </header>

        <div className="about-eyebrow">why "soot"</div>
        <h1 className="about-h">The first recording of a human voice was never meant to be heard.</h1>

        <p className="about-p">
          In <strong>1857</strong>, twenty years before Edison's phonograph, a Parisian typesetter
          named <strong>Édouard-Léon Scott de Martinville</strong> patented a strange instrument
          called the <strong>phonautograph</strong>. You spoke into a horn, the sound shook a tiny
          membrane, and a stylus of hog's bristle scratched the vibrations onto paper blackened
          with <strong>lamp soot</strong>. He wanted to give the ear what photography gave the
          eye: a way to <em>look</em> at sound. Playing the marks back never crossed his mind. At
          the time, the very idea would have sounded like magic.
        </p>

        <p className="about-p">
          On <strong>April 9, 1860</strong>, Scott leaned into his machine and sang twenty seconds
          of <em>Au clair de la lune</em>. The sooty page went into an archive and sat there,
          silent, for a century and a half.
        </p>

        <p className="about-p">
          Then in <strong>March 2008</strong>, a team called First Sounds, working with scientists
          at Lawrence Berkeley National Laboratory, scanned the fragile tracings and ran a{" "}
          <strong>virtual stylus</strong> over them in software. Out came a thin, wavering voice
          singing in French. It is the oldest recording of a human voice anyone has ever heard.
        </p>

        <div className="about-card">
          <div className="about-quote">
            The picture was the recording all along. It just had to wait for someone who could
            read it.
          </div>
          <div className="about-cite">au clair de la lune · 1860 → 2008</div>
        </div>

        <p className="about-p">
          <strong>Soot does the same thing on purpose.</strong> Your voice is drawn into a
          picture, loudness and pitch turned into glowing marks, and the picture is all that
          travels. There is no audio file and no server holding your words. Anyone with Soot can
          hold the image up to the light and hear you, a little smoky, the way Scott sounds to us.
        </p>

        <div className="about-eyebrow" style={{ marginTop: 56 }}>
          leave one anywhere
        </div>
        <h2 className="about-h" style={{ fontSize: 26 }}>
          Geocaches, flyers, love notes, scavenger hunts.
        </h2>
        <p className="about-p">
          A sound-image works anywhere a picture works. Tuck one in a cache logbook, tape it
          inside a library book, print it on a flyer and staple it to a phone pole. The stamp
          below is Soot's signature, a QR code wrapped in a voice. It points whoever finds it to
          the decoder, so they know the marks are more than decoration.
        </p>

        <canvas ref={stampRef} className="about-stamp" aria-label="Soot stamp: a QR code ringed by a waveform" />
        <div className="about-actions">
          <button className="about-btn" onClick={downloadStamp}>
            Download the stamp
          </button>
        </div>
        {link && <div className="about-cite" style={{ textAlign: "center" }}>{`scans to ${link}`}</div>}

        <div className="about-cta">
          <a href="/">Record something worth finding →</a>
        </div>
      </div>
    </div>
  );
}
