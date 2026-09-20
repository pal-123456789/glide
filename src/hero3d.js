// hero3d.js — Glide's landing hero as a scroll-driven 3D scene (Three.js r128).
//
// The scene is the point-cloud "face mesh" that Glide actually sees. It's not a
// static logo: scroll.js (native sticky-scroll, no GSAP) scrubs it through the
// story as you scroll —
//   • on load the points ASSEMBLE from a dispersed cloud into a face
//   • scroll 0.00–0.33  ("Move")  the head turns to follow a travelling cursor
//   • scroll 0.33–0.66  ("Hold")  the cursor rests on a ring; it fills teal→amber
//   • scroll 0.66–1.00  ("Speak") the rings settle, the face returns to camera
// then the pinned hero releases and the flat brand page scrolls up over it.
//
// This module OWNS the scene but not the scroll: it exposes setScroll(p),
// setPointer(nx,ny), resize(), start(), stop(). scroll.js drives them. If WebGL
// is unavailable or the user prefers reduced motion, initHero3D throws and the
// caller keeps the static CSS hero instead.

import { clamp } from './filter.js';

const THREE = globalThis.THREE;

function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch { return false; }
}
function reducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
// smooth 0→1→0 hump, peaks at the middle of a phase
const hump = (t) => Math.sin(clamp(t, 0, 1) * Math.PI);

// Soft round dot. `hot` gives a small bright core (used sparingly for the cursor
// halo); the default is a gentle teal falloff with NO pure-white core, so many
// overlapping points don't sum to a white blowout under normal blending.
function softDotTexture(hot) {
  const s = 64;
  const cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  if (hot) {
    grd.addColorStop(0, 'rgba(210,255,248,0.95)');
    grd.addColorStop(0.4, 'rgba(90,235,215,0.55)');
    grd.addColorStop(1, 'rgba(56,224,200,0)');
  } else {
    grd.addColorStop(0, 'rgba(158,247,234,0.98)');
    grd.addColorStop(0.42, 'rgba(84,228,212,0.6)');
    grd.addColorStop(1, 'rgba(56,224,200,0)');
  }
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  const tex = new THREE.Texture(cv); tex.needsUpdate = true;
  return tex;
}
function labelSprite(text) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 96;
  const g = cv.getContext('2d');
  g.font = '600 44px "Bricolage Grotesque", system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#EDF1F7'; g.fillText(text, 128, 52);
  const tex = new THREE.Texture(cv); tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false });
  const sp = new THREE.Sprite(mat); sp.scale.set(0.9, 0.34, 1);
  return sp;
}

// Head-like point cloud: fibonacci sphere, front hemisphere, face proportions,
// nose push. Also returns a "dispersed" start position for each point so the
// cloud can assemble on load.
function buildFacePoints(n) {
  const pts = [], scattered = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    let x = Math.cos(theta) * r, z = Math.sin(theta) * r;
    if (z < -0.35) continue;
    x *= 0.72; const yy = y * 0.96; z *= 0.86;
    const central = Math.max(0, 1 - Math.hypot(x / 0.22, (yy + 0.02) / 0.16));
    z += central * 0.22;
    pts.push([x, yy, z + 0.05]);
    // dispersed origin: a soft shell + random jitter (kept fairly tight so the
    // load-in reads as an assemble, not a full-screen flash)
    const a = Math.random() * Math.PI * 2, b = Math.acos(2 * Math.random() - 1), rr = 1.8 + Math.random() * 1.1;
    scattered.push([Math.sin(b) * Math.cos(a) * rr, Math.cos(b) * rr * 0.7, Math.sin(b) * Math.sin(a) * rr - 1]);
  }
  const positions = new Float32Array(pts.length * 3);
  const disp = new Float32Array(pts.length * 3);
  pts.forEach((p, i) => {
    positions[i * 3] = p[0]; positions[i * 3 + 1] = p[1]; positions[i * 3 + 2] = p[2];
    disp[i * 3] = scattered[i][0]; disp[i * 3 + 1] = scattered[i][1]; disp[i * 3 + 2] = scattered[i][2];
  });
  return { positions, disp, pts };
}
function buildLinks(pts, maxDist, capPerPoint) {
  const seg = [];
  for (let i = 0; i < pts.length; i++) {
    let made = 0; const near = [];
    for (let j = 0; j < pts.length; j++) {
      if (i === j) continue;
      const dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1], dz = pts[i][2] - pts[j][2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < maxDist) near.push([d, j]);
    }
    near.sort((a, b) => a[0] - b[0]);
    for (const [, j] of near) { if (made >= capPerPoint) break; if (j > i) { seg.push(pts[i][0], pts[i][1], pts[i][2], pts[j][0], pts[j][1], pts[j][2]); made++; } }
  }
  return new Float32Array(seg);
}

