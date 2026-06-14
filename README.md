# Sound Tools

A free, privacy-first suite of browser-based audio instruments. No backend, no accounts, no build step. All audio is processed locally and never leaves the device.

## What's inside

- **Decibel meter** — a real sound level meter with A-weighting (dB A) and flat Z-weighting (dB Z), Fast/Slow time response, min / avg (Leq) / max, and a per-device calibration offset saved in `localStorage`. The gauge, an oscilloscope, and a frequency spectrum are combined into one instrument that shares a single microphone.
- **Tone generator** — sine, square, triangle and sawtooth from 20 Hz to 20 kHz with click-free start/stop.
- **BPM tapper** — tap tempo with a rolling average, spacebar support, and auto-reset.
- **Decibel levels guide** + **About** — content pages for reference and trust (E-E-A-T) and for SEO.

## Why the old meter read 0.0 (and why this one doesn't)

Browsers enable `noiseSuppression`, `echoCancellation` and `autoGainControl` by default. In a quiet room those filters crush the ambient signal to near-silence, so a naive meter shows 0.0 dB. This build explicitly requests the mic with all three **off**, so it responds to real sound.

## Project structure

```
sound-tools/
├── index.html            decibel meter (the combined instrument)
├── tone-generator.html
├── bpm-tapper.html
├── decibel-levels.html   reference / SEO content
├── about.html            how it works, accuracy, privacy
├── css/style.css         shared design system
├── js/
│   ├── meter.js          the instrument engine (dB + scope + spectrum)
│   ├── tone.js
│   ├── bpm.js
│   └── site.js           nav, FAQ, footer year
├── robots.txt
└── sitemap.xml
```

## Deploy to Cloudflare Pages

1. Push this folder to a new GitHub repository.
2. In the Cloudflare dashboard go to **Workers & Pages → Create → Pages → Connect to Git**.
3. Pick the repository.
4. Build settings:
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** `/`
5. **Save and Deploy.** You'll get a free `*.pages.dev` URL with HTTPS — which the microphone needs to work.

To add your own domain, open the project's **Custom domains** tab; Cloudflare handles the certificate automatically.

## Before you go live

Find-and-replace `yourdomain.com` with your real domain across all files. It appears in:

- `<link rel="canonical">` and Open Graph URLs in every HTML page
- the JSON-LD `url` fields
- `robots.txt` and `sitemap.xml`

Optionally add an `og-image.png` (1200×630) to the root for nicer link previews.

## A note on accuracy

This is a reference estimate, not a certified measurement. Consumer microphones vary in sensitivity by 10 dB or more, so use the calibration offset against a meter you trust and treat readings as relative. For legal or occupational use, a calibrated Class 1 / Class 2 meter is required.

## License

MIT — use it freely.
