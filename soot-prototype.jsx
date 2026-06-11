import React, { useState, useRef, useEffect, useCallback } from "react";

/* ────────────────────────────────────────────────────────────
   SOOT — paper that talks
   Compose: record → style → caption.
   Send: flips to the recipient's view, where the card arrives
   quiet and tapping it "blooms" the trace to life with audio.
   Export: renders the card as a 1080×1350 PNG keepsake.
   ──────────────────────────────────────────────────────────── */

const N = 240;

const COLORS = {
  page: "#1E1813",
  card: "#130F0B",
  cardEdge: "#2A231B",
  ivory: "#F4ECDC",
  ivoryDim: "rgba(244,236,220,0.16)",
  ember: "#E8A33D",
  emberSoft: "rgba(232,163,61,0.35)",
  textDim: "#9C9183",
};

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

function drawScene(canvas, amps, styleId, progress) {
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
}

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";

function fmt(s) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

/* ════════════════════════════════════════════════════════════ */
export default function SootPrototype() {
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

  const canvasRef = useRef(null);
  const rawAmpsRef = useRef([]);
  const chunksRef = useRef([]);
  const recRef = useRef(null);
  const audioRef = useRef(null);
  const recUrlRef = useRef(null);
  const rafRef = useRef(0);
  const recordingRef = useRef(false);
  const playTokenRef = useRef(0);

  useEffect(() => {
    if (canvasRef.current) drawScene(canvasRef.current, amps, styleId, progress);
  });

  useEffect(() => {
    const onResize = () => {
      if (canvasRef.current) drawScene(canvasRef.current, amps, styleId, progress);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });

  useEffect(() => {
    if (view === "received" && progress >= 1) setRevealed(true);
  }, [view, progress]);

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
    setNote("");
    setProgress(0);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
        if (recUrlRef.current) URL.revokeObjectURL(recUrlRef.current);
        recUrlRef.current = URL.createObjectURL(blob);
        stream.getTracks().forEach((t) => t.stop());
        actx.close();
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
        if (el >= 30) stopRecording();
        else rafRef.current = requestAnimationFrame(poll);
      };
      rec.start();
      rafRef.current = requestAnimationFrame(poll);
    } catch (e) {
      setNote("Microphone isn't available here — the demo message still shows the full flow.");
    }
  };

  /* ---------- playback ---------- */
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

  const playRecording = () => {
    const token = ++playTokenRef.current;
    const audio = new Audio(recUrlRef.current);
    audioRef.current = audio;
    setPlaying(true);
    setProgress(0);
    audio.onended = () => {
      if (playTokenRef.current === token) {
        setProgress(1);
        setPlaying(false);
      }
    };
    audio
      .play()
      .then(() => {
        const tick = () => {
          if (playTokenRef.current !== token) return;
          if (audio.duration && isFinite(audio.duration)) {
            setProgress(Math.min(1, audio.currentTime / audio.duration));
          }
          if (!audio.ended && !audio.paused) rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      })
      .catch(() => {
        runProgressClock(duration || 3, token);
      });
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
    if (hasRecording && recUrlRef.current) playRecording();
    else playDemo();
  };

  const resetToDemo = () => {
    playTokenRef.current++;
    setPlaying(false);
    setHasRecording(false);
    setAmps(DEMO_AMPS);
    setDuration(DEMO_DUR);
    setProgress(0);
    setElapsed(0);
  };

  /* ---------- send / receive ---------- */
  const sendIt = () => {
    playTokenRef.current++;
    if (audioRef.current) audioRef.current.pause();
    setPlaying(false);
    setProgress(0);
    setRevealed(false);
    setView("received");
  };

  const backToCompose = () => {
    playTokenRef.current++;
    if (audioRef.current) audioRef.current.pause();
    setPlaying(false);
    setProgress(0);
    setView("compose");
  };

  const replyWithVoice = () => {
    resetToDemo();
    setCaption("");
    setView("compose");
  };

  const dateStr = new Date()
    .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    .toLowerCase();

  /* ---------- PNG export ---------- */
  const exportPng = async () => {
    if (exporting) return;
    setExporting(true);
    setNote("");
    try {
      try {
        await Promise.all([
          document.fonts.load("italic 60px 'Instrument Serif'"),
          document.fonts.load("28px 'Space Mono'"),
        ]);
      } catch (e) {}

      const W = 1080,
        H = 1350;
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const ctx = c.getContext("2d");

      // smoked card background
      ctx.fillStyle = COLORS.card;
      ctx.fillRect(0, 0, W, H);
      const g = ctx.createRadialGradient(W / 2, H * 0.4, 80, W / 2, H * 0.4, W);
      g.addColorStop(0, "rgba(244,236,220,0.05)");
      g.addColorStop(1, "rgba(0,0,0,0.4)");
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

      // waveform, fully revealed
      ctx.save();
      ctx.translate(110, H * 0.16);
      const ww = W - 220,
        wh = H * 0.42;
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
        ctx.font = "italic 60px 'Instrument Serif', Georgia, serif";
        ctx.fillText(caption, W / 2, H * 0.72);
      }

      // meta
      ctx.fillStyle = COLORS.textDim;
      ctx.font = "28px 'Space Mono', monospace";
      ctx.fillText(fmt(duration) + " \u00B7 " + dateStr, W / 2, H * (caption ? 0.775 : 0.73));

      // wordmark
      ctx.fillStyle = "rgba(244,236,220,0.4)";
      ctx.font = "italic 42px 'Instrument Serif', Georgia, serif";
      ctx.fillText("Soot", W / 2, H - 80);

      const url = c.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = "soot-message.png";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
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
    .soot-eyebrow { font-family:'Space Mono',monospace; font-size:11px; letter-spacing:0.22em;
      text-transform:uppercase; color:${COLORS.textDim}; text-align:center; }
    .soot-for { font-family:'Instrument Serif',serif; font-style:italic; font-size:26px;
      text-align:center; margin-top:8px; }
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
    .soot-input { margin-top:24px; width:100%; background:transparent; border:none;
      border-bottom:1px solid ${COLORS.cardEdge}; color:${COLORS.ivory}; text-align:center;
      font-family:'Instrument Serif',serif; font-style:italic; font-size:17px; padding:8px 4px; }
    .soot-input::placeholder { color:${COLORS.textDim}; opacity:0.7; }
    .soot-send { display:flex; flex-direction:column; align-items:center; gap:12px; margin-top:26px; }
    .soot-actions { display:flex; flex-direction:column; align-items:center; gap:12px; margin-top:26px; }
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
            <div className="soot-eyebrow">a message for you</div>
            {caption ? <div className="soot-for">{caption}</div> : null}
          </div>

          <button
            className="soot-cardbtn"
            onClick={() => !playing && handlePlay()}
            aria-label={revealed ? "Play the message again" : "Tap to listen to the message"}
          >
            <div className={`soot-card arrive ${playing ? "glow" : ""}`}>
              <canvas ref={canvasRef} className="soot-canvas" aria-hidden="true" />
              <div className="soot-meta">{fmt(duration)} · {dateStr}</div>
              {!playing && !revealed && <div className="soot-hint">tap to listen</div>}
            </div>
          </button>

          {revealed && !playing && (
            <div className="soot-actions">
              <button className="soot-primary" onClick={replyWithVoice}>
                Reply with your voice
              </button>
              <div className="soot-row">
                <button className="soot-link" onClick={handlePlay}>
                  play again
                </button>
                <button className="soot-link" onClick={exportPng} disabled={exporting}>
                  {exporting ? "saving\u2026" : "save as image"}
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
      </div>
    );
  }

  /* ════════ COMPOSE VIEW ════════ */
  return (
    <div className="soot-root">
      <style>{css}</style>
      <div className="soot-wrap">
        <header>
          <div className="soot-mark">Soot</div>
          <div className="soot-tag">paper that talks</div>
        </header>

        <div className="soot-card">
          <canvas ref={canvasRef} className="soot-canvas" aria-label="Sound wave trace" />
          <div className="soot-caption">{caption || "\u00A0"}</div>
          <div className="soot-meta">
            {recording ? `recording ${fmt(elapsed)}` : `${fmt(duration)} \u00B7 ${dateStr}`}
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
                {hasRecording ? "play it back \u00B7 or record again" : "play the demo \u00B7 or record your own"}
              </div>
              {hasRecording && (
                <button className="soot-link" onClick={resetToDemo}>
                  start over with the demo
                </button>
              )}
            </>
          ) : (
            <>
              <button className="soot-btn rec" onClick={stopRecording} aria-label="Stop recording">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </button>
              <div className="soot-btnlabel">listening… tap to stop (30s max)</div>
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
            <button className="soot-primary" onClick={sendIt}>
              Send it
            </button>
            <button className="soot-link" onClick={exportPng} disabled={exporting}>
              {exporting ? "saving\u2026" : "save as image"}
            </button>
          </div>
        )}

        {note && <div className="soot-note">{note}</div>}
      </div>
    </div>
  );
}