export function initHero3D(canvas) {
  if (!THREE) throw new Error('THREE not loaded');
  if (!webglOK()) throw new Error('WebGL unavailable');
  if (reducedMotion()) throw new Error('reduced motion preferred');

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  const CAM_Z = 3.4;
  camera.position.set(0, 0, CAM_Z);

  const group = new THREE.Group();
  // Offset the face to the right so the left column stays clear for the headline
  // (landing.css pushes the hero copy left to match). On load it eases in.
  group.position.x = 0.55;
  scene.add(group);

  // --- face cloud (assembled + dispersed positions) ---
  // NORMAL blending (not additive): dense overlapping points can't sum past the
  // sprite's own color, so the cloud reads as distinct glowing dots on the dark
  // field instead of washing the whole frame to white/mint.
  const { positions, disp, pts } = buildFacePoints(460);
  const home = positions.slice();          // assembled target
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
  const dot = softDotTexture(false);
  const dotHot = softDotTexture(true);
  const pmat = new THREE.PointsMaterial({
    size: 0.062, map: dot, transparent: true, depthWrite: false,
    blending: THREE.NormalBlending, color: 0xa6f6e8, opacity: 1.0,
  });
  const cloud = new THREE.Points(geo, pmat);
  group.add(cloud);

  // --- wireframe links ---
  const linkPos = buildLinks(pts, 0.17, 3);
  const lgeo = new THREE.BufferGeometry();
  lgeo.setAttribute('position', new THREE.BufferAttribute(linkPos, 3));
  const lmat = new THREE.LineBasicMaterial({ color: 0x5ee8d4, transparent: true, opacity: 0.22 });
  const links = new THREE.LineSegments(lgeo, lmat);
  group.add(links);

  // --- background drifting particles (sparse, faint — depth cue, not fog) ---
  const NP = 90;
  const parr = new Float32Array(NP * 3);
  for (let i = 0; i < NP; i++) { parr[i * 3] = (Math.random() - 0.5) * 10; parr[i * 3 + 1] = (Math.random() - 0.5) * 6.5; parr[i * 3 + 2] = -2.5 - Math.random() * 4; }
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', new THREE.BufferAttribute(parr, 3));
  const pmat2 = new THREE.PointsMaterial({ size: 0.028, map: dot, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x38e0c8 });
  const particles = new THREE.Points(pgeo, pmat2);
  scene.add(particles);

  // --- three dwell rings, stacked on the right (Move / Hold / Speak) ---
  const RING_Z = 0.6, RING_R = 0.26;
  const ringDefs = [
    { x: 1.35, y: 0.86, label: 'Move' },
    { x: 1.58, y: 0.0, label: 'Hold' },
    { x: 1.35, y: -0.86, label: 'Speak' },
  ];
  const rings = ringDefs.map((def) => {
    const g = new THREE.Group();
    g.position.set(def.x, def.y, RING_Z);
    const torus = new THREE.Mesh(new THREE.TorusGeometry(RING_R, 0.02, 16, 48),
      new THREE.MeshBasicMaterial({ color: 0x38e0c8, transparent: true, opacity: 0.5 }));
    g.add(torus);
    const fill = new THREE.Mesh(new THREE.CircleGeometry(RING_R * 0.9, 40),
      new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    fill.scale.setScalar(0.01); g.add(fill);
    const label = labelSprite(def.label); label.position.set(0, RING_R + 0.26, 0); g.add(label);
    scene.add(g);
    return { g, torus, fill, label, def };
  });

  // --- glowing cursor sphere that travels between the rings ---
  const cursor = new THREE.Mesh(new THREE.SphereGeometry(0.065, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0x38e0c8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  cursor.position.set(ringDefs[0].x, ringDefs[0].y, RING_Z);
  scene.add(cursor);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotHot, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x38e0c8 }));
  halo.scale.set(0.5, 0.5, 1); cursor.add(halo);

  // ---- driven state ----
  let scrollP = 0;            // 0..1 scroll progress (set by scroll.js)
  let ndcX = 0.0, ndcY = 0.0, haveMouse = false;
  let formation = 0;          // 0 dispersed -> 1 assembled (load intro)
  const clock = new THREE.Clock();
  let raf = null, running = false;

  function setScroll(p) { scrollP = clamp(p, 0, 1); }
  function setPointer(nx, ny) { ndcX = nx; ndcY = ny; haveMouse = true; }

  function resize() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  function frame() {
    if (!running) return;
    const t = clock.getElapsedTime();

    // assemble on load (independent of scroll)
    if (formation < 1) formation = Math.min(1, formation + 0.012);
    const f = easeInOut(formation);

    // point positions: lerp dispersed->home, plus a breathing wobble once formed
    const arr = geo.attributes.position.array;
    for (let i = 0; i < arr.length; i += 3) {
      const hx = home[i], hy = home[i + 1], hz = home[i + 2];
      const dx = disp[i], dy = disp[i + 1], dz = disp[i + 2];
      arr[i]     = lerp(dx, hx, f);
      arr[i + 1] = lerp(dy, hy, f);
      arr[i + 2] = lerp(dz, hz, f) + f * Math.sin(t * 1.3 + hx * 6) * 0.012;
    }
    geo.attributes.position.needsUpdate = true;
    links.material.opacity = 0.2 * f;
    cloud.material.opacity = lerp(0.2, 1.0, f);
    // ease the whole face in from centre → its right-hand resting offset
    group.position.x = lerp(0.0, 0.55, f);

    // rotation: idle sway + pointer + a scripted turn across the scroll story
    const scriptedY = lerp(-0.15, 0.6, easeInOut(scrollP)); // turn toward the rings as you scroll
    const targetRotY = (haveMouse ? ndcX * 0.4 : Math.sin(t * 0.3) * 0.18) + scriptedY;
    const targetRotX = (haveMouse ? -ndcY * 0.28 : Math.cos(t * 0.25) * 0.1) + Math.sin(scrollP * Math.PI) * -0.12;
    group.rotation.y += (targetRotY - group.rotation.y) * 0.06;
    group.rotation.x += (targetRotX - group.rotation.x) * 0.06;

    // camera dolly gently in during "Hold", back out for "Speak"
    const camTarget = CAM_Z - hump(scrollP) * 0.32;
    camera.position.z += (camTarget - camera.position.z) * 0.05;

    particles.rotation.y = t * 0.02;

    // rings + cursor: the cursor descends Move->Hold->Speak with scroll, and
    // each ring fills while the cursor is "on" it.
    const phase = scrollP * 3;                 // 0..3
    const idx = Math.min(2, Math.floor(phase)); // active ring
    const local = phase - idx;                  // 0..1 within the active phase
    const from = ringDefs[Math.max(0, idx)];
    const to = ringDefs[Math.min(2, idx + 1)];
    const cx = lerp(from.x, idx < 2 ? to.x : from.x, easeInOut(local));
    const cy = lerp(from.y, idx < 2 ? to.y : from.y, easeInOut(local));
    cursor.position.x += (cx - cursor.position.x) * 0.2;
    cursor.position.y += (cy - cursor.position.y) * 0.2;
    cursor.visible = formation > 0.6;

    rings.forEach((ring, i) => {
      // fill amount: full behind us, filling on the active ring, empty ahead
      let fillAmt = 0;
      if (i < idx) fillAmt = 1;
      else if (i === idx) fillAmt = easeInOut(local);
      ring.fill.scale.setScalar(Math.max(0.01, fillAmt));
      ring.fill.material.opacity = 0.12 + fillAmt * 0.5;
      ring.torus.material.color.setHex(fillAmt > 0.05 ? 0xffb020 : 0x38e0c8);
      const near = i === idx ? 1 : 0.35;
      ring.label.material.opacity = (0.3 + near * 0.6) * f;
      const pulse = i === idx ? 1 + hump(local) * 0.12 : 1;
      ring.torus.scale.setScalar(pulse);
    });

    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }

  function start() { if (running) return; running = true; clock.start(); frame(); }
  function stop() { running = false; if (raf) cancelAnimationFrame(raf); }

  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop(); });
  window.addEventListener('resize', resize);

  resize();
  start();
  return { setScroll, setPointer, resize, start, stop, renderer, scene };
}
