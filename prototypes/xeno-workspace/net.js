/* XENO_NET — every saving action goes through one door, so it can take time, fail, be refused or conflict, the way the
 * real API will (Linear / Stripe pattern: the change shows as pending on the control that made it, then lands or rolls
 * back with a reason and a way forward). XENO_ROLE — who you are viewing the workspace as.
 *
 * PROTOTYPE CONTROLS (Ctrl+Alt+P, or the chip bottom-left): network = normal · slow · flaky · offline · refuse · conflict,
 * and view-as = owner · admin · member · guest. These exist only in the prototype; the real app gets these outcomes from
 * the server. Money actions carry an idempotency key, so retrying a failed payment can never charge twice.
 *
 * NET.run({ op, label, el, money, apply }) → Promise<boolean>
 *   op     stable operation name, the future API route (e.g. 'fund.contribute' → POST /projects/:id/funding/contributions)
 *   label  what it does, in words, for the error ("Contributing 500 cr")
 *   el     the control that started it — shown as pending and disabled until it settles
 *   apply  the change to make once the server has said yes
 */
(() => {
  const X = () => window.XW, D = () => window.XD;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const SS = { get(k, d) { try { return sessionStorage.getItem('xw.' + k) || d; } catch { return d; } }, set(k, v) { try { sessionStorage.setItem('xw.' + k, v); } catch {} } };
  const MODES = [['normal', 'Normal', 'Answers in under a second'], ['slow', 'Slow', 'Every answer takes about four seconds'], ['flaky', 'Flaky', 'Every other request fails'], ['offline', 'Offline', 'Nothing reaches the server'], ['refuse', 'Refuses', 'The server says you aren’t allowed'], ['conflict', 'Conflicts', 'Someone else changed it first']];
  const ROLES = [['owner', 'Owner', 'Everything, including billing and deleting the workspace'], ['admin', 'Admin', 'Manages people, agents and settings — not billing ownership'], ['member', 'Member', 'Works in projects; asks an admin for anything else'], ['guest', 'Guest', 'Sees only what was shared with them']];
  const mode = () => SS.get('netMode', 'normal'), role = () => SS.get('viewAs', 'owner');
  let flip = 0, inflight = 0;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const errFor = (m) => m === 'offline' ? { code: 'offline', msg: 'You’re offline — nothing was sent.' } : m === 'refuse' ? { code: 'forbidden', msg: 'You aren’t allowed to do this here. An owner or admin can.' } : m === 'conflict' ? { code: 'conflict', msg: 'Someone changed this while you were looking. Reload to see their change, then try again.' } : { code: 'server', msg: 'Something went wrong on our side. Nothing was changed.' };

  function setPending(el, on) {
    if (!el || !el.isConnected) return;
    if (on) { el.dataset.netLabel = el.innerHTML; el.classList.add('net-busy'); el.setAttribute('aria-busy', 'true'); el.disabled = true; }
    else { el.classList.remove('net-busy'); el.removeAttribute('aria-busy'); el.disabled = false; }
  }
  function bar() { let b = document.getElementById('net-bar'); if (!b) { b = document.createElement('div'); b.id = 'net-bar'; b.setAttribute('role', 'status'); document.body.appendChild(b); } b.classList.toggle('on', inflight > 0); b.textContent = inflight ? 'Saving…' : ''; }

  async function run({ op, label = 'Saving', el = null, money = false, apply = () => {} }) {
    const m = mode(), key = money ? op + ':' + Math.random().toString(36).slice(2, 10) : null;
    const attempt = async () => {
      window.XENO_NET_LOG?.push({ op, key, at: Date.now() });
      inflight++; bar(); setPending(el, true);
      await wait(m === 'slow' ? 4000 : 150 + Math.random() * 150);
      inflight--; bar(); setPending(el, false);
      const fail = m === 'offline' || m === 'refuse' || m === 'conflict' || (m === 'flaky' && (flip++ % 2 === 0));
      if (!fail) { apply(); return true; }
      const e = errFor(m);
      const again = await D().confirm({ title: `${label} didn’t go through`, body: e.msg + (money ? ' You were not charged — trying again uses the same request, so it can’t charge twice.' : ''), action: e.code === 'forbidden' ? 'OK' : e.code === 'conflict' ? 'Reload' : 'Try again', danger: false });
      if (!again || e.code === 'forbidden') return false;
      if (e.code === 'conflict') { X().render(); return false; }
      return attempt();
    };
    return attempt();
  }

  // what each role may do — the client hides and explains; the server is the real gate (refuse mode proves the client copes)
  const CAN = { owner: ['billing', 'buy', 'sell', 'manage', 'fund', 'moderate', 'approve', 'contribute'], admin: ['buy', 'sell', 'manage', 'fund', 'moderate', 'approve', 'contribute'], member: ['fund', 'request', 'contribute'], guest: [] };
  const can = (what) => CAN[role()].includes(what);
  const who = () => ({ owner: 'an owner', admin: 'an owner or admin', member: 'a member', guest: 'a guest' }[role()]);

  function chip() { let c = document.getElementById('net-chip'); if (!c) { c = document.createElement('button'); c.id = 'net-chip'; c.type = 'button'; c.addEventListener('click', panel); document.body.appendChild(c); }
    const off = mode() === 'normal' && role() === 'owner'; c.classList.toggle('alert', !off);
    c.innerHTML = `<b>Prototype</b><span>${esc(MODES.find((x) => x[0] === mode())[1])} network · viewing as ${esc(ROLES.find((x) => x[0] === role())[1].toLowerCase())}</span>`; c.title = 'Prototype controls (Ctrl+Alt+P)'; }
  async function panel() {
    const v = await D().form({ title: 'Prototype controls', sub: 'Try how the workspace behaves when the server is slow or says no, and how it looks to other roles. Not part of the product.', submit: 'Apply', fields: [
      { id: 'n', label: 'Network', type: 'choice', cols: 2, value: mode(), options: MODES }, { id: 'r', label: 'View the workspace as', type: 'choice', cols: 2, value: role(), options: ROLES }] });
    if (!v) return; SS.set('netMode', v.n); SS.set('viewAs', v.r); chip(); X().render(); X().toast(`${MODES.find((x) => x[0] === v.n)[1]} network · viewing as ${ROLES.find((x) => x[0] === v.r)[1].toLowerCase()}`);
  }
  document.addEventListener('keydown', (e) => { if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'p' && !document.querySelector('.xd')) { e.preventDefault(); panel(); } });
  // ---------- one transaction per user action, for every area ----------
  // begin() at the click snapshots what the browser holds for this workspace; the area makes its change; end() asks the
  // server. A no restores the snapshot and reloads every in-memory copy from it — the screen shows exactly what was
  // there before, never a half-applied change. Server events that arrive later (a confirmation, a reply) don't go
  // through end(): they are the server speaking, not a request.
  const LABELS = { 'community.vote': 'Saving your vote', 'community.flag': 'Sending the report', 'community.resolve': 'Applying the moderation', 'community.mod': 'Applying the moderation', 'community.publish': 'Making the ticket public', 'community.report': 'Sending your report', 'company.edit': 'Saving the company', 'company.addReg': 'Adding the registration', 'company.addId': 'Adding the identifier', 'company.rmId': 'Removing the identifier', 'company.topup': 'Adding credits', 'company.allocate': 'Allocating the budget', 'company.employ': 'Employing the agent', 'company.title': 'Changing the title', 'anima.forget': 'Forgetting', 'anima.keep': 'Keeping the skill', 'anima.discard': 'Discarding the skill', 'anima.purpose': 'Saving the purpose', 'anima.rule': 'Adding the rule', 'anima.tg': 'Connecting Telegram', 'anima.del': 'Deleting the Mind', 'anima.pause': 'Pausing', 'places.move': 'Saving the layout', 'places.accept': 'Taking the handoff' };
  const MONEY = /^(company\.topup|settings\.(plan|buy|gift|credits).*)$/;
  let tx = null;
  const snapshot = () => { const o = {}; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('xw.')) o[k] = localStorage.getItem(k); } } catch {} return o; };
  function restore(snap) {
    try { const now = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('xw.')) now.push(k); } now.forEach((k) => { if (!(k in snap)) localStorage.removeItem(k); }); Object.entries(snap).forEach(([k, v]) => localStorage.setItem(k, v)); } catch {}
    window.XENO_DB?.reload?.(); window.XENO_WF?.reload?.(); window.XD?.applyPrefs?.(); window.XENO_PG_SYNC_NAV?.(); X().render();
  }
  function begin(scope, act, el) { tx = { scope, act, el, snap: snapshot(), at: Date.now() }; }
  // an action that ends without saving (cancelled dialog, early refusal) closes its transaction — a later, unrelated save
  // must never inherit it, or that save would put the old control into the pending state
  function clear(el) { if (tx && tx.el === el) tx = null; }
  async function end(apply = () => {}, meta = {}) {
    const t = tx; tx = null;
    if (!t) { apply(); return true; }
    const op = meta.op || `${t.scope}.${t.act}`;
    const ok = await run({ op, label: meta.label || LABELS[op] || 'Saving', money: meta.money ?? MONEY.test(op), el: t.el, apply });
    if (!ok) restore(t.snap);
    return ok;
  }
  // ---------- role gates: an action a role can't take is shown unavailable with the reason, and refused on click ----------
  const GATES = []; // [attr, Set(actions), capability, reason]
  function gate(attr, acts, capability, reason) { GATES.push([attr, new Set(acts), capability, reason]); mark(); }
  function blocked(el) { for (const [attr, acts, capb, reason] of GATES) { const a = el.getAttribute('data-' + attr); if (a && acts.has(a) && !can(capb)) return reason; } return null; }
  function mark() { const main = document.getElementById('main'); if (!main) return; GATES.forEach(([attr]) => main.querySelectorAll(`[data-${attr}]`).forEach((el) => { const r = blocked(el); if (r) { el.setAttribute('aria-disabled', 'true'); el.classList.add('role-off'); el.title = r; } else if (el.classList.contains('role-off')) { el.removeAttribute('aria-disabled'); el.classList.remove('role-off'); el.removeAttribute('title'); } })); }
  document.addEventListener('click', (e) => { const el = e.target.closest('[class~="role-off"]'); if (!el || el.closest('.xd')) return; e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); X().toast(el.title); }, true);
  new MutationObserver(() => mark()).observe(document.documentElement, { childList: true, subtree: true });
  window.XENO_NET_LOG = [];
  // tests (and anything else) can wait for every request to settle instead of guessing a delay
  const idle = async () => { while (inflight > 0) await wait(30); await wait(30); };
  window.XENO_NET = { run, begin, end, clear, idle, mode, setMode: (m) => { SS.set('netMode', m); chip(); }, panel };
  window.XENO_ROLE = { role, can, who, gate, set: (r) => { SS.set('viewAs', r); chip(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', chip); else chip();
})();
