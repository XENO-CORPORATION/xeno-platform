/* The expanded sidebar's selection: ONE plate per panel that slides to the current item.
 *
 * Linear, Arc and macOS source lists mark the current item with a filled plate, never a stripe, and
 * when the selection moves the plate travels there instead of blinking out in one place and in at
 * another — the eye follows one object. The plate lives inside the scrolling body, so it scrolls and
 * transforms with the panel for free; its last position is remembered across panel re-renders, so a
 * route change that rebuilds the panel still glides from where the selection WAS.
 *
 * Also here: arrow-key navigation through the panel (a source list is a list, so ↑ ↓ Home End move
 * between items) and keeping the plate on its row while a section folds.
 */
(() => {
  const panel = document.getElementById('panel');
  if (!panel) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let last = null;          // { y, h, x, w } in PANEL coordinates — survives the body being replaced
  let queued = false, follow = 0;

  const bodyOf = () => panel.querySelector(':scope > .pv .pbody');
  const visible = (n) => n && n.offsetParent !== null && n.getClientRects().length && !n.closest('.sec.closed .sbody, .pj:not(.open) > .kids');
  const current = (body) => [...body.querySelectorAll('.row[aria-current="true"]')].find(visible) || null;

  function place() {
    queued = false;
    const body = bodyOf(); if (!body) return;
    let plate = body.querySelector(':scope > .psel');
    const fresh = !plate;
    if (fresh) { plate = document.createElement('i'); plate.className = 'psel'; plate.setAttribute('aria-hidden', 'true'); body.prepend(plate); }
    const row = current(body);
    const pr = panel.getBoundingClientRect(), br = body.getBoundingClientRect();
    if (!row) { plate.classList.remove('on'); return; }
    const r = row.getBoundingClientRect();
    // body coordinates: the plate is a child of the scroller, so add its scroll offset
    const to = { y: r.top - br.top + body.scrollTop, x: r.left - br.left, w: r.width, h: r.height };
    const set = (p) => { plate.style.transform = `translate(${p.x}px,${p.y}px)`; plate.style.width = p.w + 'px'; plate.style.height = p.h + 'px'; };
    if (fresh && last && !reduce.matches) {
      // a rebuilt panel: start where the selection was on screen, then travel
      plate.classList.add('still'); plate.classList.add('on');
      set({ y: last.y - (br.top - pr.top) + body.scrollTop, x: last.x - (br.left - pr.left), w: last.w, h: last.h });
      void plate.offsetWidth; plate.classList.remove('still');
    } else if (fresh || !plate.classList.contains('on')) {
      plate.classList.add('still'); set(to); void plate.offsetWidth; plate.classList.remove('still');
    }
    plate.classList.add('on'); set(to);
    last = { y: r.top - pr.top, x: r.left - pr.left, w: r.width, h: r.height };
    plate.classList.toggle('need', row.classList.contains('needrow'));
  }
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(place); } };

  // anything that can move the selection: aria-current flips, the body being replaced, a fold
  new MutationObserver((rs) => { if (rs.some((r) => !r.target.classList?.contains('psel'))) schedule(); }).observe(panel, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-current', 'class'] });
  addEventListener('resize', schedule);
  // a section folding moves every row below it — follow the rows frame by frame while it animates
  panel.addEventListener('transitionrun', (e) => {
    if (!e.target.classList?.contains('sbody') && !e.target.classList?.contains('kids')) return;
    const until = performance.now() + 320; cancelAnimationFrame(follow);
    const tick = () => { const b = bodyOf(), p = b?.querySelector(':scope > .psel'), row = b && current(b);
      if (p && row) { p.classList.add('still'); const br = b.getBoundingClientRect(), r = row.getBoundingClientRect(); p.style.transform = `translate(${r.left - br.left}px,${r.top - br.top + b.scrollTop}px)`; }
      if (performance.now() < until) follow = requestAnimationFrame(tick); else { p?.classList.remove('still'); schedule(); } };
    follow = requestAnimationFrame(tick);
  });

  // mark the section being folded so only IT animates (see @starting-style in index.html)
  panel.addEventListener('click', (e) => { const f = e.target.closest?.('[data-fold], .pj > .row'); const host = f?.closest('.sec, .pj'); if (!host) return;
    host.classList.add('folding'); clearTimeout(host._ft); host._ft = setTimeout(() => host.classList.remove('folding'), 420); }, true);

  // ↑ ↓ Home End move through the list; the section headings are stops too, so a fold is reachable
  panel.addEventListener('keydown', (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    const at = e.target.closest?.('.pv .row, .pv .act, .pv .sh button.t'); if (!at) return;
    const body = bodyOf(); if (!body) return;
    const stops = [...body.querySelectorAll('.row, .act, .sh button.t')].filter((n) => visible(n) && !n.disabled);
    const i = stops.indexOf(at); if (i < 0) return;
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? stops.length - 1 : Math.max(0, Math.min(stops.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    e.preventDefault(); stops[j].focus(); stops[j].scrollIntoView({ block: 'nearest' });
  });

  schedule();
})();
