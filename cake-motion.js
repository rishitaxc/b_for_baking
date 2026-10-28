(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = false;
  try { paused = localStorage.getItem('bakery-motion') === 'paused'; } catch {}
  const root = document.documentElement;
  const toggle = document.querySelector('.motion-toggle');
  const preview = document.querySelector('.builder-preview');
  preview.classList.add('cake-motion-scene');
  const sparkles = document.querySelector('.cake-sparkles').cloneNode(true);
  preview.append(sparkles);
  const actions = document.createElement('div'); actions.className = 'cake-motion-actions';
  const replay = document.createElement('button'); replay.type = 'button'; replay.className = 'cake-replay'; replay.textContent = '✧ Watch your cake come together';
  actions.append(replay); preview.append(actions);
  const apply = () => {
    root.dataset.cakeMotion = paused || reduced.matches ? 'paused' : 'playing';
    toggle.textContent = reduced.matches ? 'Animations off · reduced motion' : paused ? 'Play animations' : 'Pause animations';
    toggle.setAttribute('aria-pressed', String(paused || reduced.matches));
    toggle.disabled = reduced.matches;
    replay.disabled = reduced.matches || paused;
  };
  toggle.addEventListener('click', () => {
    paused = !paused; apply();
    try { localStorage.setItem('bakery-motion', paused ? 'paused' : 'playing'); } catch {}
  });
  reduced.addEventListener('change', apply); apply();
  replay.addEventListener('click', () => { if (!paused && !reduced.matches) drawCake(); });
  // Suspend ongoing motion outside the viewport and when the tab is hidden.
  const scenes = document.querySelectorAll('.cake-motion-scene');
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) entry.target.classList.toggle('motion-visible', entry.isIntersecting);
  }, { threshold: 0.1 });
  scenes.forEach(scene => observer.observe(scene));
  document.addEventListener('visibilitychange', () => root.classList.toggle('motion-tab-hidden', document.hidden));
})();
