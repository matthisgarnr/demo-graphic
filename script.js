// ============================================================
// TRAVERSAL — Scroll-driven globe animation
// ============================================================

(function () {
  'use strict';

  const PARTICLE_COUNT = 8000;
  const CONNECTION_DISTANCE = 0.08;
  const MAX_CONNECTIONS = 2000;
  const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

  let scrollProgress = 0;
  let particles = [];
  let neighborPairs = [];
  let canvas, ctx, w, h, dpr;
  let rotationAngle = 0;

  // Debug overrides (controlled by GUI panel)
  const debugOverrides = {};

  // Drag to rotate
  let isDragging = false;
  let dragStartX = 0;
  let dragAngleStart = 0;
  let dragVelocity = 0;


  // ============================================================
  // 3D NOISE
  // ============================================================
  function hash3(x, y, z) {
    let h = x * 374761393 + y * 668265263 + z * 1274126177;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) & 0x7fffffff) / 0x7fffffff;
  }

  function noise3(px, py, pz) {
    const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
    const fx = px - ix, fy = py - iy, fz = pz - iz;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const uz = fz * fz * (3 - 2 * fz);
    const c000 = hash3(ix, iy, iz);
    const c100 = hash3(ix + 1, iy, iz);
    const c010 = hash3(ix, iy + 1, iz);
    const c110 = hash3(ix + 1, iy + 1, iz);
    const c001 = hash3(ix, iy, iz + 1);
    const c101 = hash3(ix + 1, iy, iz + 1);
    const c011 = hash3(ix, iy + 1, iz + 1);
    const c111 = hash3(ix + 1, iy + 1, iz + 1);
    return c000*(1-ux)*(1-uy)*(1-uz) + c100*ux*(1-uy)*(1-uz) +
           c010*(1-ux)*uy*(1-uz) + c110*ux*uy*(1-uz) +
           c001*(1-ux)*(1-uy)*uz + c101*ux*(1-uy)*uz +
           c011*(1-ux)*uy*uz + c111*ux*uy*uz;
  }

  function fbm3(x, y, z) {
    return noise3(x, y, z) * 0.65 + noise3(x*2.3, y*2.3, z*2.3) * 0.35;
  }

  // ============================================================
  // PARTICLES
  // ============================================================
  function lerp(a, b, t) { return a + (b - a) * t; }

  function initParticles() {
    particles = [];
    const NS = 2.8;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const y = 1 - (i / (PARTICLE_COUNT - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = GOLDEN_ANGLE * i;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;

      const raw = fbm3(x * NS, y * NS, z * NS);
      const chaos = Math.pow(Math.max(0, Math.min(1, raw * 1.3 - 0.15)), 1.4);
      const isStorm = chaos > 0.55;
      const disp = isStorm ? 1 + chaos * 0.08 * (0.5 + Math.random()) : 1;

      // Grain shape: mostly dots and small squares for cleaner look
      const gr = Math.random();
      const grainType = gr < 0.15 ? 0 : gr < 0.55 ? 1 : 2;
      const baseSize = isStorm ? (1.8 + chaos * 2.0 + Math.random() * 0.6) : (0.9 + (1 - chaos) * 0.7 + Math.random() * 0.5);

      particles.push({
        baseX: x * disp, baseY: y * disp, baseZ: z * disp,
        origX: x, origY: y, origZ: z,
        chaos, isStorm,
        jitterSeed: Math.random() * Math.PI * 2,
        jitterSpeed: isStorm ? (0.0015 + Math.random() * 0.0015) : (0.0004 + Math.random() * 0.0003),
        jitterAmp: isStorm ? (0.010 + chaos * 0.015) : (0.002 + Math.random() * 0.003),
        jitterSeed2: Math.random() * Math.PI * 2,
        jitterSpeed2: 0.0006 + Math.random() * 0.001,
        size: baseSize,
        grainType,
        grainCos: Math.cos(Math.random() * Math.PI),
        grainSin: Math.sin(Math.random() * Math.PI),
        grainAspect: 0.15 + Math.random() * 0.3,
        grainSeed: Math.random(),
        colorR: Math.round(lerp(245, 190, chaos * 0.6)),
        colorG: Math.round(lerp(250, 230, chaos * 0.6)),
        colorB: Math.round(lerp(248, 210, chaos * 0.55)),
        scatterX: x * 2.0 + (Math.random() - 0.5) * 2.0,
        scatterY: y * 2.0 + (Math.random() - 0.5) * 2.0,
        scatterZ: z * 2.0 + (Math.random() - 0.5) * 2.0,
      });
    }

    neighborPairs = [];
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].origX - particles[j].origX;
        const dy = particles[i].origY - particles[j].origY;
        const dz = particles[i].origZ - particles[j].origZ;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < CONNECTION_DISTANCE) {
          const avgChaos = (particles[i].chaos + particles[j].chaos) / 2;
          neighborPairs.push([i, j, dist, avgChaos]);
          if (neighborPairs.length >= MAX_CONNECTIONS) break;
        }
      }
      if (neighborPairs.length >= MAX_CONNECTIONS) break;
    }
  }

  // ============================================================
  // CANVAS
  // ============================================================
  function setupCanvas() {
    canvas = document.getElementById('globe-canvas');
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Drag to rotate — only on step 0
    canvas.addEventListener('mousedown', (e) => {
      if (scrollProgress > 0.18) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragAngleStart = rotationAngle;
      dragVelocity = 0;
      canvas.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - dragStartX;
      const newAngle = dragAngleStart + dx * 0.005;
      dragVelocity = (newAngle - rotationAngle) * 0.5;
      rotationAngle = newAngle;
    });
    window.addEventListener('mouseup', () => {
      if (!isDragging) return;
      isDragging = false;
      canvas.style.cursor = '';
    });

    canvas.addEventListener('touchstart', (e) => {
      if (scrollProgress > 0.18 || e.touches.length !== 1) return;
      isDragging = true;
      dragStartX = e.touches[0].clientX;
      dragAngleStart = rotationAngle;
      dragVelocity = 0;
    }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      if (!isDragging || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - dragStartX;
      const newAngle = dragAngleStart + dx * 0.005;
      dragVelocity = (newAngle - rotationAngle) * 0.5;
      rotationAngle = newAngle;
    }, { passive: true });
    window.addEventListener('touchend', () => { isDragging = false; });
  }

  function resizeCanvas() {
    dpr = window.devicePixelRatio || 1;
    w = canvas.offsetWidth;
    h = canvas.offsetHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ============================================================
  // GSAP TEXT
  // ============================================================
  let currentStep = -1;
  let stepData = [];
  let transitioning = false;
  let pendingStep = null;

  function buildStepData() {
    document.querySelectorAll('.scroll-step').forEach((step) => {
      const lines = Array.from(step.querySelectorAll('.line-mask > *'));
      stepData.push({ el: step, lines });
    });
    stepData.forEach(({ lines }) => gsap.set(lines, { y: 60, opacity: 0 }));
  }

  function showStep(idx) {
    const { el, lines } = stepData[idx];
    el.classList.add('active');
    transitioning = true;

    const onDone = () => {
      transitioning = false;
      if (pendingStep !== null && pendingStep !== currentStep) {
        const next = pendingStep; pendingStep = null; transitionToStep(next);
      }
    };

    if (idx === 0) {
      gsap.fromTo(lines,
        { y: 30, opacity: 0, scale: 0.85, filter: 'blur(12px)' },
        {
          y: 0, opacity: 1, scale: 1, filter: 'blur(0px)',
          duration: 1.2, ease: 'power2.out', stagger: 0.15, overwrite: true,
          onComplete: onDone,
        }
      );
    } else {
      gsap.fromTo(lines, { y: 50, opacity: 0 }, {
        y: 0, opacity: 1, duration: 0.7, ease: 'power3.out', stagger: 0.09, overwrite: true,
        onComplete: onDone,
      });
    }
  }

  function hideStep(idx, onDone) {
    const { el, lines } = stepData[idx];
    transitioning = true;
    gsap.to(lines, {
      y: -30, opacity: 0, duration: 0.35, ease: 'power2.in', stagger: 0.03, overwrite: true,
      onComplete: () => {
        el.classList.remove('active');
        gsap.set(lines, { y: 60, opacity: 0 });
        transitioning = false;
        if (onDone) onDone();
      },
    });
  }

  function transitionToStep(newStep) {
    if (newStep === currentStep) return;
    if (transitioning) { pendingStep = newStep; return; }
    const oldStep = currentStep;
    currentStep = newStep;
    if (oldStep >= 0 && oldStep < stepData.length) {
      hideStep(oldStep, () => {
        if (newStep >= 0 && newStep < stepData.length) showStep(newStep);
      });
    } else if (newStep >= 0 && newStep < stepData.length) {
      showStep(newStep);
    }
  }

  function setupScroll() {
    const section = document.getElementById('scroll-animation');
    buildStepData();
    function update() {
      const rect = section.getBoundingClientRect();
      const scrollable = section.offsetHeight - window.innerHeight;
      scrollProgress = Math.max(0, Math.min(1, -rect.top / scrollable));

      if (scrollProgress < HERO_INTRO * 0.5) {
        if (currentStep >= 0) {
          hideStep(currentStep, () => {});
          currentStep = -1;
        }
        return;
      }

      const remapped = Math.max(0, (scrollProgress - HERO_INTRO) / (1 - HERO_INTRO));
      const stepIndex = getStepAt(remapped);
      transitionToStep(stepIndex);
    }
    window.addEventListener('scroll', update, { passive: true });
    update();
  }

  // ============================================================
  // HELPERS
  // ============================================================
  function smoothstep(t) { return t * t * (3 - 2 * t); }

  // ============================================================
  // STATES — 3-step scroll-driven globe + hero idle state
  // ============================================================
  // Hero: calm globe at bottom of viewport (pre-scroll)
  // Step 0: Problem Statement — particles scatter into chaos
  // Step 1: PWM — particles converge back, labels appear
  // Step 2: CSE — globe with causal connection highlights
  const NUM_STEPS = 3;
  const BREAKS = [0, 0.35, 0.70, 1.0];
  const HERO_INTRO = 0.08; // scrollProgress range for hero→step0 transition

  const HERO_STATE = {
    rotSpeed: 0.003, globeOffY: 1.3, zoom: 1.6,
    stormAlpha: 1.0, normalAlpha: 1.0,
    lineAlpha: 0.3, scatterAmt: 0,
    greenOverlay: 0.5, labelOpacity: 0.6, causalHighlight: 0,
    heroGlow: 1,
  };

  const STEPS = [
    { // 0 — Problem Statement (chaos): globe rises, icons scatter with particles
      rotSpeed: 0.006, globeOffY: 0.5, zoom: 1.0,
      stormAlpha: 0.75, normalAlpha: 0.5,
      lineAlpha: 0.01, scatterAmt: 1.3,
      greenOverlay: 0, labelOpacity: 0.3, causalHighlight: 0,
      heroGlow: 0,
    },
    { // 1 — PWM (converge + labels): globe centered, camera comes closer
      rotSpeed: 0.002, globeOffY: 0.50, zoom: 1.4,
      stormAlpha: 0.95, normalAlpha: 0.65,
      lineAlpha: 0.2, scatterAmt: 0,
      greenOverlay: 0.25, labelOpacity: 1, causalHighlight: 0,
      heroGlow: 0,
    },
    { // 2 — CSE (causal connections): camera even closer
      rotSpeed: 0.001, globeOffY: 0.50, zoom: 1.6,
      stormAlpha: 0.95, normalAlpha: 0.7,
      lineAlpha: 0.3, scatterAmt: 0,
      greenOverlay: 0.35, labelOpacity: 0.4, causalHighlight: 1,
      heroGlow: 0,
    },
  ];

  function getStepAt(progress) {
    for (let i = 0; i < NUM_STEPS; i++) {
      if (progress < BREAKS[i + 1]) return i;
    }
    return NUM_STEPS - 1;
  }

  function getLocalT(progress) {
    const idx = getStepAt(progress);
    const start = BREAKS[idx];
    const end = BREAKS[idx + 1];
    return Math.min(1, (progress - start) / (end - start));
  }

  function getState(progress) {
    // Hero → Step 0 transition during early scroll
    if (progress < HERO_INTRO) {
      const t = smoothstep(progress / HERO_INTRO);
      const s = {};
      for (const key of Object.keys(HERO_STATE)) {
        s[key] = lerp(HERO_STATE[key], STEPS[0][key], t);
      }
      return s;
    }
    // Remap remaining progress across the 3 steps
    const remapped = (progress - HERO_INTRO) / (1 - HERO_INTRO);
    const idx = getStepAt(remapped);
    const localT = smoothstep(getLocalT(remapped));
    const a = STEPS[idx];
    const b = STEPS[Math.min(idx + 1, NUM_STEPS - 1)];
    const s = {};
    for (const key of Object.keys(a)) {
      s[key] = lerp(a[key], b[key], localT);
    }
    return s;
  }

  // ============================================================
  // GREEN OVERLAY
  // ============================================================
  function drawGreenOverlay(cx, cy, radius, amount) {
    if (amount < 0.005) return;
    const overlayR = radius * 1.15;
    const oy = cy - radius * 0.1;
    const grad = ctx.createRadialGradient(cx, oy, 0, cx, oy, overlayR);
    grad.addColorStop(0, `rgba(22,163,74,${0.11 * amount})`);
    grad.addColorStop(0.35, `rgba(22,163,74,${0.07 * amount})`);
    grad.addColorStop(0.6, `rgba(22,163,74,${0.03 * amount})`);
    grad.addColorStop(1, `rgba(22,163,74,0)`);
    ctx.beginPath(); ctx.arc(cx, oy, overlayR, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill();
    const innerR = radius * 0.55;
    const g2 = ctx.createRadialGradient(cx, oy, 0, cx, oy, innerR);
    g2.addColorStop(0, `rgba(22,200,80,${0.08 * amount})`);
    g2.addColorStop(0.5, `rgba(22,180,70,${0.05 * amount})`);
    g2.addColorStop(1, `rgba(22,163,74,0)`);
    ctx.beginPath(); ctx.arc(cx, oy, innerR, 0, Math.PI * 2); ctx.fillStyle = g2; ctx.fill();
  }

  // ============================================================
  // PWM LABELS — labeled nodes on globe during step 2
  // Iconoir SVG paths (viewBox 0 0 24 24, stroke-based)
  // ============================================================
  const ICONOIR = {
    database: [
      'M5 12V18C5 18 5 21 12 21C19 21 19 18 19 18V12',
      'M5 6V12C5 12 5 15 12 15C19 15 19 12 19 12V6',
      'M12 3C19 3 19 6 19 6C19 6 19 9 12 9C5 9 5 6 5 6C5 6 5 3 12 3Z',
    ],
    alert: [
      'M20.0429 21H3.95705C2.41902 21 1.45658 19.3364 2.22324 18.0031L10.2662 4.01533C11.0352 2.67792 12.9648 2.67791 13.7338 4.01532L21.7768 18.0031C22.5434 19.3364 21.581 21 20.0429 21Z',
      'M12 9V13',
      'M12 17.01L12.01 16.9989',
    ],
    server: [
      'M6 18.01L6.01 17.9989',
      'M6 6.01L6.01 5.99889',
      'M2 9.4V2.6C2 2.26863 2.26863 2 2.6 2H21.4C21.7314 2 22 2.26863 22 2.6V9.4C22 9.73137 21.7314 10 21.4 10H2.6C2.26863 10 2 9.73137 2 9.4Z',
      'M2 21.4V14.6C2 14.2686 2.26863 14 2.6 14H21.4C21.7314 14 22 14.2686 22 14.6V21.4C22 21.7314 21.7314 22 21.4 22H2.6C2.26863 22 2 21.7314 2 21.4Z',
    ],
    doc: [
      'M4 21.4V2.6C4 2.26863 4.26863 2 4.6 2H16.2515C16.4106 2 16.5632 2.06321 16.6757 2.17574L19.8243 5.32426C19.9368 5.43679 20 5.5894 20 5.74853V21.4C20 21.7314 19.7314 22 19.4 22H4.6C4.26863 22 4 21.7314 4 21.4Z',
      'M8 10L16 10', 'M8 18L16 18', 'M8 14L12 14',
      'M16 2V5.4C16 5.73137 16.2686 6 16.6 6H20',
    ],
    people: [
      'M7 18V17C7 14.2386 9.23858 12 12 12V12C14.7614 12 17 14.2386 17 17V18',
      'M1 18V17C1 15.3431 2.34315 14 4 14V14',
      'M23 18V17C23 15.3431 21.6569 14 20 14V14',
      'M12 12C13.6569 12 15 10.6569 15 9C15 7.34315 13.6569 6 12 6C10.3431 6 9 7.34315 9 9C9 10.6569 10.3431 12 12 12Z',
      'M4 14C5.10457 14 6 13.1046 6 12C6 10.8954 5.10457 10 4 10C2.89543 10 2 10.8954 2 12C2 13.1046 2.89543 14 4 14Z',
      'M20 14C21.1046 14 22 13.1046 22 12C22 10.8954 21.1046 10 20 10C18.8954 10 18 10.8954 18 12C18 13.1046 18.8954 14 20 14Z',
    ],
    cube: [
      'M21 7.35304L21 16.647C21 16.8649 20.8819 17.0656 20.6914 17.1715L12.2914 21.8381C12.1102 21.9388 11.8898 21.9388 11.7086 21.8381L3.30861 17.1715C3.11814 17.0656 3 16.8649 3 16.647L2.99998 7.35304C2.99998 7.13514 3.11812 6.93437 3.3086 6.82855L11.7086 2.16188C11.8898 2.06121 12.1102 2.06121 12.2914 2.16188L20.6914 6.82855C20.8818 6.93437 21 7.13514 21 7.35304Z',
      'M3.52844 7.29357L11.7086 11.8381C11.8898 11.9388 12.1102 11.9388 12.2914 11.8381L20.5 7.27777',
      'M12 21L12 12',
    ],
    terminal: [
      'M13 17H20',
      'M5 7L10 12L5 17',
    ],
    cloud: [
      'M12 4C6 4 6 8 6 10C4.33333 10 1 11 1 15C1 19 4.33333 20 6 20H18C19.6667 20 23 19 23 15C23 11 19.6667 10 18 10C18 8 18 4 12 4Z',
    ],
    activity: [
      'M3 12H6L9 3L15 21L18 12H21',
    ],
    queue: [
      'M8 6L20 6', 'M4 6.01L4.01 5.99889',
      'M4 12.01L4.01 11.9989', 'M4 18.01L4.01 17.9989',
      'M8 12L20 12', 'M8 18L20 18',
    ],
    // App/service window
    appWindow: [
      'M2 19.4V4.6C2 4.26863 2.26863 4 2.6 4H21.4C21.7314 4 22 4.26863 22 4.6V19.4C22 19.7314 21.7314 20 21.4 20H2.6C2.26863 20 2 19.7314 2 19.4Z',
      'M2 8H22',
      'M5 6.01L5.01 5.99889', 'M7 6.01L7.01 5.99889', 'M9 6.01L9.01 5.99889',
    ],
    // Package/deploy box
    package: [
      'M20 12V5.74853C20 5.5894 19.9368 5.43679 19.8243 5.32426L16.6757 2.17574C16.5632 2.06321 16.4106 2 16.2515 2H4.6C4.26863 2 4 2.26863 4 2.6V21.4C4 21.7314 4.26863 22 4.6 22H11',
      'M14 19L17 22L22 17',
      'M16 2V5.4C16 5.73137 16.2686 6 16.6 6H20',
    ],
    // Metrics/traces glyph
    metrics: [
      'M3 20L8 15L13 18L21 10',
      'M17 10H21V14',
    ],
  };

  const PWM_LABELS = [
    { icon: 'database', idx: null },
    { icon: 'alert', idx: null },
    { icon: 'doc', idx: null },
    { icon: 'people', idx: null },
    { icon: 'appWindow', idx: null },
    { icon: 'server', idx: null },
    { icon: 'package', idx: null },
    { icon: 'metrics', idx: null },
    { icon: 'cloud', idx: null },
    { icon: 'terminal', idx: null },
    { icon: 'database', idx: null },
    { icon: 'alert', idx: null },
    { icon: 'server', idx: null },
    { icon: 'cube', idx: null },
  ];

  function assignLabelParticles() {
    // Pick well-distributed, front-facing, chaotic particles for labels
    const candidates = particles
      .map((p, i) => ({ i, score: p.chaos * 0.5 + p.origZ * 0.3 + Math.abs(p.origY) * -0.2, p }))
      .filter(c => c.p.chaos > 0.3 && c.p.origZ > -0.2)
      .sort((a, b) => b.score - a.score);

    const used = new Set();
    const minDist = 0.4;
    let assigned = 0;

    for (const c of candidates) {
      if (assigned >= PWM_LABELS.length) break;
      let tooClose = false;
      for (const ui of used) {
        const up = particles[ui];
        const dx = c.p.origX - up.origX;
        const dy = c.p.origY - up.origY;
        const dz = c.p.origZ - up.origZ;
        if (Math.sqrt(dx*dx + dy*dy + dz*dz) < minDist) { tooClose = true; break; }
      }
      if (tooClose) continue;
      PWM_LABELS[assigned].idx = c.i;
      used.add(c.i);
      assigned++;
    }
  }

  function drawIconPaths(pathArr, x, y, size, alpha) {
    ctx.save();
    ctx.translate(x, y);
    const scale = size / 24; // Iconoir icons are 24x24
    ctx.scale(scale, scale);
    ctx.strokeStyle = `rgba(34,197,94,${alpha})`;
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const d of pathArr) {
      const p = new Path2D(d);
      ctx.stroke(p);
    }
    ctx.restore();
  }

  function drawLabels(projByIdx, labelOpacity, now) {
    if (labelOpacity < 0.01) return;

    for (let li = 0; li < PWM_LABELS.length; li++) {
      const lbl = PWM_LABELS[li];
      if (lbl.idx === null) continue;
      const p = projByIdx[lbl.idx];
      if (!p || p.depth < -0.1) continue;

      // Staggered reveal per label
      const staggerDelay = li * 0.12;
      const revealT = Math.max(0, Math.min(1, (labelOpacity - staggerDelay) / (1 - staggerDelay)));
      if (revealT < 0.01) continue;

      // Pulse glow — each icon pulses at its own phase
      const pulse = 0.6 + 0.4 * Math.sin(now * 0.0025 + li * 1.7);
      const alpha = revealT * pulse;

      const iconSize = 20;

      // Outer glow behind icon
      const glowR = iconSize * 1.4;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, glowR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(34,197,94,${alpha * 0.18})`;
      ctx.fill();

      // Inner glow
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, iconSize * 0.8, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(34,197,94,${alpha * 0.1})`;
      ctx.fill();

      // Draw icon centered on particle
      const paths = ICONOIR[lbl.icon];
      if (paths) {
        drawIconPaths(paths, p.sx - iconSize / 2, p.sy - iconSize / 2, iconSize, alpha);
      }
    }
  }

  // ============================================================
  // CAUSAL HIGHLIGHTS — lightning bolt + ambient traces
  // ============================================================
  let causalTraces = [];     // Ambient background traces
  let lightningBolt = null;  // The main dramatic trace
  let rootCauseIdx = -1;     // Index of the "smoking gun" particle

  function buildCausalPairs() {
    causalTraces = [];
    const N = particles.length;

    function findDistantParticle(fromIdx, minDist, maxDist, exclude) {
      const fp = particles[fromIdx];
      let best = -1, bestDist = Infinity;
      for (let attempt = 0; attempt < 200; attempt++) {
        const j = Math.floor(Math.random() * N);
        if (j === fromIdx || exclude.has(j)) continue;
        const dx = fp.origX - particles[j].origX;
        const dy = fp.origY - particles[j].origY;
        const dz = fp.origZ - particles[j].origZ;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d >= minDist && d <= maxDist && d < bestDist) {
          best = j;
          bestDist = d;
        }
      }
      return best;
    }

    // --- Build the LIGHTNING BOLT: smooth central trace ---
    {
      // Find a front-facing particle to use as the central hub
      function findCentralParticle(minDist, maxDist, fromIdx, exclude) {
        const fp = particles[fromIdx];
        let best = -1, bestScore = -Infinity;
        for (let attempt = 0; attempt < 300; attempt++) {
          const j = Math.floor(Math.random() * N);
          if (j === fromIdx || exclude.has(j)) continue;
          const pj = particles[j];
          // Prefer front-facing, central particles
          if (pj.origZ < -0.1) continue;
          const dx = fp.origX - pj.origX;
          const dy = fp.origY - pj.origY;
          const dz = fp.origZ - pj.origZ;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < minDist || d > maxDist) continue;
          // Score: front-facing + central (close to Y=0) + some randomness
          const score = pj.origZ * 0.5 - Math.abs(pj.origY) * 0.3 + Math.random() * 0.2;
          if (score > bestScore) { best = j; bestScore = score; }
        }
        return best;
      }

      // Start from a front-facing particle near the top
      const candidates = particles
        .map((p, i) => ({ i, score: p.origZ * 0.5 + p.origY * 0.3 + Math.random() * 0.2 }))
        .filter(c => particles[c.i].origZ > 0.2)
        .sort((a, b) => b.score - a.score);
      const startIdx = candidates[0].i;
      const chain = [startIdx];
      const chainSet = new Set([startIdx]);

      // Shorter hops = smoother path, 12 hops
      for (let hop = 0; hop < 12; hop++) {
        const lastIdx = chain[chain.length - 1];
        const next = findCentralParticle(0.15, 0.55, lastIdx, chainSet);
        if (next === -1) break;
        chain.push(next);
        chainSet.add(next);
      }

      if (chain.length >= 6) {
        rootCauseIdx = chain[chain.length - 1];
        lightningBolt = { indices: chain };
      }
    }

    // --- Build ambient background traces (dimmer, thinner) ---
    for (let t = 0; t < 15; t++) {
      const chainLen = 4 + Math.floor(Math.random() * 6);
      let startIdx = Math.floor(Math.random() * N);
      const chain = [startIdx];
      const chainSet = new Set([startIdx]);

      for (let hop = 0; hop < chainLen; hop++) {
        const lastIdx = chain[chain.length - 1];
        // Hop to a particle 0.3-1.2 units away (medium-to-long distance on unit sphere)
        const next = findDistantParticle(lastIdx, 0.25, 1.0, chainSet);
        if (next === -1) break;
        chain.push(next);
        chainSet.add(next);
      }

      if (chain.length >= 4) {
        causalTraces.push({
          indices: chain,
          speed: 0.3 + Math.random() * 0.7,   // Pulse travel speed
          offset: Math.random() * Math.PI * 2,  // Phase offset
          width: 0.8 + Math.random() * 1.2,     // Line width
          hue: Math.random() > 0.3 ? 0 : 1,     // 0 = green, 1 = teal accent
        });
      }
    }
  }

  function drawCausalHighlights(projByIdx, highlight, now) {
    if (highlight < 0.01) return;

    // --- Ambient background traces (dim) ---
    for (let t = 0; t < causalTraces.length; t++) {
      const trace = causalTraces[t];
      const { indices, speed, offset, width, hue } = trace;
      const traceReveal = Math.max(0, Math.min(1, highlight * 2 - (t / causalTraces.length) * 1.2));
      if (traceReveal < 0.01) continue;
      const pulsePos = ((now * 0.001 * speed + offset) % 1) * indices.length;

      for (let s = 0; s < indices.length - 1; s++) {
        const a = projByIdx[indices[s]];
        const b = projByIdx[indices[s + 1]];
        if (!a || !b) continue;
        const avgDepth = (a.depth + b.depth) / 2;
        if (avgDepth < -0.2) continue;
        const depthFade = Math.max(0, (avgDepth + 0.2) / 1.2);
        const distFromPulse = Math.min(Math.abs(s - pulsePos), Math.abs(s - pulsePos + indices.length), Math.abs(s - pulsePos - indices.length));
        const pulseIntensity = Math.exp(-distFromPulse * distFromPulse * 0.15);
        const alpha = traceReveal * depthFade * (0.03 + pulseIntensity * 0.2) * highlight;
        if (alpha < 0.005) continue;
        const r = hue === 0 ? 34 : 20, g = hue === 0 ? 197 : 200, bC = hue === 0 ? 94 : 160;
        ctx.strokeStyle = `rgba(${r},${g},${bC},${alpha})`;
        ctx.lineWidth = width * 0.6 * depthFade;
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      }
    }

    // --- LIGHTNING BOLT: smooth dramatic trace ---
    if (lightningBolt && highlight > 0.2) {
      const { indices } = lightningBolt;
      const boltReveal = Math.max(0, Math.min(1, (highlight - 0.2) / 0.6));

      // Cycle: 5s travel, 2s hold at root cause
      const cycleTime = 7000;
      const phase = (now % cycleTime) / cycleTime;
      const travelPhase = Math.min(1, phase / 0.7);
      const headPos = travelPhase * indices.length;

      for (let s = 0; s < indices.length - 1; s++) {
        const a = projByIdx[indices[s]];
        const b = projByIdx[indices[s + 1]];
        if (!a || !b) continue;
        const avgDepth = (a.depth + b.depth) / 2;
        if (avgDepth < -0.2) continue;
        const depthFade = Math.max(0, (avgDepth + 0.2) / 1.2);

        if (s > headPos) continue;

        // Smooth trail — longer fade, softer falloff
        const trailDist = headPos - s;
        const trailFade = Math.exp(-trailDist * 0.15);
        const headGlow = trailDist < 2 ? 1 : trailFade;
        const alpha = boltReveal * depthFade * (0.1 + headGlow * 0.75);

        // Gentle curve offset (not zigzag)
        const dx = b.sx - a.sx, dy = b.sy - a.sy;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1) continue;
        const nx = -dy / len, ny = dx / len;
        const curve = Math.sin(s * 1.2 + 0.5) * len * 0.12;
        const cpx = (a.sx + b.sx) / 2 + nx * curve;
        const cpy = (a.sy + b.sy) / 2 + ny * curve;

        // Wide soft outer glow
        ctx.strokeStyle = `rgba(34,197,94,${alpha * 0.2})`;
        ctx.lineWidth = (8 + headGlow * 6) * depthFade;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.quadraticCurveTo(cpx, cpy, b.sx, b.sy);
        ctx.stroke();

        // Core bright line
        ctx.strokeStyle = `rgba(34,230,110,${alpha})`;
        ctx.lineWidth = (2 + headGlow * 1.5) * depthFade;
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.quadraticCurveTo(cpx, cpy, b.sx, b.sy);
        ctx.stroke();

        // Node dots along the bolt path
        if (s % 2 === 0) {
          ctx.beginPath();
          ctx.arc(a.sx, a.sy, (1.5 + headGlow * 1.5) * depthFade, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(34,230,100,${alpha * 0.8})`;
          ctx.fill();
        }
      }

      // --- ROOT CAUSE NODE: pulsing amber/gold glow at the end ---
      if (rootCauseIdx >= 0 && travelPhase >= 0.9) {
        const rc = projByIdx[rootCauseIdx];
        if (rc && rc.depth > -0.2) {
          const rcReveal = Math.min(1, (travelPhase - 0.9) / 0.1);
          const rcPulse = 0.7 + 0.3 * Math.sin(now * 0.005);
          const rcAlpha = boltReveal * rcReveal * rcPulse;
          const rcDepth = Math.max(0, (rc.depth + 0.2) / 1.2);

          // Large outer glow — amber
          const outerR = 18 + rcPulse * 6;
          ctx.beginPath();
          ctx.arc(rc.sx, rc.sy, outerR, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(245,158,11,${rcAlpha * 0.15 * rcDepth})`;
          ctx.fill();

          // Middle glow
          ctx.beginPath();
          ctx.arc(rc.sx, rc.sy, 10, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(245,158,11,${rcAlpha * 0.35 * rcDepth})`;
          ctx.fill();

          // Core dot — bright amber
          ctx.beginPath();
          ctx.arc(rc.sx, rc.sy, 4, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,200,50,${rcAlpha * 0.9 * rcDepth})`;
          ctx.fill();

          // "Root Cause" label
          ctx.font = '600 10px Inter, sans-serif';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = `rgba(245,158,11,${rcAlpha * 0.9 * rcDepth})`;
          ctx.fillText('Root Cause', rc.sx + 14, rc.sy);
        }
      }
    }
  }

  // ============================================================
  // RENDER
  // ============================================================
  let projByIdx = [];

  function renderOptimized(now) {
    const st = getState(scrollProgress);
    ctx.clearRect(0, 0, w, h);

    // --- Rotation ---
    if (!isDragging) {
      dragVelocity *= 0.95;
      if (Math.abs(dragVelocity) > 0.0001) {
        rotationAngle += dragVelocity;
      } else {
        rotationAngle += st.rotSpeed;
      }
    }

    const cosR = Math.cos(rotationAngle);
    const sinR = Math.sin(rotationAngle);

    // --- Camera ---
    const globeCx = w / 2;
    const offY = debugOverrides.globeOffY !== undefined ? debugOverrides.globeOffY : st.globeOffY;
    const zoomO = debugOverrides.zoom !== undefined ? debugOverrides.zoom : st.zoom;
    const globeCy = h * 0.42 + offY * h * 0.55;
    const radiusMult = debugOverrides.baseRadius !== undefined ? debugOverrides.baseRadius : 0.48;
    const baseRadius = Math.min(w, h) * radiusMult;
    const radius = baseRadius * zoomO;
    const cx = globeCx;
    const cy = globeCy;

    // --- Project ---
    projByIdx = new Array(particles.length);
    const sorted = [];
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const scat = st.scatterAmt;
      const bx = lerp(p.baseX, p.baseX + p.scatterX, scat);
      const by = lerp(p.baseY, p.baseY + p.scatterY, scat);
      const bz = lerp(p.baseZ, p.baseZ + p.scatterZ, scat);

      const rx = bx * cosR - bz * sinR;
      const rz = bx * sinR + bz * cosR;
      const ry = by;

      const jt1 = now * p.jitterSpeed + p.jitterSeed;
      const jt2 = now * p.jitterSpeed2 + p.jitterSeed2;
      const jx = rx + (Math.sin(jt1) * p.jitterAmp + Math.cos(jt2 * 0.7) * p.jitterAmp * 0.5);
      const jy = ry + (Math.cos(jt1 * 1.3) * p.jitterAmp + Math.sin(jt2 * 0.9) * p.jitterAmp * 0.4);

      const entry = {
        idx: i, sx: cx + jx * radius, sy: cy - jy * radius,
        depth: rz, chaos: p.chaos, isStorm: p.isStorm,
        size: p.size, colorR: p.colorR, colorG: p.colorG, colorB: p.colorB,
      };
      projByIdx[i] = entry;
      sorted.push(entry);
    }

    sorted.sort((a, b) => a.depth - b.depth);

    // --- Dark overlay behind orb, on top of background ---
    const overlayAlpha = debugOverrides.overlayAlpha !== undefined ? debugOverrides.overlayAlpha : 0.4;
    if (overlayAlpha > 0) {
      ctx.fillStyle = `rgba(0,0,0,${overlayAlpha})`;
      ctx.fillRect(0, 0, w, h);
    }

    // --- Connection lines ---
    if (st.lineAlpha > 0.005) {
      for (const [i, j, dist, avgChaos] of neighborPairs) {
        const a = projByIdx[i], b = projByIdx[j];
        if (a.depth < -0.3 && b.depth < -0.3) continue;
        const lo = st.lineAlpha * lerp(0.18, 0.06, avgChaos);
        ctx.strokeStyle = `rgba(200,220,210,${lo})`;
        ctx.lineWidth = lerp(0.3, 0.8, avgChaos);
        ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      }
    }

    // --- Causal highlights (step 3) ---
    drawCausalHighlights(projByIdx, st.causalHighlight, now);

    // --- Hero glow (step 0) — soft radial light behind particles ---
    if (st.heroGlow > 0.01) {
      const glowR = radius * 1.2;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
      grad.addColorStop(0, `rgba(210,240,225,${0.35 * st.heroGlow})`);
      grad.addColorStop(0.25, `rgba(180,220,200,${0.2 * st.heroGlow})`);
      grad.addColorStop(0.5, `rgba(140,200,180,${0.1 * st.heroGlow})`);
      grad.addColorStop(1, 'rgba(140,200,180,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(cx - glowR, cy - glowR, glowR * 2, glowR * 2);
    }

    // --- Particles (grain/noise rendering) ---
    // Batch by color to reduce fillStyle changes
    for (const p of sorted) {
      const depthFade = (p.depth + 1) / 2;
      const baseAlpha = lerp(st.normalAlpha, st.stormAlpha, p.chaos);
      const alpha = baseAlpha * depthFade;
      if (alpha < 0.01) continue;

      const sz = p.size;
      const pi = particles[p.idx];
      ctx.fillStyle = `rgba(${p.colorR},${p.colorG},${p.colorB},${alpha})`;

      if (pi.grainType === 0) {
        // Streak — thin elongated rect (no rotate for perf, use pre-computed dx/dy)
        const cos = pi.grainCos, sin = pi.grainSin;
        const hw = sz * 1.2, hh = sz * pi.grainAspect * 0.5;
        // Approximate rotated rect as a thin line via two rects offset
        ctx.fillRect(p.sx - cos * hw, p.sy - sin * hw, cos * hw * 2 + hh, sin * hw * 2 + hh);
      } else if (pi.grainType === 1) {
        // Tiny square — clean, minimal
        ctx.fillRect(p.sx - sz * 0.4, p.sy - sz * 0.4, sz * 0.8, sz * 0.8);
      } else {
        // Sub-pixel dot
        ctx.fillRect(p.sx - sz * 0.3, p.sy - sz * 0.3, sz * 0.6, sz * 0.6);
      }
    }

    // --- Green overlay ---
    drawGreenOverlay(cx, cy, radius * 0.7, st.greenOverlay);

    // --- PWM labels (step 2) ---
    drawLabels(projByIdx, st.labelOpacity, now);

    requestAnimationFrame(renderOptimized);
  }

  // ============================================================
  // FEATURES NAV — highlight active dot based on scroll position
  // ============================================================
  function setupFeatureNav() {
    const cards = document.querySelectorAll('.feature-card');
    const navItems = document.querySelectorAll('.features-nav-item');
    if (!cards.length || !navItems.length) return;

    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.getElementById(item.getAttribute('href').slice(1));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
    });

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          const idx = parseInt(id.split('-')[1]);
          navItems.forEach(item => {
            const fi = parseInt(item.dataset.feature);
            item.classList.toggle('active', fi === idx);
          });
        }
      });
    }, { rootMargin: '-30% 0px -30% 0px', threshold: 0.1 });

    cards.forEach(card => observer.observe(card));
  }

  // ============================================================
  // FEATURE CARD TEXT ANIMATIONS (GSAP scroll-triggered)
  // ============================================================
  function setupFeatureAnimations() {
    document.querySelectorAll('.feature-card').forEach(card => {
      const lines = card.querySelectorAll('.feat-line-mask > *');
      gsap.set(lines, { y: 40, opacity: 0 });

      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            gsap.to(lines, {
              y: 0, opacity: 1,
              duration: 0.8, ease: 'power3.out', stagger: 0.1, overwrite: true,
            });
            observer.unobserve(entry.target);
          }
        });
      }, { rootMargin: '0px 0px -15% 0px', threshold: 0.1 });

      observer.observe(card);
    });
  }

  // ============================================================
  // ASCII SCATTER — image-to-ascii effect on feature images
  // ============================================================
  const ASCII_CFG = {
    fontSize: 5, density: 21, brightness: -17, contrast: 51,
    alphaThresh: 93, scrollForce: 35, scrollDecay: 81, scrollMult: 3,
    returnSpeed: 5, friction: 75, cursorRadius: 235, cursorForce: 3, idleTimeout: 200,
  };
  const ASCII_FULL = '@#W$9876543210?!abc;:+=-,._ ';
  let asciiScrollVel = 0;
  let asciiLastScrollY = window.scrollY;
  const asciiInstances = [];

  window.addEventListener('scroll', () => {
    asciiScrollVel += (window.scrollY - asciiLastScrollY) * 0.6;
    asciiLastScrollY = window.scrollY;
  }, { passive: true });

  class AsciiParticle {
    constructor(x, y, ch, alpha) {
      this.ox = x; this.oy = y; this.x = x; this.y = y;
      this.vx = 0; this.vy = 0; this.char = ch; this.alpha = alpha;
    }
    update() {
      const f = ASCII_CFG.friction / 100, r = ASCII_CFG.returnSpeed / 100;
      this.vx += (this.ox - this.x) * r; this.vy += (this.oy - this.y) * r;
      this.vx *= f; this.vy *= f; this.x += this.vx; this.y += this.vy;
    }
  }

  function asciiChar(br) {
    const chars = ASCII_FULL.slice(0, ASCII_CFG.density);
    const i = Math.floor((1 - br / 255) * (chars.length - 1));
    return chars[Math.max(0, Math.min(i, chars.length - 1))];
  }

  function processAsciiImage(state, img) {
    state.particles = [];
    const fs = ASCII_CFG.fontSize, lh = fs * 1.3, cw = fs * 0.62;
    const nw = img.naturalWidth || img.width, nh = img.naturalHeight || img.height;
    if (!nw || !nh) return;
    const wr = state.wrap.getBoundingClientRect();
    const cols = Math.floor(Math.min(Math.floor(wr.width / cw), Math.ceil(nw / cw) * Math.min(Math.floor(wr.width / cw) / Math.ceil(nw / cw), Math.floor(wr.height / lh) / Math.ceil(nh / lh))));
    const rows = Math.floor(cols * (nh / nw) * (cw / lh));
    if (cols < 1 || rows < 1) return;
    const off = document.createElement('canvas'); off.width = cols; off.height = rows;
    const oc = off.getContext('2d'); oc.drawImage(img, 0, 0, cols, rows);
    let data; try { data = oc.getImageData(0, 0, cols, rows); } catch(e) { return; }
    const d = data.data;
    const b = ASCII_CFG.brightness, c = ASCII_CFG.contrast;
    const fac = (259 * (c + 255)) / (255 * (259 - c));
    for (let i = 0; i < d.length; i += 4) {
      if (d[i+3] < ASCII_CFG.alphaThresh) continue;
      for (let ch = 0; ch < 3; ch++) {
        let v = d[i+ch]; v += b * 2.55; v = fac * (v - 128) + 128;
        d[i+ch] = Math.max(0, Math.min(255, v));
      }
    }
    state.canvas.width = cols * cw; state.canvas.height = rows * lh;
    const nr = state.canvas.getBoundingClientRect();
    state.scaleX = state.canvas.width / nr.width;
    state.scaleY = state.canvas.height / nr.height;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = (row * cols + col) * 4;
        if (d[i+3] < ASCII_CFG.alphaThresh) continue;
        const br = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
        const ch = asciiChar(br); if (ch === ' ') continue;
        state.particles.push(new AsciiParticle(col * cw, row * lh, ch, d[i+3] / 255));
      }
    }
  }

  function setupAsciiScatter() {
    document.querySelectorAll('.ascii_wrap').forEach((wrap, idx) => {
      const cvs = wrap.querySelector('.ascii_canvas');
      const imgEl = wrap.querySelector('.ascii_image');
      if (!cvs || !imgEl) return;
      const color = getComputedStyle(cvs).color;
      const m = color.match(/(\d+)/g);
      const fc = m && m.length >= 3 ? {r:+m[0],g:+m[1],b:+m[2]} : {r:26,g:64,b:61};
      const state = { wrap, canvas: cvs, ctx: cvs.getContext('2d'), imgEl, particles: [],
        fontColor: fc, mouse: {x:-9999,y:-9999,active:false}, mouseIdleTimer: null, scaleX:1, scaleY:1 };
      asciiInstances.push(state);

      const load = () => {
        if (imgEl.complete && imgEl.naturalWidth > 0) processAsciiImage(state, imgEl);
        else imgEl.addEventListener('load', () => processAsciiImage(state, imgEl), { once: true });
      };
      load();
    });

    if (!asciiInstances.length) return;

    window.addEventListener('mousemove', (e) => {
      for (const s of asciiInstances) {
        const r = s.canvas.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
          s.mouse.x = (e.clientX - r.left) * s.scaleX; s.mouse.y = (e.clientY - r.top) * s.scaleY;
          s.mouse.active = true;
          clearTimeout(s.mouseIdleTimer);
          s.mouseIdleTimer = setTimeout(() => { s.mouse.active = false; }, ASCII_CFG.idleTimeout);
        } else if (s.mouse.active) { s.mouse.active = false; s.mouse.x = -9999; s.mouse.y = -9999; }
      }
    });

    function asciiAnimate() {
      asciiScrollVel *= ASCII_CFG.scrollDecay / 100;
      if (Math.abs(asciiScrollVel) < 0.02) asciiScrollVel = 0;

      for (const s of asciiInstances) {
        const { ctx: c, canvas: cv, particles: ps, mouse: ms, fontColor: fc } = s;
        c.clearRect(0, 0, cv.width, cv.height);
        c.font = `${ASCII_CFG.fontSize}px 'JetBrains Mono', monospace`;
        c.textBaseline = 'top';

        for (const p of ps) {
          if (ms.active) {
            const dx = p.x - ms.x, dy = p.y - ms.y, dSq = dx*dx + dy*dy;
            const rad = ASCII_CFG.cursorRadius;
            if (dSq < rad*rad && dSq > 0) {
              const d = Math.sqrt(dSq), f = ((rad-d)/rad), a = Math.atan2(dy,dx);
              p.vx += Math.cos(a) * f*f * ASCII_CFG.cursorForce * 0.5;
              p.vy += Math.sin(a) * f*f * ASCII_CFG.cursorForce * 0.5;
            }
          }
          const abs = Math.abs(asciiScrollVel);
          if (abs > 0.3) {
            const sv = Math.min(abs, 150) / 150, a = Math.random() * Math.PI * 2;
            const f = sv * ASCII_CFG.scrollForce * ASCII_CFG.scrollMult * (0.15+Math.random()*0.85) * 0.08;
            p.vx += Math.cos(a)*f; p.vy += Math.sin(a)*f + (asciiScrollVel>0?1:-1)*sv*ASCII_CFG.scrollForce*0.04;
          }
          p.update();

          c.fillStyle = `rgba(${fc.r},${fc.g},${fc.b},${p.alpha})`;
          c.fillText(p.char, p.x, p.y);
        }
      }
      requestAnimationFrame(asciiAnimate);
    }
    asciiAnimate();
  }

  // ============================================================
  // DEBUG CONTROLLER
  // ============================================================
  function setupDebugPanel() {
    const panel = document.createElement('div');
    panel.id = 'debug-panel';
    panel.innerHTML = `
      <style>
        #debug-panel {
          position: fixed; top: 12px; right: 12px; z-index: 99999;
          background: rgba(0,0,0,0.85); backdrop-filter: blur(12px);
          border: 1px solid rgba(255,255,255,0.15); border-radius: 12px;
          padding: 16px 20px; min-width: 260px;
          font-family: 'Inter', sans-serif; font-size: 12px; color: #ccc;
          display: flex; flex-direction: column; gap: 10px;
        }
        #debug-panel h4 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase;
          letter-spacing: 1px; color: #16A34A; font-weight: 700; }
        #debug-panel label { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        #debug-panel input[type=range] { flex: 1; accent-color: #16A34A; cursor: pointer; }
        #debug-panel .val { min-width: 40px; text-align: right; font-variant-numeric: tabular-nums; font-size: 11px; color: #fff; }
        #debug-panel .toggle-btn { background: none; border: 1px solid rgba(255,255,255,0.2);
          color: #ccc; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 11px; margin-top: 4px; }
        #debug-panel .toggle-btn:hover { background: rgba(255,255,255,0.1); }
        #debug-panel.collapsed .panel-body { display: none; }
      </style>
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h4>Orb Controller</h4>
        <button class="toggle-btn" onclick="this.closest('#debug-panel').classList.toggle('collapsed')">Toggle</button>
      </div>
      <div class="panel-body">
        <label>Globe Y Offset
          <input type="range" min="0" max="2" step="0.01" value="1.54" id="dbg-offY">
          <span class="val" id="dbg-offY-val">1.54</span>
        </label>
        <label>Zoom
          <input type="range" min="0.5" max="2.5" step="0.01" value="1.44" id="dbg-zoom">
          <span class="val" id="dbg-zoom-val">1.44</span>
        </label>
        <label>Overlay Alpha
          <input type="range" min="0" max="0.8" step="0.01" value="0.46" id="dbg-overlay">
          <span class="val" id="dbg-overlay-val">0.46</span>
        </label>
        <label>Base Radius
          <input type="range" min="0.2" max="0.8" step="0.01" value="0.48" id="dbg-radius">
          <span class="val" id="dbg-radius-val">0.48</span>
        </label>
      </div>
    `;
    document.body.appendChild(panel);

    const bind = (id, key, fmt) => {
      const input = document.getElementById(id);
      const val = document.getElementById(id + '-val');
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        debugOverrides[key] = v;
        val.textContent = fmt ? fmt(v) : v.toFixed(2);
      });
    };
    bind('dbg-offY', 'globeOffY');
    bind('dbg-zoom', 'zoom');
    bind('dbg-overlay', 'overlayAlpha');
    bind('dbg-radius', 'baseRadius');
  }

  // ============================================================
  // INIT
  // ============================================================
  window.addEventListener('DOMContentLoaded', () => {
    setupCanvas();
    initParticles();
    assignLabelParticles();
    buildCausalPairs();
    setupScroll();
    requestAnimationFrame(renderOptimized);
    setupFeatureNav();
    setupFeatureAnimations();
    setupAsciiScatter();
    setupDebugPanel();
  });

})();
