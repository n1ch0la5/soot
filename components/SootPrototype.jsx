"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  CODEC,
  LAYOUT,
  encodeVoice,
  decodeImage,
  writeSoundBlock,
  blobToSamples,
  makeDemoVoice,
  resampleLinear,
} from "../lib/sootVoiceCodec";

/* ────────────────────────────────────────────────────────────
   SOOT — paper that talks
   Compose: record → style → caption.
   Send: weaves the voice into the picture itself — a visible
   spectrogram painted on the card. Only the PNG travels.
   Receive: tap the image and Soot reads the marks back into a
   smoky, robotic, but understandable voice. Secret messages.
   ──────────────────────────────────────────────────────────── */

const N = 240;

/* Theme palettes. "ivory" is the foreground/marks color, "ember" the accent.
   The card's sound block (strips + header dots) is NOT themed — it stays
   bright-on-black so every theme's PNG decodes identically. */
const THEMES = {
  soot: {
    label: "Soot",
    page: "#1E1813",
    card: "#130F0B",
    cardEdge: "#2A231B",
    ivory: "#F4ECDC",
    ivoryDim: "rgba(244,236,220,0.16)",
    ember: "#E8A33D",
    emberSoft: "rgba(232,163,61,0.35)",
    textDim: "#9C9183",
  },
  slate: {
    label: "Slate",
    page: "#0F1217",
    card: "#151A22",
    cardEdge: "#272F3B",
    ivory: "#E9EDF4",
    ivoryDim: "rgba(233,237,244,0.16)",
    ember: "#7FA8FF",
    emberSoft: "rgba(127,168,255,0.35)",
    textDim: "#8C95A4",
  },
  orchid: {
    label: "Orchid",
    page: "#14101B",
    card: "#1B1526",
    cardEdge: "#2F2740",
    ivory: "#F0EAF8",
    ivoryDim: "rgba(240,234,248,0.16)",
    ember: "#B98AFF",
    emberSoft: "rgba(185,138,255,0.35)",
    textDim: "#9A8FAE",
  },
  paper: {
    label: "Paper",
    page: "#EFEAE0",
    card: "#FAF7F1",
    cardEdge: "#DCD4C4",
    ivory: "#2A241C",
    ivoryDim: "rgba(42,36,28,0.18)",
    ember: "#C9722A",
    emberSoft: "rgba(201,114,42,0.30)",
    textDim: "#8B8270",
  },
};

function hexA(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

const STYLES = [
  { id: "trace", label: "Trace" },
  { id: "ridge", label: "Ridge" },
  { id: "bars", label: "Bars" },
  { id: "ring", label: "Ring" },
];

/* ---------- demo message envelope (voice-like syllables) ---------- */
function makeDemoAmps() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const bursts = [
    [0.03, 0.15],
    [0.19, 0.33],
    [0.39, 0.46],
    [0.52, 0.71],
    [0.78, 0.95],
  ];
  const out = [];
  for (let i = 0; i < N; i++) {
    const t = i / N;
    let env = 0.035;
    for (const [a, b] of bursts) {
      if (t >= a && t <= b) {
        const u = (t - a) / (b - a);
        env = Math.max(env, Math.sin(Math.PI * u) * (0.55 + 0.45 * rnd()));
      }
    }
    out.push(
      Math.min(1, Math.abs(env * (0.7 + 0.3 * Math.sin(i * 0.85) + 0.25 * rnd())))
    );
  }
  return out;
}
const DEMO_AMPS = makeDemoAmps();
const DEMO_DUR = 3.2;

function resample(raw, n) {
  if (!raw.length) return new Array(n).fill(0.05);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i / n) * raw.length);
    const b = Math.max(a + 1, Math.floor(((i + 1) / n) * raw.length));
    let m = 0;
    for (let j = a; j < b; j++) m = Math.max(m, raw[j]);
    out.push(Math.max(0.03, Math.min(1, m)));
  }
  return out;
}

/* ---------- waveform path renderers (shared by screen + export) ---------- */
function pathTrace(ctx, w, h, amps) {
  const mid = h / 2;
  ctx.beginPath();
  for (let i = 0; i < amps.length; i++) {
    const x = (i / (amps.length - 1)) * w;
    const dir = i % 2 === 0 ? -1 : 1;
    const y = mid + dir * amps[i] * mid * 0.82;
    if (i === 0) ctx.moveTo(x, y);
    else {
      const px = ((i - 1) / (amps.length - 1)) * w;
      ctx.quadraticCurveTo((px + x) / 2, mid, x, y);
    }
  }
  ctx.stroke();
}

function pathRidge(ctx, w, h, amps) {
  const mid = h / 2;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  for (let i = 0; i < amps.length; i++) {
    ctx.lineTo((i / (amps.length - 1)) * w, mid - amps[i] * mid * 0.85);
  }
  for (let i = amps.length - 1; i >= 0; i--) {
    ctx.lineTo((i / (amps.length - 1)) * w, mid + amps[i] * mid * 0.85);
  }
  ctx.closePath();
  ctx.fill();
}

function pathBars(ctx, w, h, amps) {
  const mid = h / 2;
  const step = w / amps.length;
  const bw = Math.max(1.5, step * 0.45);
  for (let i = 0; i < amps.length; i += 2) {
    const x = i * step;
    const bh = Math.max(2, amps[i] * h * 0.84);
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, mid - bh / 2, bw, bh, bw / 2);
    else ctx.rect(x, mid - bh / 2, bw, bh);
    ctx.fill();
  }
}

