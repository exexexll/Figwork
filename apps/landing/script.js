/* ============================================
   FIGWORK — Full-Screen Animated Pixel Sunset
              + Wave Text Decode
   ============================================ */

// ─── PAGE DETECTION ─────────────────────────
const isThesisPage = document.body.classList.contains('thesis-page');

// ─── REDUCED MOTION CHECK ───────────────────
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ─── FONT LOADING (thesis page — prevents text jump) ──
if (isThesisPage) {
  document.fonts.ready.then(() => {
    document.body.classList.add('fonts-ready');
  });
  // Fallback: show after 1s even if fonts fail
  setTimeout(() => { document.body.classList.add('fonts-ready'); }, 1000);
}

// ─── HELPERS ─────────────────────────────
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpC(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}
function rgb(c) { return `rgb(${c[0]},${c[1]},${c[2]})`; }
function hash(n) {
  let x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
function vnoise(x, freq, oct) {
  let v = 0, a = 1, f = freq, ta = 0;
  for (let o = 0; o < oct; o++) {
    const i = Math.floor(x * f);
    const fr = (x * f) - i;
    const s = fr * fr * (3 - 2 * fr);
    v += a * lerp(hash(i), hash(i + 1), s);
    ta += a; a *= 0.5; f *= 2;
  }
  return v / ta;
}


// ──────────────────────────────────────────
// 1. FULL-SCREEN ANIMATED PIXEL SUNSET
// ──────────────────────────────────────────
const canvas = document.getElementById('sunsetCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;

// Adaptive pixel size: larger pixels on mobile for performance
const isMobile = window.innerWidth <= 600;
const PX = isMobile ? 8 : 6;

// Cap DPR on mobile to save GPU/memory
const MAX_DPR = isMobile ? 1.5 : (window.devicePixelRatio || 1);

const skyStops = [
  { p: 0.0,  c: [25, 22, 20] },
  { p: 0.15, c: [32, 28, 24] },
  { p: 0.3,  c: [48, 36, 28] },
  { p: 0.45, c: [75, 50, 35] },
  { p: 0.6,  c: [120, 72, 40] },
  { p: 0.75, c: [165, 100, 50] },
  { p: 0.85, c: [200, 130, 60] },
  { p: 0.93, c: [220, 165, 80] },
  { p: 1.0,  c: [240, 195, 110] },
];

function skyColor(t) {
  for (let i = 0; i < skyStops.length - 1; i++) {
    if (t >= skyStops[i].p && t <= skyStops[i + 1].p) {
      const lt = (t - skyStops[i].p) / (skyStops[i + 1].p - skyStops[i].p);
      return lerpC(skyStops[i].c, skyStops[i + 1].c, lt);
    }
  }
  return skyStops[skyStops.length - 1].c;
}

// ── Load fig icon ──
const figImg = new Image();
figImg.src = 'iconfigwork.png';
let figLoaded = false;
let figAspect = 1.25;

figImg.onload = () => {
  figLoaded = true;
  figAspect = figImg.naturalHeight / figImg.naturalWidth;
};

// Pre-render a small pixelated version
let figSmallCanvas = null;
function ensureFigSmall(gridW) {
  if (!figLoaded) return null;
  const gridH = Math.round(gridW * figAspect);
  if (figSmallCanvas && figSmallCanvas.width === gridW && figSmallCanvas.height === gridH) {
    return figSmallCanvas;
  }
  figSmallCanvas = document.createElement('canvas');
  figSmallCanvas.width = gridW;
  figSmallCanvas.height = gridH;
  const sctx = figSmallCanvas.getContext('2d');
  sctx.clearRect(0, 0, gridW, gridH);
  sctx.drawImage(figImg, 0, 0, gridW, gridH);
  return figSmallCanvas;
}

// Moving entities — fewer on mobile
const ships = isMobile ? [
  { x: 0.3, speed: 0.0003, size: 1, y: 0.62 },
  { x: 0.7, speed: -0.0002, size: 1, y: 0.58 },
] : [
  { x: 0.15, speed: 0.0003, size: 1, y: 0.62 },
  { x: 0.55, speed: -0.0002, size: 1.4, y: 0.58 },
  { x: 0.82, speed: 0.00015, size: 0.8, y: 0.68 },
];

const seagulls = isMobile ? [
  { x: 0.3, y: 0.2, speed: 0.0006, wing: 0, wingSpeed: 0.08 },
  { x: 0.6, y: 0.15, speed: 0.0004, wing: 0, wingSpeed: 0.06 },
  { x: 0.8, y: 0.28, speed: 0.0005, wing: 0, wingSpeed: 0.09 },
] : [
  { x: 0.3, y: 0.2, speed: 0.0006, wing: 0, wingSpeed: 0.08 },
  { x: 0.6, y: 0.15, speed: 0.0004, wing: 0, wingSpeed: 0.06 },
  { x: 0.8, y: 0.28, speed: 0.0005, wing: 0, wingSpeed: 0.09 },
  { x: 0.1, y: 0.35, speed: 0.0003, wing: 0, wingSpeed: 0.07 },
  { x: 0.45, y: 0.1, speed: 0.0007, wing: 0, wingSpeed: 0.1 },
];

// Deep ocean floor colors (thesis page scroll)
const deepStops = [
  { p: 0.0,  c: [12, 14, 16] },
  { p: 0.3,  c: [8, 12, 18] },
  { p: 0.5,  c: [6, 10, 16] },
  { p: 0.7,  c: [10, 14, 12] },
  { p: 0.85, c: [18, 16, 12] },
  { p: 1.0,  c: [22, 20, 14] },
];

function deepColor(t) {
  for (let i = 0; i < deepStops.length - 1; i++) {
    if (t >= deepStops[i].p && t <= deepStops[i + 1].p) {
      const lt = (t - deepStops[i].p) / (deepStops[i + 1].p - deepStops[i].p);
      return lerpC(deepStops[i].c, deepStops[i + 1].c, lt);
    }
  }
  return deepStops[deepStops.length - 1].c;
}

// ── Canvas dimension cache (avoid re-alloc every frame) ──
let _canvasW = 0, _canvasH = 0, _canvasDpr = 0;

function syncCanvasSize() {
  const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
  const W = window.innerWidth;
  const H = window.innerHeight;
  if (W === _canvasW && H === _canvasH && dpr === _canvasDpr) return;
  _canvasW = W; _canvasH = H; _canvasDpr = dpr;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
}

function drawSunset(time) {
  if (!ctx) return;

  syncCanvasSize();
  const dpr = _canvasDpr;
  const W = _canvasW;
  const viewH = _canvasH;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const cols = Math.ceil(W / PX);
  const viewRows = Math.ceil(viewH / PX);

  // On thesis page, total scene is taller; we render the visible slice
  const scrollPx = isThesisPage ? window.scrollY : 0;
  const totalH = isThesisPage
    ? Math.max(document.body.scrollHeight, viewH)
    : viewH;
  const totalRows = Math.ceil(totalH / PX);

  const scrollRow = Math.floor(scrollPx / PX);

  const horizon = Math.floor(viewRows * 0.48);
  const oceanEnd = viewRows;
  const deepRows = totalRows - oceanEnd;

  // Fig dimensions in grid units — smaller on mobile
  const figGridW = isMobile ? 22 : 32;
  const figGridH = Math.round(figGridW * figAspect);
  const figCX = Math.floor(cols * 0.6);
  const figLeft = figCX - Math.floor(figGridW / 2);
  const figTopRow = horizon - Math.floor(figGridH * 0.58);

  // ── Draw visible rows ──
  for (let vr = 0; vr < viewRows; vr++) {
    const r = vr + scrollRow;
    for (let c = 0; c < cols; c++) {
      let color;

      if (r <= horizon) {
        const t = r / horizon;
        color = skyColor(t);

        const dx = c - figCX;
        const dy = r - (figTopRow + figGridH * 0.45);
        const d = Math.sqrt(dx * dx + dy * dy);
        const glowR = Math.max(figGridW, figGridH) * 1.3;
        if (d < glowR) {
          const g = 1 - d / glowR;
          color = lerpC(color, [195, 165, 195], g * g * 0.22);
        }

        if (r > horizon * 0.25 && r < horizon * 0.7) {
          const cy = (r - horizon * 0.25) / (horizon * 0.45);
          const cn = vnoise(c * 0.012 + r * 0.003 + time * 0.00002, 1, 3);
          const band = 1 - Math.abs(cy - 0.5) * 2.5;
          if (band > 0 && cn > 0.48) {
            const str = band * (cn - 0.48) * 5;
            const cc = lerpC([80, 55, 40], [180, 130, 75], cy);
            color = lerpC(color, cc, Math.min(str, 0.45));
          }
        }

      } else if (r <= oceanEnd) {
        const wd = (r - horizon) / (oceanEnd - horizon);
        const refRow = horizon - (r - horizon) * 0.6;
        const refT = Math.max(0, refRow) / horizon;
        color = skyColor(Math.min(refT, 1));
        color = [
          Math.floor(color[0] * 0.35),
          Math.floor(color[1] * 0.35),
          Math.floor(color[2] * 0.38),
        ];

        const wavePhase = vnoise(c * 0.04 + r * 0.15 + time * 0.0008, 1, 2);
        if (wavePhase > 0.52) {
          const ws = (wavePhase - 0.52) * 4;
          color = lerpC(color, [60, 45, 30], ws * 0.25);
        }

        const distX = Math.abs(c - figCX);
        const shimmerW = figGridW * 0.6 * (1 + wd * 2.5);
        if (distX < shimmerW) {
          const shimmer = vnoise(c * 0.08 + r * 0.5 + time * 0.001, 1, 2);
          if (shimmer > 0.42) {
            const ss = (1 - distX / shimmerW) * (shimmer - 0.42) * 5;
            const fade = Math.max(0, 1 - wd * 1.2);
            color = lerpC(color, [190, 160, 185], ss * 0.2 * fade);
          }
        }

        color = lerpC(color, [18, 18, 16], wd * 0.6);

      } else {
        // DEEP OCEAN
        const dt = Math.min(1, (r - oceanEnd) / Math.max(1, deepRows));
        color = deepColor(dt);

        const ray = vnoise(c * 0.02 + dt * 0.5, 1, 2);
        if (ray > 0.55 && dt < 0.4) {
          const strength = (ray - 0.55) * 3 * (1 - dt / 0.4);
          color = lerpC(color, [20, 35, 45], strength * 0.3);
        }

        const particle = vnoise(c * 0.08 + r * 0.12 + time * 0.0003, 1, 3);
        if (particle > 0.62) {
          const ps = (particle - 0.62) * 6;
          color = lerpC(color, [25, 28, 22], ps * 0.15);
        }

        if (dt > 0.7) {
          const floorT = (dt - 0.7) / 0.3;
          const ridge = vnoise(c * 0.025 + 100, 1, 3);
          const ridgeH = ridge * 0.15 * floorT;
          if (dt > 1 - ridgeH) {
            color = lerpC(color, [30, 26, 18], 0.4);
          }
          const rock = vnoise(c * 0.06 + r * 0.04, 1, 2);
          if (rock > 0.68 && floorT > 0.5) {
            color = lerpC(color, [16, 14, 10], (rock - 0.68) * 6 * floorT);
          }
        }

        if (dt > 0.5 && dt < 0.95) {
          const kelpX = Math.floor(c / 8);
          const kelpSeed = hash(kelpX * 73 + 41);
          if (kelpSeed > 0.7) {
            const kelpBase = 0.95;
            const kelpTop = kelpBase - kelpSeed * 0.3;
            if (dt > kelpTop && dt < kelpBase) {
              const kelpCenter = kelpX * 8 + 4;
              const sway = Math.sin(time * 0.0005 + kelpX * 2) * 1.5;
              const kelpDist = Math.abs(c - kelpCenter - sway);
              if (kelpDist < 1.5) {
                color = lerpC(color, [12, 20, 10], 0.35 * (1 - kelpDist / 1.5));
              }
            }
          }
        }

        const fishSeed = hash(Math.floor(r / 12) * 17 + 3);
        if (fishSeed > 0.92 && dt > 0.15 && dt < 0.8) {
          const fishX = (fishSeed * 300 + time * 0.02 * (fishSeed > 0.96 ? -1 : 1)) % cols;
          const distToFish = Math.abs(c - fishX);
          if (distToFish < 2) {
            color = lerpC(color, [6, 8, 12], 0.5);
          }
        }
      }

      const dith = ((c + r) % 2 === 0) ? 1 : -1;
      color = [
        Math.max(0, Math.min(255, color[0] + dith)),
        Math.max(0, Math.min(255, color[1] + dith)),
        Math.max(0, Math.min(255, color[2] + dith)),
      ];

      ctx.fillStyle = rgb(color);
      ctx.fillRect(c * PX, vr * PX, PX, PX);
    }
  }

  // ── Draw fig ──
  const small = ensureFigSmall(figGridW);
  if (small) {
    const drawX = figLeft * PX;
    const drawY = (figTopRow - scrollRow) * PX;
    const drawW = figGridW * PX;
    const drawH = figGridH * PX;
    const horizonY = (horizon + 1 - scrollRow) * PX;

    if (horizonY > 0 && drawY < viewH) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, Math.max(0, horizonY));
      ctx.clip();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, drawX, drawY, drawW, drawH);
      ctx.restore();
    }

    if (horizonY < viewH) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, Math.max(0, horizonY), W, viewH);
      ctx.clip();
      ctx.translate(0, 2 * horizonY);
      ctx.scale(1, -1);
      ctx.globalAlpha = 0.12;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, drawX, drawY, drawW, drawH);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  // ── SHIPS ──
  for (const ship of ships) {
    ship.x += ship.speed;
    if (ship.x > 1.1) ship.x = -0.1;
    if (ship.x < -0.1) ship.x = 1.1;
    const sx = Math.floor(ship.x * cols);
    const sy = Math.floor(ship.y * viewRows) - scrollRow;
    if (sy < -10 || sy > viewRows + 10) continue;
    const s = ship.size;
    const hull = [16, 14, 12];
    for (let dx = -Math.floor(3 * s); dx <= Math.floor(3 * s); dx++) {
      ctx.fillStyle = rgb(hull);
      ctx.fillRect((sx + dx) * PX, sy * PX, PX, PX);
      if (Math.abs(dx) < Math.floor(2 * s)) {
        ctx.fillRect((sx + dx) * PX, (sy - 1) * PX, PX, PX);
      }
    }
    for (let dy = -Math.floor(4 * s); dy < 0; dy++) {
      ctx.fillStyle = rgb(hull);
      ctx.fillRect(sx * PX, (sy + dy) * PX, PX, PX);
    }
    const sail = [30, 26, 22];
    for (let dy = -Math.floor(3 * s); dy <= -1; dy++) {
      const w2 = Math.floor((1 - Math.abs(dy + 2 * s) / (2 * s)) * 2 * s);
      for (let dx = 1; dx <= w2; dx++) {
        ctx.fillStyle = rgb(sail);
        ctx.fillRect((sx + dx) * PX, (sy + dy) * PX, PX, PX);
      }
    }
  }

  // ── SEAGULLS ──
  for (const g of seagulls) {
    g.x += g.speed;
    g.wing += g.wingSpeed;
    if (g.x > 1.15) g.x = -0.15;
    const gx = Math.floor(g.x * cols);
    const gy = Math.floor(g.y * viewRows) - scrollRow;
    if (gy < -5 || gy > viewRows + 5) continue;
    const wingY = Math.round(Math.sin(g.wing) * 1.2);
    const birdC = [22, 20, 18];
    ctx.fillStyle = rgb(birdC);
    ctx.fillRect(gx * PX, gy * PX, PX, PX);
    ctx.fillRect((gx - 1) * PX, (gy + wingY) * PX, PX, PX);
    ctx.fillRect((gx - 2) * PX, (gy + wingY + (wingY >= 0 ? -1 : 1)) * PX, PX, PX);
    ctx.fillRect((gx + 1) * PX, (gy + wingY) * PX, PX, PX);
    ctx.fillRect((gx + 2) * PX, (gy + wingY + (wingY >= 0 ? -1 : 1)) * PX, PX, PX);
  }
}

