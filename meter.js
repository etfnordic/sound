/* ============================================================
   SOUND LEVEL METER — combined instrument
   One microphone feeds three views: a dB(A/Z) level meter,
   an oscilloscope, and a frequency spectrum.
   ============================================================ */

(function () {
  "use strict";

  // ---- elements ----
  const el = (id) => document.getElementById(id);
  const startBtn   = el("startBtn");
  const resetBtn   = el("resetBtn");
  const notice     = el("micNotice");
  const dot        = el("statusDot");
  const statusTxt  = el("statusText");

  const valEl   = el("dbVal");
  const tagEl   = el("dbTag");
  const minEl   = el("dbMin");
  const avgEl   = el("dbAvg");
  const maxEl   = el("dbMax");

  const weightSeg   = el("weightSeg");
  const responseSeg = el("responseSeg");
  const scopeSeg    = el("scopeSeg");

  const needle  = el("needle");
  const arcFill = el("arcFill");

  const scopeCanvas = el("scopeCanvas");
  const peakHzEl = el("peakHz");
  const peakNoteEl = el("peakNote");
  const bandLowEl = el("bandLow");
  const bandMidEl = el("bandMid");
  const bandHighEl = el("bandHigh");

  const calibInput = el("calibInput");
  const calibSave  = el("calibSave");
  const calibVal   = el("calibVal");

  if (!startBtn || !scopeCanvas) return; // not on this page

  // ---- audio state ----
  let ctx = null, analyser = null, stream = null, source = null;
  let raf = null, running = false;
  let timeBuf = null, freqBuf = null, freqDb = null;
  let aWeights = null; // per-bin A-weighting gain (linear)

  // ---- meter state ----
  let weighting = "A";          // "A" or "Z"
  let response  = "fast";       // "fast" (125ms) or "slow" (1000ms)
  let scopeMode = "spectrum";   // "spectrum" or "wave"
  let smoothPower = 0;          // running, time-weighted linear power
  let lastT = 0;
  let dispDb = 0;

  let mMin = Infinity, mMax = -Infinity, energySum = 0, energyCount = 0;
  let calibration = 0;          // dB offset, persisted

  // gauge geometry (must match the SVG markup)
  const CX = 130, CY = 130, R = 104;
  const A_START = 240, A_SWEEP = 240;       // bottom-opening speedometer, 0..120 dB
  const DB_MAX = 120;

  // ---- calibration persistence ----
  try {
    const saved = localStorage.getItem("slm_calibration");
    if (saved !== null) calibration = parseFloat(saved) || 0;
  } catch (e) { /* private mode */ }
  if (calibVal) calibVal.textContent = (calibration >= 0 ? "+" : "") + calibration.toFixed(1) + " dB";
  if (calibInput) calibInput.value = calibration;

  // ============================================================
  // A-weighting transfer function (IEC 61672), gain in dB
  // ============================================================
  function aWeightDb(f) {
    if (f <= 0) return -120;
    const f2 = f * f;
    const num = Math.pow(12194, 2) * Math.pow(f, 4);
    const den = (f2 + Math.pow(20.6, 2)) *
                Math.sqrt((f2 + Math.pow(107.7, 2)) * (f2 + Math.pow(737.9, 2))) *
                (f2 + Math.pow(12194, 2));
    return 20 * Math.log10(num / den) + 2.0;
  }

  function buildWeights() {
    const bins = analyser.frequencyBinCount;
    const binHz = ctx.sampleRate / analyser.fftSize;
    aWeights = new Float32Array(bins);
    for (let i = 0; i < bins; i++) {
      aWeights[i] = Math.pow(10, aWeightDb(i * binHz) / 10); // linear power gain
    }
  }

  // ============================================================
  // mic + context
  // ============================================================
  async function init() {
    try {
      // Critical: turn OFF browser processing or a quiet room reads 0.0
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        video: false
      });
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") await ctx.resume(); // iOS needs this
      source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.4;
      source.connect(analyser);

      timeBuf = new Float32Array(analyser.fftSize);
      freqBuf = new Uint8Array(analyser.frequencyBinCount);
      freqDb  = new Float32Array(analyser.frequencyBinCount);
      buildWeights();
      notice.classList.remove("is-on");
      return true;
    } catch (err) {
      notice.classList.add("is-on", "notice--err");
      notice.innerHTML = "<span>Microphone access was blocked. Check the camera/mic icon in your address bar, allow access, and try again. The page must be served over HTTPS.</span>";
      return false;
    }
  }

  // ============================================================
  // level calculation (frequency-domain, weighted)
  // ============================================================
  const BASE_OFFSET = 100; // maps full-scale FFT to a sensible SPL range

  function computeLevel() {
    analyser.getFloatFrequencyData(freqDb); // dBFS per bin, ~ -140..0
    let power = 0;
    const n = freqDb.length;
    for (let i = 1; i < n; i++) {
      const lin = Math.pow(10, freqDb[i] / 10); // bin power (linear)
      power += (weighting === "A") ? lin * aWeights[i] : lin;
    }
    if (power <= 0) return 0;
    let db = 10 * Math.log10(power) + BASE_OFFSET + calibration;
    return Math.max(0, Math.min(140, db));
  }

  // ============================================================
  // labelling
  // ============================================================
  function band(db) {
    if (db < 30)  return { t: "Near silence", c: getCss("--sig-quiet") };
    if (db < 50)  return { t: "Quiet",        c: getCss("--sig-quiet") };
    if (db < 65)  return { t: "Moderate",     c: getCss("--sig-low") };
    if (db < 80)  return { t: "Loud",         c: getCss("--sig-moderate") };
    if (db < 95)  return { t: "Very loud",    c: getCss("--sig-loud") };
    if (db < 110) return { t: "Harmful",      c: getCss("--sig-harm") };
    return { t: "Dangerous", c: getCss("--sig-danger") };
  }
  const cssCache = {};
  function getCss(name) {
    if (!cssCache[name]) cssCache[name] = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return cssCache[name];
  }

  // ============================================================
  // gauge rendering
  // ============================================================
  function polar(cx, cy, r, deg) {
    const a = (deg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }
  // sampled arc path — avoids SVG A-command flag pitfalls
  function arcPath(cx, cy, r, startDeg, sweepDeg) {
    let d = "";
    const steps = 120;
    for (let i = 0; i <= steps; i++) {
      const p = polar(cx, cy, r, startDeg + (sweepDeg * i) / steps);
      d += (i === 0 ? "M " : "L ") + p.x.toFixed(2) + " " + p.y.toFixed(2) + " ";
    }
    return d.trim();
  }

  // build static track + ticks once
  function buildGauge() {
    const track = el("arcTrack");
    track.setAttribute("d", arcPath(CX, CY, R, A_START, A_SWEEP));
    arcFill.setAttribute("d", arcPath(CX, CY, R, A_START, A_SWEEP));
    const len = arcFill.getTotalLength();
    arcFill.style.strokeDasharray = len;
    arcFill.style.strokeDashoffset = len;
    arcFill._len = len;

    // tick labels 0..120
    const g = el("gaugeTicks");
    [0, 30, 60, 90, 120].forEach((v) => {
      const deg = A_START + (v / DB_MAX) * A_SWEEP;
      const p = polar(CX, CY, R - 22, deg);
      const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
      txt.setAttribute("x", p.x.toFixed(1));
      txt.setAttribute("y", (p.y + 4).toFixed(1));
      txt.setAttribute("text-anchor", "middle");
      txt.setAttribute("font-size", "11");
      txt.setAttribute("fill", "#8C8C95");
      txt.textContent = v;
      g.appendChild(txt);
    });
  }

  function renderGauge(db) {
    const frac = Math.min(1, db / DB_MAX);
    const deg = A_START + frac * A_SWEEP;
    needle.setAttribute("transform", `rotate(${deg} ${CX} ${CY})`);
    arcFill.style.strokeDashoffset = arcFill._len * (1 - frac);
  }

  // ============================================================
  // scope (oscilloscope + spectrum) rendering
  // ============================================================
  const NOTE = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  function hzToNote(f) {
    if (f <= 0) return "—";
    const n = Math.round(12 * Math.log2(f / 440) + 69);
    return NOTE[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
  }

  function drawScope() {
    const c = scopeCanvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth, h = c.clientHeight;
    if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const ink = getCss("--ink");
    const line = getCss("--line-2");

    if (scopeMode === "wave") {
      analyser.getFloatTimeDomainData(timeBuf);
      // centre line
      g.strokeStyle = line; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, h/2); g.lineTo(w, h/2); g.stroke();
      // waveform
      g.strokeStyle = ink; g.lineWidth = 1.6; g.beginPath();
      const step = Math.ceil(timeBuf.length / w);
      for (let x = 0, i = 0; x < w; x++, i += step) {
        const y = (0.5 - timeBuf[i] * 0.9) * h;
        x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    } else {
      analyser.getByteFrequencyData(freqBuf);
      const binHz = ctx.sampleRate / analyser.fftSize;
      const minF = 20, maxF = 20000;
      const logMin = Math.log10(minF), logMax = Math.log10(maxF);
      let peakIdx = 0, peakVal = 0;
      let lo = 0, mid = 0, hi = 0, loN = 0, midN = 0, hiN = 0;

      // bars on a log frequency axis
      const cols = Math.min(w, 200);
      g.fillStyle = ink;
      for (let cIdx = 0; cIdx < cols; cIdx++) {
        const f0 = Math.pow(10, logMin + (cIdx / cols) * (logMax - logMin));
        const f1 = Math.pow(10, logMin + ((cIdx + 1) / cols) * (logMax - logMin));
        let i0 = Math.max(1, Math.floor(f0 / binHz));
        let i1 = Math.max(i0 + 1, Math.floor(f1 / binHz));
        let m = 0;
        for (let i = i0; i < i1 && i < freqBuf.length; i++) if (freqBuf[i] > m) m = freqBuf[i];
        const v = m / 255;
        const bw = w / cols;
        const bh = v * (h - 16);
        g.fillRect(cIdx * bw, h - 14 - bh, Math.max(1, bw - 0.6), bh);
      }

      // analysis over real bins
      for (let i = 1; i < freqBuf.length; i++) {
        if (freqBuf[i] > peakVal) { peakVal = freqBuf[i]; peakIdx = i; }
        const f = i * binHz;
        if (f < 250) { lo += freqBuf[i]; loN++; }
        else if (f < 4000) { mid += freqBuf[i]; midN++; }
        else { hi += freqBuf[i]; hiN++; }
      }

      // axis labels
      g.fillStyle = getCss("--ink-3"); g.font = "10px 'JetBrains Mono', monospace";
      [100, 1000, 10000].forEach((f) => {
        const x = ((Math.log10(f) - logMin) / (logMax - logMin)) * w;
        const label = f >= 1000 ? (f/1000) + "k" : f + "";
        g.fillText(label, x + 3, h - 3);
        g.strokeStyle = line; g.globalAlpha = .5;
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h - 16); g.stroke(); g.globalAlpha = 1;
      });

      // readouts
      const pf = Math.round(peakIdx * binHz);
      peakHzEl.textContent = peakVal > 8 ? (pf >= 1000 ? (pf/1000).toFixed(1) + " kHz" : pf + " Hz") : "—";
      peakNoteEl.textContent = peakVal > 8 ? hzToNote(pf) : "—";
      bandLowEl.textContent  = loN  ? Math.round(lo/loN/255*100) + "%" : "—";
      bandMidEl.textContent  = midN ? Math.round(mid/midN/255*100) + "%" : "—";
      bandHighEl.textContent = hiN  ? Math.round(hi/hiN/255*100) + "%" : "—";
    }
  }

  // ============================================================
  // main loop
  // ============================================================
  function loop(t) {
    raf = requestAnimationFrame(loop);
    const dt = lastT ? (t - lastT) / 1000 : 0.016;
    lastT = t;

    const instDb = computeLevel();
    const instPower = Math.pow(10, instDb / 10);

    // time-weighted exponential smoothing in the power domain
    const tau = response === "fast" ? 0.125 : 1.0;
    const a = 1 - Math.exp(-dt / tau);
    smoothPower = smoothPower + a * (instPower - smoothPower);
    dispDb = 10 * Math.log10(Math.max(smoothPower, 1e-9));
    dispDb = Math.max(0, Math.min(140, dispDb));

    // stats (Avg as energy-equivalent Leq)
    if (dispDb < mMin) mMin = dispDb;
    if (dispDb > mMax) mMax = dispDb;
    energySum += instPower; energyCount++;
    const leq = 10 * Math.log10(energySum / energyCount);

    // paint readout
    valEl.textContent = dispDb.toFixed(1);
    minEl.textContent = mMin === Infinity ? "—" : mMin.toFixed(1);
    maxEl.textContent = mMax === -Infinity ? "—" : mMax.toFixed(1);
    avgEl.textContent = energyCount ? leq.toFixed(1) : "—";

    const b = band(dispDb);
    valEl.style.color = b.c;
    tagEl.textContent = b.t;
    tagEl.style.background = b.c + "1F";
    tagEl.style.color = b.c;

    renderGauge(dispDb);
    drawScope();
  }

  // ============================================================
  // controls
  // ============================================================
  async function start() {
    if (running) { stop(); return; }
    startBtn.disabled = true;
    if (!ctx) { const ok = await init(); if (!ok) { startBtn.disabled = false; return; } }
    if (ctx.state === "suspended") await ctx.resume();
    running = true; lastT = 0; smoothPower = Math.pow(10, 30/10);
    startBtn.disabled = false;
    startBtn.textContent = "Stop";
    startBtn.classList.remove("btn--primary"); startBtn.classList.add("btn--stop");
    dot.classList.add("is-live"); statusTxt.textContent = "Measuring";
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
    startBtn.textContent = "Start measuring";
    startBtn.classList.add("btn--primary"); startBtn.classList.remove("btn--stop");
    dot.classList.remove("is-live"); statusTxt.textContent = "Stopped";
  }

  function resetStats() {
    mMin = Infinity; mMax = -Infinity; energySum = 0; energyCount = 0;
    minEl.textContent = "—"; maxEl.textContent = "—"; avgEl.textContent = "—";
  }

  // segmented controls
  function wireSeg(seg, cb) {
    if (!seg) return;
    seg.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        seg.querySelectorAll("button").forEach((b) => b.classList.remove("is-on"));
        btn.classList.add("is-on");
        cb(btn.dataset.val);
      });
    });
  }
  wireSeg(weightSeg, (v) => { weighting = v; });
  wireSeg(responseSeg, (v) => { response = v; });
  wireSeg(scopeSeg, (v) => { scopeMode = v; });

  startBtn.addEventListener("click", start);
  resetBtn.addEventListener("click", resetStats);

  if (calibSave) {
    calibSave.addEventListener("click", () => {
      calibration = parseFloat(calibInput.value) || 0;
      calibration = Math.max(-40, Math.min(40, calibration));
      try { localStorage.setItem("slm_calibration", calibration); } catch (e) {}
      calibVal.textContent = (calibration >= 0 ? "+" : "") + calibration.toFixed(1) + " dB";
    });
  }

  // build the static gauge as soon as the SVG is in the DOM
  buildGauge();
  // idle gauge state
  renderGauge(0);
})();
