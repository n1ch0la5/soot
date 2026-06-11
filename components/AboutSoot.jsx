"use client";

import React, { useEffect, useRef, useState } from "react";
import { drawStamp, saveCanvasPng, INK, IVORY } from "./sootStamp";
import { THEMES, loadTheme } from "./themes";

const BTN_TEXT = "#1B130A"; // text on the accent button, dark on every theme

function renderStamp(canvas, link, fg) {
  const S = 800;
  canvas.width = S;
  canvas.height = S;
  drawStamp(canvas.getContext("2d"), 0, 0, S, link, { wordmark: true, fg });
}

export default function AboutSoot() {
  const stampRef = useRef(null);
  const [link, setLink] = useState("");
  const [theme, setTheme] = useState("soot");
  const C = THEMES[theme];

  useEffect(() => {
    setTheme(loadTheme());
  }, []);

  useEffect(() => {
    const l = `${window.location.origin}/?d`;
    setLink(l);
    // preview draws in the theme's mark color so it reads on the page
    const draw = () => stampRef.current && renderStamp(stampRef.current, l, C.ivory);
    draw();
    try {
      document.fonts.ready.then(draw); // redraw once the serif arrives
    } catch (e) {}
  }, [C.ivory]);

  // transparent PNG: pick the mark color for the paper it'll live on.
  // saveCanvasPng routes through the share sheet on mobile (→ Photos app)
  const downloadStamp = (fg, name) => async () => {
    const c = document.createElement("canvas");
    renderStamp(c, link, fg);
    try {
      await saveCanvasPng(c, name);
    } catch (e) {}
  };

  const css = `
    .about-root { min-height:100vh; background:var(--s-page); color:var(--s-fg);
      font-family:'Hanken Grotesk',sans-serif; display:flex; justify-content:center;
      padding:36px 20px 72px; }
    .about-wrap { max-width:560px; width:100%; }
    .about-mark { font-family:'Instrument Serif',serif; font-style:italic; font-size:30px; }
    .about-back { color:var(--s-text-dim); font-size:13px; text-decoration:underline;
      text-underline-offset:3px; }
    .about-back:hover { color:var(--s-fg); }
    .about-eyebrow { font-family:'Space Mono',monospace; font-size:11px; letter-spacing:0.22em;
      text-transform:uppercase; color:var(--s-accent); margin-top:48px; }
    .about-h { font-family:'Instrument Serif',serif; font-style:italic; font-size:34px;
      line-height:1.2; margin:10px 0 0; font-weight:normal; }
    .about-p { color:var(--s-text-dim); font-size:16px; line-height:1.75; margin-top:16px; }
    .about-p strong { color:var(--s-fg); font-weight:500; }
    .about-card { margin-top:20px; background:var(--s-card); border:1px solid var(--s-edge);
      border-radius:18px; padding:28px; }
    .about-quote { font-family:'Instrument Serif',serif; font-style:italic; font-size:21px;
      line-height:1.5; color:var(--s-fg); }
    .about-cite { font-family:'Space Mono',monospace; font-size:11px; color:var(--s-text-dim);
      margin-top:12px; letter-spacing:0.06em; }
    .about-stamp { display:block; width:min(320px,100%); margin:24px auto 0; }
    .about-actions { display:flex; gap:18px; justify-content:center; align-items:center;
      margin-top:18px; }
    .about-btn { background:var(--s-accent); color:${BTN_TEXT}; border:none; border-radius:999px;
      padding:12px 26px; font-size:15px; font-weight:600; font-family:inherit; cursor:pointer; }
    .about-btn:active { transform:scale(.97); }
    .about-cta { display:block; text-align:center; margin-top:56px; }
    .about-cta a { color:var(--s-accent); font-size:15px; text-decoration:underline;
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
          <button className="about-btn" onClick={downloadStamp(INK, "soot-stamp-for-light-paper.png")}>
            For light paper
          </button>
          <button className="about-btn" onClick={downloadStamp(IVORY, "soot-stamp-for-dark-paper.png")}>
            For dark paper
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