// ── Animation Loop (throttled ~30fps for smooth scroll) ──
if (!prefersReducedMotion && ctx) {
  let lastFrame = 0;
  const FRAME_MS = 33; // ~30fps — plenty for pixel art, keeps scroll smooth
  function sunsetLoop(time) {
    requestAnimationFrame(sunsetLoop);
    if (time - lastFrame < FRAME_MS) return;
    lastFrame = time;
    drawSunset(time);
  }
  requestAnimationFrame(sunsetLoop);
}


// ──────────────────────────────────────────
// 2. SCRAMBLE DECODE — only on landing page (desktop only)
// ──────────────────────────────────────────
const isMobileDevice = window.matchMedia('(max-width: 699px)').matches;
console.log('[Figwork] mobile:', isMobileDevice, 'innerWidth:', window.innerWidth);

// Mobile: skip scramble, just blur in
if (!isThesisPage && isMobileDevice && !prefersReducedMotion) {
  const decodeEls = document.querySelectorAll('.decode');
  decodeEls.forEach(el => {
    el.style.opacity = '0';
    el.style.filter = 'blur(8px)';
    el.style.transition = 'opacity 1.2s ease, filter 1.2s ease';
  });
  setTimeout(() => {
    decodeEls.forEach(el => {
      el.style.opacity = '1';
      el.style.filter = 'blur(0px)';
    });
    const wl = document.querySelector('.waitlist-wrap');
    if (wl) wl.classList.add('visible');
    const det = document.querySelector('.details');
    if (det) det.classList.add('revealed');
    const lnk = document.querySelector('.link');
    if (lnk) lnk.classList.add('revealed');
  }, 400);
}

