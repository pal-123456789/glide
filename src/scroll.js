// scroll.js — the landing page's scroll director (NATIVE scroll, no GSAP).
//
// WHY NO GSAP: ScrollTrigger's pin is fragile — `overflow-x:hidden` on <body>
// and `scroll-behavior:smooth` both silently break it, and it needs a second
// CDN script. When the pin fails the hero DOESN'T stay put, so the Move/Hold/
// Speak captions render on top of the headline. This version pins the hero with
// pure CSS `position:sticky` (which can't fail that way) and computes scroll
// progress itself from the track's geometry, then drives:
//   • the 3D scene scrub          scene.setScroll(p)
//   • the headline fading UP and OUT early, before captions appear
//   • the three captions cross-fading in the space the headline vacated
//   • section reveals via IntersectionObserver
// Three.js still renders the 3D hero (that's the whole point). If the scene or
// sticky can't run, we degrade to a static, readable page.

import { initHero3D } from './hero3d.js';

const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

function boot() {
  document.body.classList.add('js');
  let scene = null;

  // 1) Bring up the 3D scene. If it fails, the static CSS hero stays.
  const canvas = document.getElementById('hero3d');
  if (canvas && !prefersReduced) {
    try {
      scene = initHero3D(canvas);
      document.body.classList.add('has3d');
    } catch (err) {
      console.info('[Glide] 3D hero disabled:', err && err.message);
    }
  }

  // 2) Pointer parallax — the face tracks the mouse.
  if (scene) {
    window.addEventListener('mousemove', (e) => {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = -((e.clientY / window.innerHeight) * 2 - 1);
      scene.setPointer(nx, ny);
    }, { passive: true });
  }

  // 3) Reveal sections on enter (works with or without 3D).
  setupReveals();
  watchCountUp();

  // 4) Native sticky-scroll film — only when we actually have a scene to scrub
  //    and motion is allowed. Otherwise leave the static hero as-is.
  if (scene && !prefersReduced) {
    document.body.classList.add('scrollfx');
    setupStickyFilm(scene);
  } else {
    if (scene) scene.setScroll(0.12); // a pleasant static pose
    document.body.classList.add('no-scrollfx');
  }
}

// Pin the hero with CSS sticky; compute progress from how far we've scrolled
// through the tall track behind it, and drive scene + captions from that.
function setupStickyFilm(scene) {
  const track = document.querySelector('.hero-track');
  const heroLead = document.querySelector('.hero-lead');
  const cue = document.querySelector('.scroll-cue');
  const captions = Array.from(document.querySelectorAll('.chapter'));
  if (!track) { scene.setScroll(0.12); return; }

  let progress = 0, queued = false;

  function measure() {
    const rect = track.getBoundingClientRect();
    // distance we can scroll while the hero is pinned = track height - one viewport
    const scrollable = track.offsetHeight - window.innerHeight;
    // how far the track's top has passed the top of the viewport
    const scrolled = -rect.top;
    progress = clamp01(scrollable > 0 ? scrolled / scrollable : 0);
    render();
  }

  function render() {
    queued = false;
    // scrub the 3D scene across the whole pin
    scene.setScroll(progress);

    // Headline: fully gone by progress 0.14 (it lifts up and fades). The first
    // caption doesn't begin appearing until 0.15, so the two never co-exist.
    if (heroLead) {
      const out = clamp01((progress - 0.02) / 0.12);
      heroLead.style.opacity = (1 - out).toFixed(3);
      heroLead.style.transform = `translateY(${(-44 * out).toFixed(1)}px)`;
      heroLead.style.pointerEvents = out > 0.5 ? 'none' : '';
    }
    if (cue) cue.style.opacity = (1 - clamp01(progress / 0.05)).toFixed(3);

    // Captions: three bands, each fades in then out. Caption 1 starts at
    // center-half = 0.15 — AFTER the headline is gone (0.14) — so no overlap.
    // Peaks (0.30 / 0.56 / 0.82) track the scene's Move/Hold/Speak ring phases.
    const centers = [0.30, 0.56, 0.82];
    const half = 0.15;
    captions.forEach((cap, i) => {
      const d = Math.abs(progress - centers[i]);
      const vis = clamp01(1 - d / half);
      // ease for a softer fade
      const e = vis * vis * (3 - 2 * vis);
      cap.style.opacity = e.toFixed(3);
      cap.style.transform = `translateY(${((1 - e) * 26).toFixed(1)}px)`;
    });
  }

  function onScroll() {
    if (!queued) { queued = true; requestAnimationFrame(measure); }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', measure);
  measure();
}

// Fade/rise sections as they enter the viewport (replaces GSAP reveals).
function setupReveals() {
  const els = Array.from(document.querySelectorAll('.reveal'));
  if (!('IntersectionObserver' in window) || prefersReduced) {
    els.forEach((el) => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    });
  }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
  els.forEach((el) => io.observe(el));
}

// Count "$0" → "$4,000" the first time the figure scrolls into view.
function watchCountUp() {
  const fig = document.getElementById('costFig');
  if (!fig) return;
  if (!('IntersectionObserver' in window) || prefersReduced) { fig.textContent = '$4,000'; return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { countUp(fig, 4000, 1400); io.unobserve(en.target); }
    });
  }, { threshold: 0.6 });
  io.observe(fig);
}

function countUp(el, to, ms) {
  const start = performance.now();
  function step(now) {
    const k = Math.min(1, (now - start) / ms);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = '$' + Math.round(eased * to).toLocaleString();
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
