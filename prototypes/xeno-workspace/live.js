/* XENO_LIVE — several people in one workspace (the Figma / Linear / Notion pattern, sized for structured records):
 *   1. Presence — who is on this page right now, as faces in the top bar (people and agents; your other windows too).
 *   2. Live changes — when someone else saves, this window reloads that part, says who changed what, and keeps going.
 *   3. No silent overwrite — if someone changed the same records after you started an action, saving asks first:
 *      review their change, or keep yours on purpose (the 409 "changed since you loaded it" answer, made human).
 *
 * Transport in the prototype: other WINDOWS are real (the browser's storage event, so two tabs genuinely see each
 * other); TEAMMATES are simulated (Mira, Nova, Atlas, Juno act on their own when switched on in Prototype controls).
 * Platform: a workspace channel (WebSocket) carrying presence {who, route} and change events {by, resource, version};
 * every mutating route takes If-Match and answers 409 with the current version.
 */
(() => {
  const X = () => window.XW, D = () => window.XD;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const now = () => Date.now(), TAB = Math.random().toString(36).slice(2, 8);
  const SS = { get(k, d) { try { return sessionStorage.getItem('xw.' + k) ?? d; } catch { return d; } }, set(k, v) { try { sessionStorage.setItem('xw.' + k, v); } catch {} } };
  const route = () => (location.hash || '#/').replace(/^#\/?/, '');

  // ---------- which records an action touches (op prefix → storage keys) — the unit a conflict is detected on ----------
  const DB_SETS = ['projects', 'projectList', 'workspace', 'library', 'forum', 'anima', 'chats', 'market', 'needs', 'areas', 'recent', 'home'];
  const SCOPE = { fund: ['xw.funding'], market: ['xw.mkEnts', 'xw.mkReviews', 'xw.mkSeller', 'db:market'], community: ['db:forum', 'xw.tickets2', 'xw.fFlags', 'xw.fVotes'], report: ['db:forum', 'xw.tickets2'], company: ['xw.company'], anima: ['db:anima'], places: ['xw.placesLayout', 'xw.wf'], workforce: ['xw.wf'], resources: ['xw.wf'], settings: ['xw.acct', 'xw.prefs'] };
  const keysOf = (op) => SCOPE[String(op).split('.')[0]] || [];
  // remote changes this window has seen: key → { at, by }
  const seen = {};
  // the value each storage key had right after someone else changed it — so undoing YOUR action never erases THEIR change
  const seenVals = {};
  const storageKey = (k) => (k.startsWith('db:') ? 'xw.db.v1' : k);
  let actionAt = now();
  // an action starts at the click that OPENS it — never at the dialog's own Save, or every edit would look newer than the change it overwrites
  document.addEventListener('click', (e) => { if (e.target.closest('#main, #menu') && !e.target.closest('.xd')) actionAt = now(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'F1' || (e.ctrlKey && e.altKey)) actionAt = now(); }, true);

  // which DB sets differ between two snapshots of the one-blob store — so two people editing different areas never collide
  const dbDiff = (a, b) => { let x = {}, y = {}; try { x = JSON.parse(a || '{}'); y = JSON.parse(b || '{}'); } catch {} return DB_SETS.filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k])).map((k) => 'db:' + k); };

  function remoteKeys(changes) { const ks = []; Object.entries(changes).forEach(([k, [before, after]]) => { if (k === 'xw.db.v1') ks.push(...dbDiff(before, after)); else ks.push(k); }); return ks; }

  // ---------- conflict check — called by XENO_NET before any save goes out ----------
  function conflict(op) {
    const hits = keysOf(op).map((k) => seen[k]).filter((s) => s && s.at > actionAt);
    return hits.length ? hits.sort((a, b) => b.at - a.at)[0] : null;
  }
  async function resolve(op, label) {
    const c = conflict(op); if (!c) return 'go';
    const v = await D().form({ title: `${c.by} changed this while you were working`, sub: `${c.what || 'They saved a change to the same records'} — ${Math.max(1, Math.round((now() - c.at) / 1000))} s ago.`, submit: 'Review their change', size: 'sm',
      fields: [{ id: 'x', label: 'Your change', type: 'choice', cols: 1, value: 'review', options: [['review', 'Review their change first', 'Your change is not saved; the page shows theirs'], ['keep', `Keep mine — replace ${c.by}’s change`, 'Saves yours over theirs, on purpose']] }] });
    if (!v || v.x === 'review') { X().render(); return 'review'; }
    actionAt = now(); return 'go';
  }

  // ---------- apply a change that came from someone else ----------
  function applyRemote(evt) {
    const at = evt.at || now(); quietUntil = now() + 800;
    (evt.keys || []).forEach((k) => { seen[k] = { at, by: evt.by, what: evt.what }; const sk = storageKey(k); try { seenVals[sk] = { at, val: localStorage.getItem(sk) }; } catch {} });
    window.XENO_DB?.reload?.(); window.XENO_WF?.reload?.(); window.XD?.applyPrefs?.(); window.XENO_PG_SYNC_NAV?.();
    if (!document.querySelector('.xd')) X().render();
    note(evt);
    window.XENO_LIVE_LOG.push(evt);
  }
  function note(evt) {
    const here = !evt.route || route().startsWith(evt.route);
    const t = document.getElementById('toast'); if (!t) return;
    t.innerHTML = `<b>${esc(evt.by)}</b> ${esc(evt.what || 'changed something')}${!here && evt.route ? ` <button class="pg-undo" data-live-go="${esc(evt.route)}">Show</button>` : ''}`;
    t.classList.add('on'); clearTimeout(t._lvT); t._lvT = setTimeout(() => t.classList.remove('on'), 4200);
    if (here) { const m = document.getElementById('main'); m?.classList.remove('lv-flash'); void m?.offsetWidth; m?.classList.add('lv-flash'); }
  }
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-live-go]'); if (!b) return; location.hash = '#/' + b.dataset.liveGo; });

  // ---------- other windows (real): every local write is announced; other windows apply it ----------
  let pending = {}, flushT = 0, applying = false;
  const rawSet = Storage.prototype.setItem, rawRemove = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (k, v) { if (this === window.localStorage && !applying && String(k).startsWith('xw.') && !String(k).startsWith('xw.live')) { if (!(k in pending)) pending[k] = [this.getItem(k), null]; pending[k][1] = v; clearTimeout(flushT); flushT = setTimeout(flush, 120); } return rawSet.call(this, k, v); };
  Storage.prototype.removeItem = function (k) { if (this === window.localStorage && !applying && String(k).startsWith('xw.') && !String(k).startsWith('xw.live')) { if (!(k in pending)) pending[k] = [this.getItem(k), null]; clearTimeout(flushT); flushT = setTimeout(flush, 120); } return rawRemove.call(this, k); };
  // only REAL changes are announced: an identical re-save, or the echo of a change we just received, says nothing
  let quietUntil = 0;
  function flush() { const ch = pending; pending = {}; if (now() < quietUntil) return; Object.keys(ch).forEach((k) => { if (ch[k][0] === ch[k][1]) delete ch[k]; }); const keys = remoteKeys(ch).filter((k) => !/^xw\.(introSeen|workspace)$/.test(k)); if (!keys.length) return;
    try { rawSet.call(localStorage, 'xw.live.evt', JSON.stringify({ tab: TAB, by: 'You (another window)', keys, what: 'saved a change in another window', route: route(), at: now(), n: Math.random() })); } catch {} }
  window.addEventListener('storage', (e) => {
    if (e.key === 'xw.live.evt' && e.newValue) { try { const evt = JSON.parse(e.newValue); if (evt.tab !== TAB) applyRemote(evt); } catch {} }
    if (e.key && e.key.startsWith('xw.live.here.')) pile();
  });

  // ---------- presence ----------
  function heartbeat() { try { rawSet.call(localStorage, 'xw.live.here.' + TAB, JSON.stringify({ route: route(), at: now() })); } catch {} }
  const windows = () => { const out = []; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('xw.live.here.') && k !== 'xw.live.here.' + TAB) { const v = JSON.parse(localStorage.getItem(k)); if (now() - v.at < 15000) out.push(v); else rawRemove.call(localStorage, k); } } } catch {} return out; };
  const ROSTER = [['Mira Chen', 'human', /^.*projects\/Brand refresh/], ['Atlas', 'agent', /places|anima\/Atlas/], ['Nova', 'human', /community\/th_0|community$/], ['Juno', 'agent', /workspace\/Company|market\/Seller/]];
  const sim = () => SS.get('teammates', 'off') === 'on';
  function present() { const r = route(); const ppl = sim() ? ROSTER.filter(([, , re]) => re.test(r)).map(([n, k]) => ({ name: n, kind: k })) : []; windows().filter((w) => w.route === r).forEach(() => ppl.push({ name: 'You', kind: 'window' })); return ppl; }
  function pile() {
    const bar = document.querySelector('#main .topbar'); if (!bar) return;
    let el = bar.querySelector('.lv-pile'); const ppl = present();
    if (!ppl.length) { el?.remove(); return; }
    if (!el) { el = document.createElement('div'); el.className = 'lv-pile'; const acts = bar.querySelector('.pg-top-acts'); acts ? bar.insertBefore(el, acts) : bar.appendChild(el); }
    const names = ppl.map((p) => (p.kind === 'window' ? 'you in another window' : p.name));
    const sig = names.join('|'); if (el.dataset.sig === sig) return; el.dataset.sig = sig;
    el.setAttribute('role', 'status'); el.setAttribute('aria-label', `Here now: ${names.join(', ')}`); el.title = `Here now: ${names.join(', ')}`;
    el.innerHTML = ppl.slice(0, 4).map((p) => `<span class="lv-face${p.kind === 'agent' ? ' ag' : p.kind === 'window' ? ' win' : ''}" aria-hidden="true">${esc(p.kind === 'window' ? '⧉' : p.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2))}</span>`).join('') + `<small aria-hidden="true">${ppl.length === 1 ? esc(names[0]) + ' is here' : ppl.length + ' here'}</small>`;
  }
  new MutationObserver(() => pile()).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', () => { heartbeat(); pile(); });
  setInterval(() => { heartbeat(); pile(); }, 5000); heartbeat();
  window.addEventListener('beforeunload', () => { try { rawRemove.call(localStorage, 'xw.live.here.' + TAB); } catch {} });

  // ---------- simulated teammates: real changes to real records, announced like any remote change ----------
  const LS = { get(k, d) { try { const v = localStorage.getItem('xw.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } } };
  const write = (k, v) => { applying = true; try { rawSet.call(localStorage, 'xw.' + k, JSON.stringify(v)); } finally { applying = false; } };
  const writeDb = (mut) => { applying = true; try { const db = JSON.parse(localStorage.getItem('xw.db.v1') || 'null'); if (!db) return false; mut(db); rawSet.call(localStorage, 'xw.db.v1', JSON.stringify(db)); return true; } finally { applying = false; } };
  const ACTS = [
    { id: 'reply', route: 'overview/g/community/th_0', by: 'Nova', what: 'replied in “How do I export a Canvas frame as SVG…”', keys: ['db:forum'], run() { return writeDb((db) => { const t = (db.forum || []).find((x) => x.id === 'th_0'); if (!t) return; if (!t.posts) { const mem = (window.XENO_PG_FORUM || []).find((x) => x.id === 'th_0'); t.posts = mem?.posts ? JSON.parse(JSON.stringify(mem.posts)) : []; } t.posts.push({ id: 'th_0_n' + now(), author: { name: 'Nova', kind: 'human' }, body: 'Confirmed on 0.39.2 — export keeps live text now.', at: new Date().toISOString() }); t.replies = (t.replies || 0) + 1; t.lastActivityAt = new Date().toISOString(); }); } },
    { id: 'budget', route: 'studio/g/projects/Brand refresh', by: 'Mira Chen', what: 'raised the budget of “Homepage and product pages” to 2,600 cr', keys: ['xw.funding'], run() { const all = LS.get('funding', null); const f = all && all['Brand refresh']; const m = f?.milestones.find((x) => x.id === 'm2'); if (!m) return false; m.budget = 2600; write('funding', all); return true; } },
    { id: 'ledger', route: 'overview/g/workspace/Company', by: 'Juno', what: 'filed an invoice — 480 cr out of the company wallet', keys: ['xw.company'], run() { const all = LS.get('company', null); const c = all && all.xeno; if (!c) return false; c.wallet.ledger.push({ at: now(), what: 'Agent runs — Juno (invoice filing)', amt: -480, kind: 'out', scope: 'Juno' }); write('company', all); return true; } },
    { id: 'title', route: 'overview/g/workspace/Company', by: 'Mira Chen', what: 'renamed the company to “XENO Corporation”', keys: ['xw.company'], run() { const all = LS.get('company', null); const c = all && all.xeno; if (!c) return false; c.name = 'XENO Corporation'; write('company', all); return true; } },
  ];
  // a teammate's change is a real change: this window applies it, and EVERY other window is told too — otherwise a window
  // that missed it would later save its stale copy over it
  function act(id) { const a = ACTS.find((x) => x.id === id) || ACTS.find((x) => route().startsWith(x.route)) || ACTS[0]; if (!a.run()) return false; const evt = { tab: TAB, by: a.by, what: a.what, keys: a.keys, route: a.route, at: now() };
    applyRemote(evt); try { rawSet.call(localStorage, 'xw.live.evt', JSON.stringify({ ...evt, n: Math.random() })); } catch {} return a; }
  // when switched on, a teammate acts now and then — preferring the page you are on, so you see it happen
  let simT = 0; function schedule() { clearTimeout(simT); if (!sim()) return; simT = setTimeout(() => { if (!document.hidden) { const here = ACTS.filter((a) => route().startsWith(a.route)); act((here.length ? here : ACTS)[Math.floor(Math.random() * (here.length || ACTS.length))].id); } schedule(); }, 25000 + Math.random() * 15000); }
  schedule();
  // after a rollback, put back what others changed since `since` — a rollback undoes yours, never theirs
  function reapply(since) {
    const back = Object.entries(seenVals).filter(([, v]) => v.at > since); if (!back.length) return false;
    applying = true; try { back.forEach(([sk, v]) => { if (v.val == null) rawRemove.call(localStorage, sk); else rawSet.call(localStorage, sk, v.val); }); } finally { applying = false; }
    window.XENO_DB?.reload?.(); window.XENO_WF?.reload?.(); return true;
  }
  window.XENO_LIVE_LOG = [];
  window.XENO_LIVE = { reapply, conflict, resolve, applyRemote, act, present, sim, setSim: (on) => { SS.set('teammates', on ? 'on' : 'off'); schedule(); pile(); }, keysOf, ACTS };
})();