function pathRing(ctx, w, h, amps) {
  const cx = w / 2,
    cy = h / 2;
  const base = Math.min(w, h) * 0.26;
  ctx.beginPath();
  for (let i = 0; i < amps.length; i++) {
    const ang = -Math.PI / 2 + (i / amps.length) * Math.PI * 2;
    const len = amps[i] * base * 0.75;
    const r0 = base - len * 0.3;
    const r1 = base + len * 0.7;
    ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
    ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
  }
  ctx.stroke();
}

function drawStyle(ctx, w, h, amps, styleId) {
  if (styleId === "trace") pathTrace(ctx, w, h, amps);
  else if (styleId === "ridge") pathRidge(ctx, w, h, amps);
  else if (styleId === "bars") pathBars(ctx, w, h, amps);
  else pathRing(ctx, w, h, amps);
}

function drawScene(canvas, amps, styleId, progress, trim = [0, 1], COLORS = THEMES.soot) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth,
    h = canvas.clientHeight;
  if (canvas.width !== w * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const layer = (color, lw) => {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    drawStyle(ctx, w, h, amps, styleId);
  };

  layer(COLORS.ivoryDim, styleId === "ring" ? 2 : 1.6);

  if (progress > 0) {
    ctx.save();
    ctx.beginPath();
    if (styleId === "ring") {
      const cx = w / 2,
        cy = h / 2;
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, Math.max(w, h), -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
      ctx.closePath();
    } else {
      ctx.rect(0, 0, w * progress, h);
    }
    ctx.clip();
    ctx.shadowColor = COLORS.emberSoft;
    ctx.shadowBlur = 10;
    layer(COLORS.ivory, styleId === "ring" ? 2.4 : 2);
    ctx.restore();

    if (progress < 1) {
      let hx, hy;
      const idx = Math.min(amps.length - 1, Math.floor(progress * (amps.length - 1)));
      if (styleId === "ring") {
        const cx = w / 2,
          cy = h / 2;
        const base = Math.min(w, h) * 0.26;
        const ang = -Math.PI / 2 + progress * Math.PI * 2;
        hx = cx + Math.cos(ang) * (base + amps[idx] * base * 0.4);
        hy = cy + Math.sin(ang) * (base + amps[idx] * base * 0.4);
      } else {
        hx = progress * w;
        hy = h / 2;
      }
      ctx.beginPath();
      ctx.fillStyle = COLORS.ember;
      ctx.shadowColor = COLORS.ember;
      ctx.shadowBlur = 14;
      ctx.arc(hx, hy, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // dim the trimmed-away region in the geometry of the current style:
  // a wedge for the ring (time runs around the circle), side rects otherwise
  if (trim[0] > 0 || trim[1] < 1) {
    ctx.save();
    ctx.beginPath();
    if (styleId === "ring") {
      const cx = w / 2,
        cy = h / 2;
      const a0 = -Math.PI / 2 + trim[0] * Math.PI * 2;
      const a1 = -Math.PI / 2 + trim[1] * Math.PI * 2;
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, Math.max(w, h), a1, a0 + Math.PI * 2);
      ctx.closePath();
    } else {
      ctx.rect(0, 0, w * trim[0], h);
      ctx.rect(w * trim[1], 0, w * (1 - trim[1]), h);
    }
    ctx.fillStyle = hexA(COLORS.card, 0.72);
    ctx.fill();
    ctx.restore();
  }
}

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

function fmt(s) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

/* ---------- card renderer: the PNG that carries the voice ---------- */
async function renderCard({ amps, styleId, caption, durationSec, dateStr, sound, palette }) {
  const COLORS = palette || THEMES.soot;
  try {
    await Promise.all([
      document.fonts.load("italic 60px 'Instrument Serif'"),
      document.fonts.load("28px 'Space Mono'"),
    ]);
  } catch (e) {}

  const W = LAYOUT.W,
    H = LAYOUT.H;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");

  // smoked card background
  ctx.fillStyle = COLORS.card;
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, H * 0.3, 80, W / 2, H * 0.3, W);
  g.addColorStop(0, hexA(COLORS.ivory, 0.04));
  g.addColorStop(1, hexA(COLORS.page, 0.45));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // grain
  const nc = document.createElement("canvas");
  nc.width = 200;
  nc.height = 200;
  const nctx = nc.getContext("2d");
  const img = nctx.createImageData(200, 200);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 13;
  }
  nctx.putImageData(img, 0, 0);
  ctx.fillStyle = ctx.createPattern(nc, "repeat");
  ctx.fillRect(0, 0, W, H);

  // hairline frame
  ctx.strokeStyle = COLORS.cardEdge;
  ctx.lineWidth = 3;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(30, 30, W - 60, H - 60, 36);
  else ctx.rect(30, 30, W - 60, H - 60);
  ctx.stroke();

  // waveform art, fully revealed
  ctx.save();
  ctx.translate(110, 150);
  const ww = W - 220,
    wh = 380;
  ctx.strokeStyle = COLORS.ivory;
  ctx.fillStyle = COLORS.ivory;
  ctx.lineWidth = styleId === "ring" ? 7 : 6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.shadowColor = COLORS.emberSoft;
  ctx.shadowBlur = 30;
  drawStyle(ctx, ww, wh, amps, styleId);
  ctx.restore();

  // caption
  ctx.textAlign = "center";
  if (caption) {
    ctx.fillStyle = COLORS.ivory;
    let size = 60;
    ctx.font = `italic ${size}px 'Instrument Serif', Georgia, serif`;
    while (size > 34 && ctx.measureText(caption).width > W - 200) {
      size -= 2;
      ctx.font = `italic ${size}px 'Instrument Serif', Georgia, serif`;
    }
    ctx.fillText(caption, W / 2, 620);
  }

  // meta
  ctx.fillStyle = COLORS.textDim;
  ctx.font = "28px 'Space Mono', monospace";
  ctx.fillText(fmt(durationSec) + " · " + dateStr, W / 2, caption ? 678 : 632);

  // hint under the strips
  ctx.fillStyle = COLORS.textDim;
  ctx.font = "22px 'Space Mono', monospace";
  ctx.fillText("the voice lives in these marks — decode with soot", W / 2, 1128);

  // wordmark
  ctx.fillStyle = hexA(COLORS.ivory, 0.4);
  ctx.font = "italic 42px 'Instrument Serif', Georgia, serif";
  ctx.fillText("Soot", W / 2, H - 80);

  // the voice itself: header + spectrogram strips, written pixel-exact
  const id = ctx.getImageData(0, 0, W, H);
  writeSoundBlock(id.data, W, H, sound.bytes, sound.frames);
  ctx.putImageData(id, 0, 0);

  return c;
}