// Desktop: full scramble decode
if (!isThesisPage && !isMobileDevice && !prefersReducedMotion) {
  const ALPHA_LOWER = 'abcdefghijklmnopqrstuvwxyz';
  const ALPHA_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  function randSameCase(ch) {
    if (ch >= 'A' && ch <= 'Z') return ALPHA_UPPER[Math.floor(Math.random() * 26)];
    if (ch >= 'a' && ch <= 'z') return ALPHA_LOWER[Math.floor(Math.random() * 26)];
    return ch;
  }
  function isLetter(ch) { return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z'); }

  (function runLineDecode() {
    const els = [...document.querySelectorAll('.decode')];
    if (!els.length) return;

    const originals = [];

    /* ── Phase 1: Wrap chars in spans, group words ── */
    for (const el of els) {
      originals.push({ el, html: el.innerHTML });
      el.style.opacity = '1';

      const textNodes = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) textNodes.push(walker.currentNode);

      for (const node of textNodes) {
        const frag = document.createDocumentFragment();
        const segments = node.textContent.split(/(\s+)/);

        for (const seg of segments) {
          if (!seg) continue;
          if (/^\s+$/.test(seg)) {
            frag.appendChild(document.createTextNode(' '));
          } else {
            const wordWrap = document.createElement('span');
            wordWrap.style.whiteSpace = 'nowrap';
            for (const ch of seg) {
              const span = document.createElement('span');
              span.className = 'ch';
              span.dataset.real = ch;
              span.textContent = ch;
              span.style.opacity = '0';
              wordWrap.appendChild(span);
            }
            frag.appendChild(wordWrap);
          }
        }
        node.parentNode.replaceChild(frag, node);
      }
    }

    /* ── Phase 1b: Prevent layout shifts during scramble ── */
    const isMobileAnim = window.innerWidth < 700;
    const allSpans = document.querySelectorAll('.ch');
    if (!isMobileAnim) {
      /* Desktop: lock each character span to its measured width */
      for (const span of allSpans) {
        const w = span.getBoundingClientRect().width;
        span.style.display = 'inline-block';
        span.style.width = w + 'px';
        span.style.textAlign = 'center';
      }
    } else {
      /* Mobile: lock each WORD wrapper width so line breaks stay stable */
      const wordWraps = document.querySelectorAll('.decode span[style*="nowrap"]');
      for (const ww of wordWraps) {
        const w = ww.getBoundingClientRect().width;
        ww.style.display = 'inline-block';
        ww.style.width = w + 'px';
      }
    }

    /* ── Phase 2: Group chars into visual lines ── */
    const LINE_THRESH = 4;
    const lines = [];

    for (const { el } of originals) {
      for (const span of el.querySelectorAll('.ch')) {
        const y = span.getBoundingClientRect().top;
        let line = lines.find(l => Math.abs(l.y - y) < LINE_THRESH);
        if (!line) { line = { y, chars: [] }; lines.push(line); }
        line.chars.push(span);
      }
    }
    lines.sort((a, b) => a.y - b.y);

    /* ── Phase 3: Timing ── */
    const GROUP_SIZE    = 4;
    const GROUP_GAP     = 50;
    const SCRAMBLE_DUR  = 800;
    const SCRAMBLE_TICK = 40;
    const LINE_GAP      = 350;
    const START_DELAY   = 600;

    /* ── Phase 4: Animate ── */
    const t0 = performance.now() + START_DELAY;
    let finished = false;

    function tick(now) {
      if (finished) return;
      const elapsed = now - t0;
      if (elapsed < 0) { requestAnimationFrame(tick); return; }

      let allDone = true;

      for (let li = 0; li < lines.length; li++) {
        const lineStart = li * LINE_GAP;
        if (elapsed < lineStart) { allDone = false; continue; }

        const chars = lines[li].chars;

        for (let ci = 0; ci < chars.length; ci++) {
          const groupIdx = Math.floor(ci / GROUP_SIZE);
          const charStart = lineStart + groupIdx * GROUP_GAP;
          const charEnd   = charStart + SCRAMBLE_DUR;

          if (elapsed < charStart) { allDone = false; continue; }

          const span = chars[ci];
          const real = span.dataset.real;

          if (elapsed >= charEnd) {
            if (span.textContent !== real || span.style.opacity !== '1') {
              span.textContent = real;
              span.style.opacity = '1';
            }
          } else {
            allDone = false;
            span.style.opacity = '1';

            if (isLetter(real)) {
              const dt = elapsed - charStart;
              const tickIdx = Math.floor(dt / SCRAMBLE_TICK);
              const prev = span.dataset.tick | 0;
              if (tickIdx !== prev) {
                span.dataset.tick = tickIdx;
                span.textContent = randSameCase(real);
              }
            } else {
              span.textContent = real;
            }
          }
        }
      }

      if (allDone) {
        const wl = document.querySelector('.waitlist-wrap');
        if (wl) wl.classList.add('visible');
        const det = document.querySelector('.details');
        if (det) det.classList.add('revealed');
        const lnk = document.querySelector('.link');
        if (lnk) lnk.classList.add('revealed');
        finished = true;
        return;
      }

      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  })();
} else if (!isThesisPage && prefersReducedMotion) {
  // If reduced motion, just show everything immediately
  document.querySelectorAll('.decode').forEach(el => { el.style.opacity = '1'; });
  const wl = document.querySelector('.waitlist-wrap');
  if (wl) wl.classList.add('visible');
  const det = document.querySelector('.details');
  if (det) det.classList.add('revealed');
  const lnk = document.querySelector('.link');
  if (lnk) lnk.classList.add('revealed');
}


// ──────────────────────────────────────────
// 3. CONTACT (email link - no form handler needed)
// ──────────────────────────────────────────

document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    const t = document.querySelector(a.getAttribute('href'));
    if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});
