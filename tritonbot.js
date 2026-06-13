/* ============================================================
   tritonbot.js — Apple-style scroll-driven hardware showcase.
   Robot is pinned; scroll drives a pseudo-3D swing, ring spin,
   and a sequence of component callouts. One rAF, scroll-linked.
   ============================================================ */
(function () {
  'use strict';
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = t => t * t * (3 - 2 * t);

  function init() {
    const section = document.getElementById('tritonbot');
    if (!section) return;
    const scroll = section.querySelector('.tb-scroll');
    const robotWrap = section.querySelector('.tb-robot-wrap');
    const robot = section.querySelector('.tb-robot');
    const head = section.querySelector('.tb-head');
    const ring = section.querySelector('.tb-ring');
    const ring3 = section.querySelector('.tb-ring3');
    const glow = section.querySelector('.tb-glow');
    const callouts = [...section.querySelectorAll('.tb-callout')];
    const dots = [...section.querySelectorAll('.tb-dot')];

    if (REDUCED) {
      callouts.forEach(c => c.classList.add('on'));
      dots.forEach(d => d.classList.add('on'));
      return;
    }

    // step windows over progress 0..1 (callouts reveal in sequence)
    const steps = [
      { step: 1, a: 0.10, b: 0.34 },
      { step: 2, a: 0.30, b: 0.56 },
      { step: 3, a: 0.50, b: 0.76 },
      { step: 4, a: 0.70, b: 1.00 },
    ];

    let raf = null;
    function update() {
      raf = null;
      const rect = scroll.getBoundingClientRect();
      const vh = window.innerHeight;
      const total = rect.height - vh;          // scrollable distance while pinned
      const p = clamp(-rect.top / Math.max(1, total), 0, 1);

      // pseudo-3D swing of the robot + parallax float + scale
      const e = smooth(p);
      const rotY = lerp(-20, 24, e);
      const rotX = lerp(6, -4, e);
      const scale = lerp(0.9, 1.08, e);
      const floatY = Math.sin(p * Math.PI) * -14;
      robot.style.transform =
        `rotateY(${rotY.toFixed(2)}deg) rotateX(${rotX.toFixed(2)}deg) scale(${scale.toFixed(3)}) translateY(${floatY.toFixed(1)}px)`;

      // rings revolve, glow breathes
      if (ring)  ring.style.transform  = `translate(-50%,-50%) rotate(${(p * 320).toFixed(1)}deg)`;
      if (ring3) ring3.style.transform = `translate(-50%,-50%) rotate(${(-p * 200).toFixed(1)}deg)`;
      if (glow)  glow.style.opacity = (0.55 + Math.sin(p * Math.PI) * 0.4).toFixed(2);

      // heading fades as the teardown begins
      if (head) {
        const ho = clamp(1 - (p - 0.05) / 0.16, 0, 1);
        head.style.opacity = ho.toFixed(2);
        head.style.transform = `translateY(${(-(1 - ho) * 24).toFixed(1)}px)`;
      }

      // sequential callouts + progress dots
      steps.forEach(s => {
        const active = p >= s.a && p < s.b;
        callouts.forEach(c => { if (+c.dataset.step === s.step) c.classList.toggle('on', active); });
        dots.forEach(d => { if (+d.dataset.step === s.step) d.classList.toggle('on', active); });
      });
    }

    function onScroll() { if (raf == null) raf = requestAnimationFrame(update); }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
  }

  window.TritonBot = { init };
})();
