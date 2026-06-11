# Soot — paper talks

A voice is encoded into a picture (a visible spectrogram) and read back out
loud. No audio file ever travels; the image or QR code IS the recording.
Static Next.js app, deployed to Netlify (`netlify.toml`, publishes `out/`).

## Commands

- `npm run dev` — dev server on port 3001
- `npm run build` — static export to `out/`
- `npm test` — codec test suite (plain Node, no framework). Run after ANY
  change to `lib/sootVoiceCodec.js`.
- `npm start` — serve the built `out/` locally

## Checklist for every shipped change

1. Bump `version` in package.json (the footer stamp shows it; build date is
   automatic via next.config.mjs).
2. `npm test` && `npm run build` must both pass.
3. If you changed what card pixels MEAN (layout positions, hop, emphasis,
   quantization), bump `CODEC.VERSION` in lib/sootVoiceCodec.js — old images
   must be rejected, not garbled.
4. Same for the QR/link payload: bump `LINK.VERSION`.

## Architecture map

- `lib/sootVoiceCodec.js` — all DSP. Card codec (spectrogram pixels ↔ audio,
  Griffin-Lim) and link codec (mel + pitch vocoder in a URL fragment,
  harmonic resynthesis). Pure JS, no DOM except `blobToSamples`.
- `components/SootPrototype.jsx` — the app (create / created / decode views,
  recording, trim, share, card & voice-code rendering).
- `components/sootStamp.js` — the stamp and styled-QR renderers (canvas).
- `components/themes.js` — palettes + CSS-variable generation. Themes are CSS
  vars set pre-paint via inline script in `app/layout.js` (prevents flash).
- `components/AboutSoot.jsx` / `app/about/` — the story page + stamp downloads.
- `tests/codec.test.mjs` — the suite. Extend it when adding codec features.

## Invariants (do not break casually)

- The card's sound block (strips + header dots) is NEVER themed: bright marks
  on black backing, so any theme's PNG decodes for any recipient.
- `LAYOUT` positions are part of the image format. Moving them = version bump.
- Recording cap is 7.5s = exactly one strip row (users rejected two rows).
- Decode reads proportionally: uniformly scaled card copies must keep working.
- The `#v=` URL fragment never reaches the server — keep it that way; "no
  server holds your words" is a product promise.
- Downsampling must stay anti-aliased (`downsample`, not `resampleLinear`) —
  naive decimation folds sibilants into static.

## Capacity cheat-sheet

- Card: ~7.5s max (936 frames × hop 64 @ 8 kHz, one strip; format supports 2).
- QR voice: lean profile ~3s ≈ 900 chars URL (worst case; speech is smaller);
  absolute QR ceiling 2953 bytes. Pitch track costs ~1 byte/frame.
