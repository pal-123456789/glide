// landing.js — the hero's live dwell target.
// Resting the pointer on the circle fills the amber ring over ~1s, then "clicks"
// — the same mechanic the app uses, so visitors feel it before reading anything.
// Uses the mouse as a stand-in for the head so it works with no camera.

(function () {
  var hit = document.getElementById('dwellHit');
  var fg = document.getElementById('dwellFg');
  var label = document.getElementById('dwellLabel');
  if (!hit || !fg || !label) return;

  var R = 120;
  var CIRC = 2 * Math.PI * R;
  fg.style.strokeDasharray = String(CIRC);
  fg.style.strokeDashoffset = String(CIRC);

  var DWELL_MS = 1000;
  var raf = null;
  var startedAt = 0;
  var done = false;

  function setProgress(p) {
    fg.style.strokeDashoffset = String(CIRC * (1 - Math.max(0, Math.min(1, p))));
  }

  function tick(now) {
    var p = (now - startedAt) / DWELL_MS;
    setProgress(p);
    if (p >= 1) { complete(); return; }
    raf = requestAnimationFrame(tick);
  }

  function start() {
    if (done) return;
    startedAt = performance.now();
    label.textContent = 'Hold still…';
    raf = requestAnimationFrame(tick);
  }

  function cancel() {
    if (done) return;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    setProgress(0);
    label.textContent = 'Rest your pointer here';
  }

  function complete() {
    done = true;
    if (raf) cancelAnimationFrame(raf);
    setProgress(1);
    hit.classList.add('done');
    label.innerHTML = 'That’s a click.<br><span style="font-size:15px;color:var(--muted)">No mouse. No hands.</span>';
    setTimeout(function () {
      // reset so the next visitor (or a second look) can feel it again
      done = false;
      hit.classList.remove('done');
      setProgress(0);
      label.textContent = 'Try it again';
    }, 2600);
  }

  hit.addEventListener('mouseenter', start);
  hit.addEventListener('mouseleave', cancel);
  // keyboard / touch: focus or tap also triggers the dwell
  hit.addEventListener('focus', start);
  hit.addEventListener('blur', cancel);
  hit.addEventListener('touchstart', function (e) { e.preventDefault(); start(); }, { passive: false });
  hit.addEventListener('touchend', cancel);
})();

// Solidify the nav once the hero starts leaving — keeps it legible over content.
(function () {
  var nav = document.getElementById('nav');
  if (!nav) return;
  function onScroll() { nav.classList.toggle('solid', window.scrollY > 60); }
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
})();