/* ════════════════════════════════════════════════════════════ */
export default function SootPrototype() {
  const [theme, setTheme] = useState("soot");
  const COLORS = THEMES[theme];
  const [view, setView] = useState("compose"); // compose | received
  const [styleId, setStyleId] = useState("trace");
  const [amps, setAmps] = useState(DEMO_AMPS);
  const [hasRecording, setHasRecording] = useState(false);
  const [recording, setRecording] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(DEMO_DUR);
  const [caption, setCaption] = useState("");
  const [note, setNote] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [weaving, setWeaving] = useState(false); // encoding voice → image
  const [decoding, setDecoding] = useState(false); // image → voice
  const [sharing, setSharing] = useState(false);
  const [sentImage, setSentImage] = useState(null); // dataURL of the card PNG
  const [trim, setTrim] = useState([0, 1]); // kept fraction of the recording

  const canvasRef = useRef(null);
  const rawAmpsRef = useRef([]);
  const chunksRef = useRef([]);
  const recRef = useRef(null);
  const recBlobRef = useRef(null);
  const recBufRef = useRef(null); // decoded AudioBuffer of the recording
  const composeCtxRef = useRef(null); // AudioContext playing the recording
  const rafRef = useRef(0);
  const recordingRef = useRef(false);
  const playTokenRef = useRef(0);
  const sentCanvasRef = useRef(null); // native-res card; decode reads its pixels
  const decodedRef = useRef(null); // cached {samples, sr} after first decode
  const pcmCtxRef = useRef(null); // AudioContext playing decoded voice
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (canvasRef.current)
      drawScene(canvasRef.current, amps, styleId, progress, hasRecording ? trim : [0, 1], COLORS);
  });

  useEffect(() => {
    const onResize = () => {
      if (canvasRef.current)
        drawScene(canvasRef.current, amps, styleId, progress, hasRecording ? trim : [0, 1], COLORS);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });

  useEffect(() => {
    if (view === "received" && progress >= 1) setRevealed(true);
  }, [view, progress]);

  // shared links land on ?d — open straight into the decode view
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("d")) setView("received");
  }, []);

  useEffect(() => {
    try {
      const t = localStorage.getItem("soot-theme");
      if (t && THEMES[t]) setTheme(t);
    } catch (e) {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("soot-theme", theme);
    } catch (e) {}
    document.body.style.background = COLORS.page;
  }, [theme, COLORS.page]);

  /* ---------- recording ---------- */
  const stopRecording = useCallback(() => {
    recordingRef.current = false;
    cancelAnimationFrame(rafRef.current);
    try {
      if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
    } catch (e) {}
    setRecording(false);
  }, []);

  const startRecording = async () => {
    playTokenRef.current++;
    stopComposeAudio();
    setPlaying(false);
    setNote("");
    setProgress(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      const ACtx = window.AudioContext || window.webkitAudioContext;
      const actx = new ACtx();
      const src = actx.createMediaStreamSource(stream);
      const analyser = actx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);

      const rec = new MediaRecorder(stream);
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType });
        recBlobRef.current = blob;
        recBufRef.current = null;
        stream.getTracks().forEach((t) => t.stop());
        actx.close();
        setTrim([0, 1]);
        setAmps(resample(rawAmpsRef.current, N));
        setHasRecording(true);
      };

      rawAmpsRef.current = [];
      recordingRef.current = true;
      setRecording(true);
      const data = new Uint8Array(analyser.fftSize);
      const t0 = performance.now();
      const poll = () => {
        if (!recordingRef.current) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        rawAmpsRef.current.push(Math.min(1, Math.sqrt(sum / data.length) * 3.4));
        const el = (performance.now() - t0) / 1000;
        setElapsed(el);
        setDuration(el);
        setAmps(resample(rawAmpsRef.current, N));
        if (el >= 15) stopRecording();
        else rafRef.current = requestAnimationFrame(poll);
      };
      rec.start();
      rafRef.current = requestAnimationFrame(poll);
    } catch (e) {
      setNote("Microphone isn't available here — the demo message still shows the full flow.");
    }
  };

  /* ---------- playback (compose view: the real audio) ---------- */
  const runProgressClock = (dur, token) => {
    const t0 = performance.now();
    const tick = () => {
      if (playTokenRef.current !== token) return;
      const p = Math.min(1, (performance.now() - t0) / (dur * 1000));
      setProgress(p);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const stopComposeAudio = () => {
    if (composeCtxRef.current) {
      try {
        composeCtxRef.current.close();
      } catch (e) {}
      composeCtxRef.current = null;
    }
  };

  const playRecording = async () => {
    const token = ++playTokenRef.current;
    const ACtx = window.AudioContext || window.webkitAudioContext;
    if (!recBufRef.current) {
      try {
        const dctx = new ACtx();
        recBufRef.current = await dctx.decodeAudioData(await recBlobRef.current.arrayBuffer());
        dctx.close();
      } catch (e) {
        setNote("Couldn't play the recording in this environment.");
        return;
      }
      if (playTokenRef.current !== token) return;
    }
    const buf = recBufRef.current;
    const t0 = trim[0] * buf.duration;
    const dur = Math.max(0.05, (trim[1] - trim[0]) * buf.duration);
    stopComposeAudio();
    try {
      const actx = new ACtx();
      composeCtxRef.current = actx;
      const src = actx.createBufferSource();
      src.buffer = buf;
      src.connect(actx.destination);
      src.start(0, t0, dur);
      src.onended = () => {
        if (composeCtxRef.current === actx) {
          composeCtxRef.current = null;
          try {
            actx.close();
          } catch (e) {}
        }
      };
    } catch (e) {
      setNote("Couldn't play the recording in this environment.");
      return;
    }
    setPlaying(true);
    setProgress(trim[0]);
    // sweep the reveal across the kept region only
    const start = performance.now();
    const tick = () => {
      if (playTokenRef.current !== token) return;
      const p = Math.min(1, (performance.now() - start) / (dur * 1000));
      setProgress(trim[0] + p * (trim[1] - trim[0]));
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const playDemo = () => {
    const token = ++playTokenRef.current;
    setPlaying(true);
    setProgress(0);
    try {
      const ACtx = window.AudioContext || window.webkitAudioContext;
      const actx = new ACtx();
      const len = Math.floor(actx.sampleRate * DEMO_DUR);
      const buf = actx.createBuffer(1, len, actx.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
      const src = actx.createBufferSource();
      src.buffer = buf;
      const band = actx.createBiquadFilter();
      band.type = "bandpass";
      band.Q.value = 1.4;
      const gain = actx.createGain();
      const now = actx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      band.frequency.setValueAtTime(280, now);
      for (let i = 0; i < DEMO_AMPS.length; i += 3) {
        const t = now + (i / DEMO_AMPS.length) * DEMO_DUR;
        gain.gain.linearRampToValueAtTime(0.0001 + DEMO_AMPS[i] * 0.4, t);
        band.frequency.linearRampToValueAtTime(280 + DEMO_AMPS[i] * 360, t);
      }
      gain.gain.linearRampToValueAtTime(0.0001, now + DEMO_DUR);
      src.connect(band);
      band.connect(gain);
      gain.connect(actx.destination);
      src.start(now);
      src.stop(now + DEMO_DUR + 0.05);
      src.onended = () => actx.close();
    } catch (e) {}
    setDuration(DEMO_DUR);
    runProgressClock(DEMO_DUR, token);
  };

  const handlePlay = () => {
    if (playing || recording) return;
    if (hasRecording && recBlobRef.current) playRecording();
    else playDemo();
  };

  const resetToDemo = () => {
    playTokenRef.current++;
    stopComposeAudio();
    setPlaying(false);
    setHasRecording(false);
    recBlobRef.current = null;
    recBufRef.current = null;
    setTrim([0, 1]);
    setAmps(DEMO_AMPS);
    setDuration(DEMO_DUR);
    setProgress(0);
    setElapsed(0);
  };

  /* ---------- trim handles ---------- */
  const TRIM_GAP = 0.04;
  const trimActive = hasRecording && (trim[0] > 0 || trim[1] < 1);
  const trimmedDur = (trim[1] - trim[0]) * duration;

  const onTrimDown = (idx) => (e) => {
    e.preventDefault();
    const handle = e.currentTarget;
    const rect = handle.parentElement.getBoundingClientRect();
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const t = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      setTrim((prev) =>
        idx === 0
          ? [Math.min(t, prev[1] - TRIM_GAP), prev[1]]
          : [prev[0], Math.max(t, prev[0] + TRIM_GAP)]
      );
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  const onTrimKey = (idx) => (e) => {
    let d = 0;
    const step = e.shiftKey ? 0.1 : 0.01;
    if (e.key === "ArrowLeft") d = -step;
    else if (e.key === "ArrowRight") d = step;
    else return;
    e.preventDefault();
    setTrim((prev) => {
      const t = Math.max(0, Math.min(1, prev[idx] + d));
      return idx === 0
        ? [Math.min(t, prev[1] - TRIM_GAP), prev[1]]
        : [prev[0], Math.max(t, prev[0] + TRIM_GAP)];
    });
  };

  /* ---------- weave: voice → image ---------- */
  const getSamples = async () => {
    if (hasRecording && recBlobRef.current) {
      const s = await blobToSamples(recBlobRef.current);
      return s.subarray(Math.floor(trim[0] * s.length), Math.ceil(trim[1] * s.length));
    }
    return makeDemoVoice(DEMO_AMPS, DEMO_DUR);
  };

  const buildCard = async () => {
    const samples = await getSamples();
    const sound = encodeVoice(samples);
    return renderCard({
      amps,
      styleId,
      caption,
      durationSec: hasRecording ? trimmedDur : duration,
      dateStr,
      sound,
      palette: COLORS,
    });
  };

  const stopPcm = () => {
    if (pcmCtxRef.current) {
      try {
        pcmCtxRef.current.close();
      } catch (e) {}
      pcmCtxRef.current = null;
    }
  };

  const sendIt = async () => {
    if (weaving) return;
    playTokenRef.current++;
    stopComposeAudio();
    stopPcm();
    setPlaying(false);
    setProgress(0);
    setNote("");
    setWeaving(true);
    try {
      const c = await buildCard();
      sentCanvasRef.current = c;
      decodedRef.current = null;
      setSentImage(c.toDataURL("image/png"));
      setRevealed(false);
      setView("received");
    } catch (e) {
      setNote("Couldn't weave the voice into an image here.");
    }
    setWeaving(false);
  };

  /* ---------- receive: image → voice ---------- */
  const playReceived = async () => {
    if (playing || decoding || !sentCanvasRef.current) return;
    const token = ++playTokenRef.current;
    setNote("");
    if (!decodedRef.current) {
      setDecoding(true);
      // let the "developing…" hint paint before the heavy work
      await new Promise((r) => setTimeout(r, 40));
      try {
        const c = sentCanvasRef.current;
        const ctx = c.getContext("2d", { willReadFrequently: true });
        decodedRef.current = decodeImage(ctx.getImageData(0, 0, c.width, c.height));
      } catch (e) {
        setDecoding(false);
        setNote("This image doesn't seem to carry a voice.");
        return;
      }
      setDecoding(false);
    }

    const { samples, sr } = decodedRef.current;
    stopPcm();
    try {
      const ACtx = window.AudioContext || window.webkitAudioContext;
      const actx = new ACtx();
      pcmCtxRef.current = actx;
      let buf;
      try {
        buf = actx.createBuffer(1, samples.length, sr);
        buf.copyToChannel(samples, 0);
      } catch (e) {
        const rs = resampleLinear(samples, sr, actx.sampleRate);
        buf = actx.createBuffer(1, rs.length, actx.sampleRate);
        buf.copyToChannel(rs, 0);
      }
      const src = actx.createBufferSource();
      src.buffer = buf;
      src.connect(actx.destination);
      src.start();
      src.onended = () => {
        if (pcmCtxRef.current === actx) {
          pcmCtxRef.current = null;
          try {
            actx.close();
          } catch (e) {}
        }
      };
    } catch (e) {
      setNote("Couldn't play audio in this environment.");
      return;
    }
    setPlaying(true);
    setProgress(0);
    runProgressClock(samples.length / sr, token);
  };

  /* ---------- import a soot image ---------- */
  const onImportFile = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d").drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      playTokenRef.current++;
      stopPcm();
      sentCanvasRef.current = c;
      decodedRef.current = null;
      setSentImage(c.toDataURL("image/png"));
      setNote("");
      setPlaying(false);
      setProgress(0);
      setRevealed(false);
      setView("received");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setNote("Couldn't read that image.");
    };
    img.src = url;
  };

  /* ---------- navigation ---------- */
  const backToCompose = () => {
    playTokenRef.current++;
    stopComposeAudio();
    stopPcm();
    setPlaying(false);
    setProgress(0);
    setView("compose");
  };

  const replyWithVoice = () => {
    stopPcm();
    resetToDemo();
    setCaption("");
    setView("compose");
  };

  // Computed in an effect so server-rendered HTML matches the client on hydration.
  const [dateStr, setDateStr] = useState("");
  useEffect(() => {
    setDateStr(
      new Date()
        .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
        .toLowerCase()
    );
  }, []);

  /* ---------- PNG download ---------- */
  const downloadCanvas = (c) => {
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = "soot-message.png";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  /* ---------- share: PNG + link into the system share sheet ---------- */
  const shareIt = async () => {
    if (sharing) return;
    setSharing(true);
    setNote("");
    try {
      const c =
        view === "received" && sentCanvasRef.current
          ? sentCanvasRef.current
          : await buildCard();
      const blob = await new Promise((res, rej) =>
        c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png")
      );
      const file = new File([blob], "soot-message.png", { type: "image/png" });
      const link = `${window.location.origin}/?d`;
      const text = `a voice hidden in a picture — save the image, then listen at ${link}`;
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text });
      } else if (navigator.share) {
        // no file sharing here — share the link, hand them the image to attach
        downloadCanvas(c);
        await navigator.share({ text, url: link });
      } else {
        downloadCanvas(c);
        try {
          await navigator.clipboard.writeText(text);
          setNote("Image downloaded and message copied — paste it in your text and attach the image.");
        } catch (err) {
          setNote("Image downloaded — text it to someone with a link to this site.");
        }
      }
    } catch (e) {
      if (e?.name !== "AbortError") {
        setNote("Couldn't open sharing here — use save the image and attach it yourself.");
      }
    }
    setSharing(false);
  };

  const exportCard = async () => {
    if (exporting) return;
    setExporting(true);
    setNote("");
    try {
      const c =
        view === "received" && sentCanvasRef.current
          ? sentCanvasRef.current
          : await buildCard();
      downloadCanvas(c);
    } catch (e) {
      setNote("Couldn't save the image in this environment.");
    }
    setExporting(false);
  };

  /* ---------- styles ---------- */
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Hanken+Grotesk:wght@400;500;600&family=Space+Mono&display=swap');
    .soot-root { min-height: 100vh; background:${COLORS.page}; color:${COLORS.ivory};
      font-family:'Hanken Grotesk',sans-serif; display:flex; flex-direction:column; align-items:center;
      padding:28px 18px 48px; position:relative; }
    .soot-root::before { content:''; position:fixed; inset:0; background-image:${GRAIN};
      opacity:0.05; pointer-events:none; mix-blend-mode:overlay; }
    .soot-wrap { width:100%; max-width:420px; }
    .soot-mark { font-family:'Instrument Serif',serif; font-style:italic; font-size:30px; }
    .soot-tag { color:${COLORS.textDim}; font-size:13px; margin-top:2px; letter-spacing:0.04em; }
    .soot-themes { display:flex; gap:8px; padding-top:8px; }
    .soot-swatch { width:22px; height:22px; border-radius:7px; border:1.5px solid; cursor:pointer; padding:0; }
    .soot-swatch[aria-pressed="true"] { transform:scale(1.12); }
    .soot-swatch:focus-visible { outline:2px solid ${COLORS.ember}; outline-offset:2px; }
    .soot-eyebrow { font-family:'Space Mono',monospace; font-size:11px; letter-spacing:0.22em;
      text-transform:uppercase; color:${COLORS.textDim}; text-align:center; }
    .soot-card { margin-top:22px; background:${COLORS.card}; border:1px solid ${COLORS.cardEdge};
      border-radius:18px; padding:26px 18px 18px; position:relative; overflow:hidden;
      box-shadow: inset 0 1px 0 rgba(244,236,220,0.04), 0 18px 40px rgba(0,0,0,0.45);
      transition: box-shadow .4s; }
    .soot-card.glow { box-shadow: inset 0 1px 0 rgba(244,236,220,0.04),
      0 18px 50px rgba(0,0,0,0.5), 0 0 60px rgba(232,163,61,0.12); }
    .soot-card::before { content:''; position:absolute; inset:0; background-image:${GRAIN};
      opacity:0.07; pointer-events:none; }
    @media (prefers-reduced-motion: no-preference) {
      .soot-card.arrive { animation: sootArrive .7s cubic-bezier(.2,.8,.3,1) both; }
      @keyframes sootArrive { from { opacity:0; transform: translateY(26px) scale(.97); }
        to { opacity:1; transform:none; } }
      .soot-hint { animation: sootHint 2s ease-in-out infinite; }
      @keyframes sootHint { 0%,100%{opacity:.55;} 50%{opacity:1;} }
    }
    .soot-canvas { width:100%; height:190px; display:block; }
    .soot-trimtrack { position:relative; height:28px; margin-top:8px; }
    .soot-trimtrack::before { content:''; position:absolute; left:0; right:0; top:50%;
      height:2px; margin-top:-1px; background:${COLORS.cardEdge}; border-radius:2px; }
    .soot-trimkeep { position:absolute; top:50%; height:2px; margin-top:-1px;
      background:${COLORS.ember}; opacity:0.55; border-radius:2px; pointer-events:none; }
    .soot-trimhandle { position:absolute; top:2px; bottom:2px; width:20px; margin-left:-10px;
      cursor:ew-resize; touch-action:none; background:none; border:none; padding:0;
      display:flex; align-items:center; justify-content:center; }
    .soot-trimhandle::before { content:''; width:4px; height:100%; border-radius:4px;
      background:${COLORS.ember}; box-shadow:0 0 10px ${COLORS.emberSoft}; }
    .soot-trimhandle:focus-visible { outline:2px solid ${COLORS.ember}; outline-offset:2px; }
    .soot-cardimg { width:100%; display:block; }
    .soot-progressbar { position:absolute; left:0; bottom:0; height:2px; background:${COLORS.ember}; }
    .soot-caption { font-family:'Instrument Serif',serif; font-style:italic; font-size:19px;
      text-align:center; margin-top:14px; min-height:24px; color:${COLORS.ivory}; }
    .soot-meta { font-family:'Space Mono',monospace; font-size:11px; color:${COLORS.textDim};
      text-align:center; margin-top:6px; letter-spacing:0.06em; }
    .soot-hint { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
      font-family:'Space Mono',monospace; font-size:12px; letter-spacing:0.18em;
      text-transform:uppercase; color:${COLORS.ember}; background:rgba(19,15,11,0.55);
      backdrop-filter: blur(1px); }
    .soot-cardbtn { display:block; width:100%; background:none; border:none; padding:0;
      cursor:pointer; font:inherit; color:inherit; text-align:inherit; }
    .soot-chips { display:flex; gap:8px; justify-content:center; margin-top:20px; flex-wrap:wrap; }
    .soot-chip { background:transparent; border:1px solid ${COLORS.cardEdge}; color:${COLORS.textDim};
      border-radius:999px; padding:7px 16px; font-size:13px; font-weight:500; cursor:pointer;
      font-family:inherit; transition:color .15s,border-color .15s; }
    .soot-chip[aria-pressed="true"] { color:${COLORS.ivory}; border-color:${COLORS.ember}; }
    .soot-chip:focus-visible, .soot-btn:focus-visible, .soot-link:focus-visible,
    .soot-input:focus-visible, .soot-primary:focus-visible, .soot-cardbtn:focus-visible {
      outline:2px solid ${COLORS.ember}; outline-offset:2px; }
    .soot-controls { display:flex; flex-direction:column; align-items:center; gap:14px; margin-top:26px; }
    .soot-btn { width:74px; height:74px; border-radius:50%; border:none; cursor:pointer;
      display:flex; align-items:center; justify-content:center;
      background:${COLORS.ember}; color:#1B130A; transition:transform .12s; }
    .soot-btn:active { transform:scale(0.94); }
    .soot-btn.rec { background:#C8472E; }
    .soot-btn:disabled { opacity:0.45; cursor:default; }
    @media (prefers-reduced-motion: no-preference) {
      .soot-btn.rec { animation: sootPulse 1.4s ease-in-out infinite; }
      @keyframes sootPulse { 0%,100%{ box-shadow:0 0 0 0 rgba(200,71,46,0.45);} 50%{ box-shadow:0 0 0 14px rgba(200,71,46,0);} }
    }
    .soot-btnlabel { font-size:13px; color:${COLORS.textDim}; letter-spacing:0.04em; }
    .soot-row { display:flex; gap:22px; align-items:center; }
    .soot-link { background:none; border:none; color:${COLORS.textDim}; font-size:13px;
      cursor:pointer; font-family:inherit; text-decoration:underline; text-underline-offset:3px; }
    .soot-link:hover { color:${COLORS.ivory}; }
    .soot-link:disabled { opacity:.5; cursor:default; }
    .soot-primary { background:${COLORS.ember}; color:#1B130A; border:none; border-radius:999px;
      padding:13px 30px; font-size:15px; font-weight:600; font-family:inherit; cursor:pointer;
      transition: transform .12s; }
    .soot-primary:active { transform:scale(.97); }
    .soot-primary:disabled { opacity:.55; cursor:default; }
    .soot-input { margin-top:24px; width:100%; background:transparent; border:none;
      border-bottom:1px solid ${COLORS.cardEdge}; color:${COLORS.ivory}; text-align:center;
      font-family:'Instrument Serif',serif; font-style:italic; font-size:17px; padding:8px 4px; }
    .soot-input::placeholder { color:${COLORS.textDim}; opacity:0.7; }
    .soot-send { display:flex; flex-direction:column; align-items:center; gap:12px; margin-top:26px; }
    .soot-actions { display:flex; flex-direction:column; align-items:center; gap:12px; margin-top:26px; }
    .soot-fine { margin-top:10px; font-family:'Space Mono',monospace; font-size:11px;
      color:${COLORS.textDim}; text-align:center; letter-spacing:0.06em; line-height:1.7; }
    .soot-note { margin-top:14px; font-size:13px; color:#D08B6A; text-align:center; }
    .soot-back { margin-top:34px; text-align:center; }
  `;

  /* ════════ RECEIVED VIEW ════════ */
  if (view === "received") {
    return (
      <div className="soot-root">
        <style>{css}</style>
        <div className="soot-wrap">
          <div style={{ marginTop: 26 }}>
            <div className="soot-eyebrow">a sound-image for you</div>
          </div>

          {sentImage ? (
            <button
              className="soot-cardbtn"
              onClick={playReceived}
              aria-label={
                revealed ? "Play the message again" : "Tap to decode and listen to the message"
              }
            >
              <div className={`soot-card arrive ${playing ? "glow" : ""}`} style={{ padding: 0 }}>
                <img
                  className="soot-cardimg"
                  src={sentImage}
                  alt="A Soot card whose markings carry the voice message"
                />
                {playing && (
                  <div className="soot-progressbar" style={{ width: `${progress * 100}%` }} />
                )}
                {decoding && <div className="soot-hint">developing the voice…</div>}
                {!playing && !revealed && !decoding && (
                  <div className="soot-hint">tap to listen</div>
                )}
              </div>
            </button>
          ) : (
            <div className="soot-card arrive" style={{ textAlign: "center", padding: "44px 24px" }}>
              <div className="soot-eyebrow">someone sent you a talking picture</div>
              <div style={{ marginTop: 22 }}>
                <button className="soot-primary" onClick={() => fileInputRef.current?.click()}>
                  Choose the image
                </button>
              </div>
              <div className="soot-fine">
                save the picture from your message first,
                <br />
                then pick it here and it will speak
              </div>
            </div>
          )}

          {sentImage && (
            <div className="soot-fine">
              no audio file here — the voice is read back from the picture's marks
            </div>
          )}

          {sentImage && !revealed && !playing && !decoding && (
            <div className="soot-actions">
              <button className="soot-primary" onClick={shareIt} disabled={sharing}>
                {sharing ? "opening share…" : "Text it to someone"}
              </button>
            </div>
          )}

          {revealed && !playing && (
            <div className="soot-actions">
              <button className="soot-primary" onClick={replyWithVoice}>
                Reply with your voice
              </button>
              <div className="soot-row">
                <button className="soot-link" onClick={playReceived}>
                  play again
                </button>
                <button className="soot-link" onClick={shareIt} disabled={sharing}>
                  {sharing ? "sharing…" : "text it to someone"}
                </button>
                <button className="soot-link" onClick={exportCard} disabled={exporting}>
                  {exporting ? "saving…" : "save the image"}
                </button>
                <button className="soot-link" onClick={() => fileInputRef.current?.click()}>
                  decode another
                </button>
              </div>
            </div>
          )}

          {note && <div className="soot-note">{note}</div>}

          <div className="soot-back">
            <button className="soot-link" onClick={backToCompose}>
              ← back to compose (prototype)
            </button>
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/*"
          style={{ display: "none" }}
          onChange={onImportFile}
        />
      </div>
    );
  }

  /* ════════ COMPOSE VIEW ════════ */
  return (
    <div className="soot-root">
      <style>{css}</style>
      <div className="soot-wrap">
        <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <div className="soot-mark">Soot</div>
            <div className="soot-tag">paper that talks</div>
          </div>
          <div className="soot-themes" role="group" aria-label="Theme">
            {Object.entries(THEMES).map(([id, t]) => (
              <button
                key={id}
                className="soot-swatch"
                aria-pressed={theme === id}
                aria-label={`${t.label} theme`}
                title={t.label}
                style={{
                  background: `linear-gradient(135deg, ${t.page} 50%, ${t.ember} 50%)`,
                  borderColor: theme === id ? COLORS.ember : COLORS.cardEdge,
                }}
                onClick={() => setTheme(id)}
              />
            ))}
          </div>
        </header>

        <div className="soot-card">
          <canvas ref={canvasRef} className="soot-canvas" aria-label="Sound wave trace" />
          {hasRecording && !recording && (
            <div className="soot-trimtrack">
              <div
                className="soot-trimkeep"
                style={{ left: `${trim[0] * 100}%`, width: `${(trim[1] - trim[0]) * 100}%` }}
              />
              <div
                className="soot-trimhandle"
                style={{ left: `${trim[0] * 100}%` }}
                role="slider"
                tabIndex={0}
                aria-label="Trim start"
                aria-orientation="horizontal"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(trim[0] * 100)}
                onPointerDown={onTrimDown(0)}
                onKeyDown={onTrimKey(0)}
              />
              <div
                className="soot-trimhandle"
                style={{ left: `${trim[1] * 100}%` }}
                role="slider"
                tabIndex={0}
                aria-label="Trim end"
                aria-orientation="horizontal"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(trim[1] * 100)}
                onPointerDown={onTrimDown(1)}
                onKeyDown={onTrimKey(1)}
              />
            </div>
          )}
          <div className="soot-caption">{caption || " "}</div>
          <div className="soot-meta">
            {recording
              ? `recording ${fmt(elapsed)}`
              : hasRecording
                ? `${trimmedDur.toFixed(1)}s${trimActive ? ` of ${duration.toFixed(1)}s` : ""} · ${dateStr}`
                : `${fmt(duration)} · ${dateStr}`}
          </div>
        </div>

        <div className="soot-chips" role="group" aria-label="Waveform style">
          {STYLES.map((s) => (
            <button
              key={s.id}
              className="soot-chip"
              aria-pressed={styleId === s.id}
              onClick={() => setStyleId(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="soot-controls">
          {!recording ? (
            <>
              <div className="soot-row">
                <button
                  className="soot-btn"
                  onClick={handlePlay}
                  disabled={playing}
                  aria-label={hasRecording ? "Play recording" : "Play demo message"}
                >
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M8 5.5v13l11-6.5-11-6.5z" />
                  </svg>
                </button>
                <button
                  className="soot-btn"
                  style={{
                    background: "transparent",
                    border: `1.5px solid ${COLORS.ember}`,
                    color: COLORS.ember,
                  }}
                  onClick={startRecording}
                  disabled={playing}
                  aria-label="Record a message"
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <rect x="9" y="3" width="6" height="11" rx="3" />
                    <path d="M5 11a7 7 0 0 0 14 0h-2a5 5 0 0 1-10 0H5z" />
                    <rect x="11" y="18" width="2" height="3" />
                  </svg>
                </button>
              </div>
              <div className="soot-btnlabel">
                {hasRecording ? "play it back · or record again" : "play the demo · or record your own"}
              </div>
              {hasRecording && (
                <>
                  <div className="soot-fine" style={{ marginTop: 0 }}>
                    drag the amber bars under the trace to trim
                  </div>
                  <button className="soot-link" onClick={resetToDemo}>
                    start over with the demo
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <button className="soot-btn rec" onClick={stopRecording} aria-label="Stop recording">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
              <div className="soot-btnlabel">listening… tap to stop (15s max)</div>
            </>
          )}
        </div>

        <input
          className="soot-input"
          value={caption}
          maxLength={48}
          placeholder="add a caption — for maya, with love"
          onChange={(e) => setCaption(e.target.value)}
          aria-label="Caption for this message"
        />

        {!recording && (
          <div className="soot-send">
            <button className="soot-primary" onClick={sendIt} disabled={weaving}>
              {weaving ? "weaving the voice in…" : "Send it"}
            </button>
            <div className="soot-fine">
              the picture itself carries the voice — send the PNG,
              <br />
              and soot reads it back out loud
            </div>
            <div className="soot-row" style={{ flexWrap: "wrap", justifyContent: "center" }}>
              <button className="soot-link" onClick={shareIt} disabled={sharing}>
                {sharing ? "sharing…" : "text it to someone"}
              </button>
              <button className="soot-link" onClick={exportCard} disabled={exporting}>
                {exporting ? "saving…" : "save the sound-image"}
              </button>
              <button className="soot-link" onClick={() => fileInputRef.current?.click()}>
                got a soot image? decode it
              </button>
            </div>
          </div>
        )}

        {note && <div className="soot-note">{note}</div>}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/*"
        style={{ display: "none" }}
        onChange={onImportFile}
      />
    </div>
  );
}
