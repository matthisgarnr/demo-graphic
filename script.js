// ============================================================
// TRAVERSAL — Scroll-driven globe animation
// ============================================================

(function () {
  'use strict';

  const IS_MOBILE = window.innerWidth <= 768;
  const PARTICLE_COUNT = IS_MOBILE ? 4000 : 8000;
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

      // All particles are circular dots — no streaks, no squares
      const grainType = 2;
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

    // neighborPairs removed — connection lines disabled for performance
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
    pendingStep = null;
    transitioning = false;

    // Immediately kill all GSAP on all steps and hide them
    for (let i = 0; i < stepData.length; i++) {
      const { el, lines } = stepData[i];
      gsap.killTweensOf(lines);
      if (i !== newStep) {
        el.classList.remove('active');
        gsap.set(lines, { y: 60, opacity: 0 });
      }
    }

    const oldStep = currentStep;
    currentStep = newStep;
    if (newStep >= 0 && newStep < stepData.length) {
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
      let stepIndex = getStepAt(remapped);

      // Delay step 2 text until root cause node appears
      // Root cause shows at causalHighlight > 0.85
      // Text should arrive at the same time or just before
      if (stepIndex === 2) {
        const localT = (remapped - BREAKS[2]) / (BREAKS[3] - BREAKS[2]);
        const st = smoothstep(localT);
        if (st < 0.88) {
          stepIndex = 1; // keep step 1 text until root cause is about to show
        }
      }

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
  const BREAKS = [0, 0.12, 0.55, 1.0];  // Step 0 very short (12%), step 1 (43%), step 2 (45%)
  const HERO_INTRO = 0.05;

  const HERO_STATE = {
    rotSpeed: 0.0015, globeOffY: 1.6, zoom: 1.6,
    stormAlpha: 1.0, normalAlpha: 1.0,
    lineAlpha: 0.3, scatterAmt: 0,
    greenOverlay: 0.5, labelOpacity: 0.6, causalHighlight: 0,
    heroGlow: 1,
  };

  const STEPS = [
    { // 0 — Problem Statement (chaos): globe rises to center, icons scatter
      rotSpeed: 0.003, globeOffY: 0.3, zoom: 1.0,
      stormAlpha: 0.75, normalAlpha: 0.5,
      lineAlpha: 0.01, scatterAmt: 0.8,
      greenOverlay: 0, labelOpacity: 0.3, causalHighlight: 0,
      heroGlow: 0,
    },
    { // 1 — PWM (converge + labels): globe centered on screen
      rotSpeed: 0.001, globeOffY: 0.15, zoom: 1.2,
      stormAlpha: 1.0, normalAlpha: 0.9,
      lineAlpha: 0, scatterAmt: 0,
      greenOverlay: 0.3, labelOpacity: 1, causalHighlight: 0,
      heroGlow: 0.3,
    },
    { // 2 — CSE (causal connections): zoom in dramatically, icons gone
      rotSpeed: 0, globeOffY: 0.1, zoom: 2.0,
      stormAlpha: 1.0, normalAlpha: 0.95,
      lineAlpha: 0, scatterAmt: 0,
      greenOverlay: 0.4, labelOpacity: 0, causalHighlight: 1,
      heroGlow: 0.4,
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
    const overlayR = radius * 1.3;
    const oy = cy - radius * 0.05;
    const grad = ctx.createRadialGradient(cx, oy, 0, cx, oy, overlayR);
    grad.addColorStop(0, `rgba(22,163,74,${0.2 * amount})`);
    grad.addColorStop(0.3, `rgba(22,163,74,${0.12 * amount})`);
    grad.addColorStop(0.6, `rgba(22,163,74,${0.05 * amount})`);
    grad.addColorStop(1, `rgba(22,163,74,0)`);
    ctx.beginPath(); ctx.arc(cx, oy, overlayR, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill();
    const innerR = radius * 0.6;
    const g2 = ctx.createRadialGradient(cx, oy, 0, cx, oy, innerR);
    g2.addColorStop(0, `rgba(22,200,80,${0.15 * amount})`);
    g2.addColorStop(0.5, `rgba(22,180,70,${0.08 * amount})`);
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
    // Metrics/traces glyph (Observability)
    metrics: [
      'M3 20L8 15L13 18L21 10',
      'M17 10H21V14',
    ],
    // Connection — arrowed line
    connection: [
      'M3 12H17',
      'M14 8L18 12L14 16',
      'M21 12L21.01 11.99',
    ],
  };

  // Icons matching the Production World Model contents:
  // Service, Database, Queue, Compute, Alert, Observability, Deployment, Runbook, Team, Connection
  const PWM_LABELS = [
    { icon: 'appWindow', idx: null },   // Service
    { icon: 'database', idx: null },    // Database
    { icon: 'queue', idx: null },       // Queue
    { icon: 'server', idx: null },      // Compute
    { icon: 'alert', idx: null },       // Alert
    { icon: 'activity', idx: null },    // Observability (pulse)
    { icon: 'package', idx: null },     // Deployment
    { icon: 'doc', idx: null },         // Runbook
    { icon: 'people', idx: null },      // Team
    { icon: 'connection', idx: null },  // Connection
    // Duplicates for density
    { icon: 'database', idx: null },
    { icon: 'appWindow', idx: null },
    { icon: 'server', idx: null },
    { icon: 'alert', idx: null },
    { icon: 'doc', idx: null },
    { icon: 'queue', idx: null },
    { icon: 'activity', idx: null },
    { icon: 'people', idx: null },
    { icon: 'package', idx: null },
    { icon: 'connection', idx: null },
    { icon: 'database', idx: null },
    { icon: 'server', idx: null },
    { icon: 'appWindow', idx: null },
    { icon: 'alert', idx: null },
    { icon: 'doc', idx: null },
    { icon: 'queue', idx: null },
    { icon: 'people', idx: null },
    { icon: 'activity', idx: null },
  ];

  function assignLabelParticles() {
    // Pick well-distributed particles for labels — allow back-facing ones too for more coverage
    const candidates = particles
      .map((p, i) => ({ i, score: p.chaos * 0.4 + p.origZ * 0.3 + Math.random() * 0.3, p }))
      .filter(c => c.p.chaos > 0.2)
      .sort((a, b) => b.score - a.score);

    const used = new Set();
    const minDist = 0.25;
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
      const depthFade = Math.max(0, (p.depth + 0.1) / 1.1);
      const finalAlpha = alpha * depthFade;
      if (finalAlpha < 0.02) continue;

      // Outer glow halo
      const glowR = iconSize * 1.8;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, glowR, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(34,197,94,${finalAlpha * 0.2})`;
      ctx.fill();

      // Solid dark background disc so icon reads on top of particles
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, iconSize * 0.72, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(10,31,30,${finalAlpha * 0.7})`;
      ctx.fill();

      // Inner green ring
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, iconSize * 0.72, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(34,197,94,${finalAlpha * 0.5})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Draw icon centered on particle
      const paths = ICONOIR[lbl.icon];
      if (paths) {
        drawIconPaths(paths, p.sx - iconSize / 2, p.sy - iconSize / 2, iconSize, finalAlpha);
      }
    }
  }

  // ============================================================
  // PROCEDURAL BRANCHING LIGHTNING SYSTEM
  // ============================================================
  let lightningTree = null; // { segments: [{x1,y1,x2,y2,depth,isBranch}], endX, endY }

  // Midpoint displacement algorithm with branching
  function generateLightning(x1, y1, x2, y2, depth, maxDepth, roughness, branchProb) {
    if (depth >= maxDepth) {
      return [{ x1, y1, x2, y2, depth: 0, isBranch: false }];
    }
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const nx = -dy / len, ny = dx / len;
    const offset = (Math.random() - 0.5) * len * roughness;
    const cx = mx + nx * offset;
    const cy = my + ny * offset;

    const left = generateLightning(x1, y1, cx, cy, depth + 1, maxDepth, roughness * 0.95, branchProb);
    const right = generateLightning(cx, cy, x2, y2, depth + 1, maxDepth, roughness * 0.95, branchProb);

    let branches = [];
    if (depth > 1 && depth < maxDepth - 1 && Math.random() < branchProb) {
      const angle = Math.atan2(y2 - y1, x2 - x1) + (Math.random() > 0.5 ? 1 : -1) * (0.4 + Math.random() * 0.5);
      const bLen = len * (0.25 + Math.random() * 0.3);
      const bx = cx + Math.cos(angle) * bLen;
      const by = cy + Math.sin(angle) * bLen;
      const branchSegs = generateLightning(cx, cy, bx, by, depth + 2, maxDepth, roughness * 0.8, branchProb * 0.4);
      branchSegs.forEach(s => { s.isBranch = true; s.depth = Math.max(s.depth, 1); });
      branches = branchSegs;
    }

    return [...left, ...right, ...branches];
  }

  function buildCausalPairs() {
    // Generate the lightning tree with fixed start/end points on the globe
    // Start: upper-left, End: lower-right (the "root cause")
    const segs = generateLightning(-0.35, 0.38, 0.38, -0.38, 0, 7, 0.18, 0.4);
    lightningTree = { segments: segs, endX: 0.38, endY: -0.38 };
  }

  // Collect unique node positions from the lightning tree for drawing
  function collectBoltNodes(segments) {
    const nodes = [];
    const seen = new Set();
    for (const seg of segments) {
      if (seg.isBranch) continue;
      const key = `${seg.x1.toFixed(3)},${seg.y1.toFixed(3)}`;
      if (!seen.has(key)) { seen.add(key); nodes.push({ x: seg.x1, y: seg.y1 }); }
    }
    // Add last endpoint
    const last = segments[segments.length - 1];
    if (last) nodes.push({ x: last.x2, y: last.y2 });
    return nodes;
  }

  function drawCausalHighlights(projByIdx, highlight, now, globeCx, globeCy, globeRadius) {
    if (highlight < 0.01 || !lightningTree) return;

    const { segments, endX, endY } = lightningTree;

    // Phase 1 (highlight 0.7→0.85): Show the node dots FIRST (before bolt draws)
    // Phase 2 (highlight 0.85→1.0): Bolt connects the nodes
    const nodeReveal = Math.max(0, Math.min(1, (highlight - 0.7) / 0.15));
    const boltStart = highlight >= 0.85;
    const drawProgress = boltStart ? Math.max(0, Math.min(1, (highlight - 0.85) / 0.15)) : 0;
    const boltAlpha = boltStart ? Math.min(1, (highlight - 0.85) / 0.05) : 0;

    // Collect unique node positions from main path
    const boltNodes = collectBoltNodes(segments);
    const totalNodes = boltNodes.length;

    // --- PHASE 1: Draw node dots (appear before bolt, fade in progressively) ---
    if (nodeReveal > 0) {
      const visibleNodes = Math.floor(nodeReveal * totalNodes);
      for (let n = 0; n < visibleNodes && n < totalNodes; n++) {
        const node = boltNodes[n];
        const nx = globeCx + node.x * globeRadius;
        const ny = globeCy - node.y * globeRadius;
        const na = nodeReveal * (0.5 + 0.5 * Math.sin(now * 0.003 + n * 1.2));

        // Outer glow
        ctx.beginPath(); ctx.arc(nx, ny, 10, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(34,197,94,${na * 0.15})`; ctx.fill();
        // Mid
        ctx.beginPath(); ctx.arc(nx, ny, 5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(34,197,94,${na * 0.3})`; ctx.fill();
        // Core dot
        ctx.beginPath(); ctx.arc(nx, ny, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200,255,220,${na * 0.7})`; ctx.fill();
      }
    }

    // --- PHASE 2: Draw bolt connecting the nodes ---
    if (boltStart) {
      const totalSegs = segments.length;
      const drawCount = Math.floor(drawProgress * totalSegs);

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (let i = 0; i < drawCount && i < totalSegs; i++) {
        const seg = segments[i];
        const sx1 = globeCx + seg.x1 * globeRadius;
        const sy1 = globeCy - seg.y1 * globeRadius;
        const sx2 = globeCx + seg.x2 * globeRadius;
        const sy2 = globeCy - seg.y2 * globeRadius;

        const distFromHead = (drawCount - i) / totalSegs;
        const trailFade = Math.max(0.08, Math.exp(-distFromHead * 3));
        const a = boltAlpha * trailFade;
        const ws = seg.isBranch ? 0.5 : 1;
        const as = seg.isBranch ? 0.4 : 1;

        // Outer glow
        ctx.strokeStyle = `rgba(34,197,94,${a * 0.1 * as})`;
        ctx.lineWidth = (18 * trailFade + 5) * ws;
        ctx.beginPath(); ctx.moveTo(sx1, sy1); ctx.lineTo(sx2, sy2); ctx.stroke();

        // Mid glow
        ctx.strokeStyle = `rgba(34,220,100,${a * 0.35 * as})`;
        ctx.lineWidth = (6 * trailFade + 2.5) * ws;
        ctx.beginPath(); ctx.moveTo(sx1, sy1); ctx.lineTo(sx2, sy2); ctx.stroke();

        // Core
        ctx.strokeStyle = `rgba(180,255,210,${a * 0.9 * as})`;
        ctx.lineWidth = (2.5 * trailFade + 1) * ws;
        ctx.beginPath(); ctx.moveTo(sx1, sy1); ctx.lineTo(sx2, sy2); ctx.stroke();
      }

      // Bright node dots at connection points the bolt has passed through
      const passedNodes = Math.floor(drawProgress * totalNodes);
      for (let n = 0; n < passedNodes && n < totalNodes; n++) {
        const node = boltNodes[n];
        const nx = globeCx + node.x * globeRadius;
        const ny = globeCy - node.y * globeRadius;

        ctx.beginPath(); ctx.arc(nx, ny, 7, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(34,197,94,${boltAlpha * 0.35})`; ctx.fill();
        ctx.beginPath(); ctx.arc(nx, ny, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200,255,230,${boltAlpha * 0.9})`; ctx.fill();
      }

      // Traveling head dot
      if (drawCount > 0 && drawCount < totalSegs) {
        const headSeg = segments[Math.min(drawCount, totalSegs - 1)];
        const hx = globeCx + headSeg.x1 * globeRadius;
        const hy = globeCy - headSeg.y1 * globeRadius;
        ctx.beginPath(); ctx.arc(hx, hy, 9, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200,255,220,${boltAlpha * 0.95})`; ctx.fill();
        ctx.beginPath(); ctx.arc(hx, hy, 20, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(34,197,94,${boltAlpha * 0.12})`; ctx.fill();
      }
    }

    // ROOT CAUSE NODE
    const rcProgress = Math.max(0, Math.min(1, (highlight - 0.97) / 0.03));
    if (rcProgress > 0) {
      const rcx = globeCx + endX * globeRadius;
      const rcy = globeCy - endY * globeRadius;
      const rcPulse = 0.6 + 0.4 * Math.sin(now * 0.004);
      const a = rcProgress;

      ctx.beginPath(); ctx.arc(rcx, rcy, 40 + rcPulse * 12, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(245,158,11,${a * 0.12})`; ctx.fill();
      ctx.beginPath(); ctx.arc(rcx, rcy, 22, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(245,158,11,${a * 0.3})`; ctx.fill();
      ctx.beginPath(); ctx.arc(rcx, rcy, 8, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,210,60,${a})`; ctx.fill();
      ctx.beginPath(); ctx.arc(rcx, rcy, 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,220,${a})`; ctx.fill();

      const labelText = 'Root Cause';
      ctx.font = '700 18px Inter, sans-serif';
      const tw = ctx.measureText(labelText).width;
      const lx = rcx + 24, ly = rcy, pp = 10;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(lx - pp, ly - 16, tw + pp * 2, 32, 6);
      else ctx.rect(lx - pp, ly - 16, tw + pp * 2, 32);
      ctx.fillStyle = `rgba(20,10,0,${a * 0.85})`; ctx.fill();
      ctx.strokeStyle = `rgba(245,158,11,${a * 0.7})`; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.textBaseline = 'middle';
      ctx.fillStyle = `rgba(255,200,50,${a})`; ctx.fillText(labelText, lx, ly);
    }
  }

  // ============================================================
  // RENDER
  // ============================================================
  let projByIdx = [];

  function renderOptimized(now) {
    requestAnimationFrame(renderOptimized);
    try {
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
    const offY = st.globeOffY;
    const zoomO = st.zoom;
    const globeCy = h * 0.42 + offY * h * 0.55;
    const radiusMult = 0.48;
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

    // --- Semi-transparent dark background — lets terrain show through slightly ---
    ctx.fillStyle = 'rgba(10,31,30,0.75)';
    ctx.fillRect(0, 0, w, h);

    // --- Connection lines REMOVED for performance ---

    // --- Causal highlights (step 3) ---
    drawCausalHighlights(projByIdx, st.causalHighlight, now, cx, cy, radius);

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

      // Circular dot — 2x size
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, sz * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }

    // --- Green overlay ---
    drawGreenOverlay(cx, cy, radius * 0.7, st.greenOverlay);

    // --- Soft dark vignette behind text area (screen center) ---
    {
      const textGrad = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, h * 0.45);
      textGrad.addColorStop(0, 'rgba(10,31,30,0.35)');
      textGrad.addColorStop(0.4, 'rgba(10,31,30,0.15)');
      textGrad.addColorStop(1, 'rgba(10,31,30,0)');
      ctx.fillStyle = textGrad;
      ctx.fillRect(0, 0, w, h);
    }

    // --- PWM labels (step 2) ---
    drawLabels(projByIdx, st.labelOpacity, now);

    } catch(e) { console.error('RENDER ERROR:', e); }
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
  // Debug panel removed for production

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
  });

})();
