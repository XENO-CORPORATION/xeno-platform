/* XENO_AGENT_REMOTE — XENO Agent in the workspace: the chats your PCs share, where you work on them.
 * Decision: xeno-agent-interface docs/decisions/0006-remote-control-end-to-end.md, amendment of 2026-11-14.
 *
 *   Cloud           /workspace/<mode>/apps/agent                       your own cloud machine: somewhere to type at once
 *   a cloud chat    /workspace/<mode>/apps/agent/cloud/c/<chat>
 *   Your PCs        /workspace/<mode>/apps/agent/pcs                   every PC on your account, and Connect
 *   a PC            /workspace/<mode>/apps/agent/pc/<pc>               the chats it shares, and its projects
 *   a shared chat   /workspace/<mode>/apps/agent/pc/<pc>/c/<chat>
 *   in a project    /workspace/<mode>/apps/agent/pc/<pc>/w/<project>[/c/<chat>]
 *
 * The chats are end-to-end encrypted, so the platform cannot read or list them. The page that can is
 * remote.xenosystem.ai, which holds the keys in its own origin. It is shown here in a frame: this page cannot read into
 * it, and the only thing it is told is which view is open (ids, never a name or a word of a chat). It asks this page for
 * one thing: a sign-in code, so the person does not sign in twice (see signInTheFrame). The address above is
 * that view, so a reload, Back and a copied link land on the same chat.
 *
 * Like the chat's frame, this one is attached to the document once and laid over its slot, so the workspace redrawing
 * itself never reloads it and the connection to the PC stays up. */
(() => {
  const X = () => window.XW;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  /** Where the remote page is served. Only a test replaces it. */
  const ORIGIN = () => window.XENO_REMOTE_ORIGIN || 'https://remote.xenosystem.ai';
  const ID = '[A-Za-z0-9_-]{1,128}';
  const VIEW = new RegExp(`^(?:pcs|cloud(?:/c/${ID})?|pc/${ID}(?:/c/${ID}|/w/${ID}(?:/c/${ID})?)?)$`);
  /** The view an address or a message names, or '' for where the page opens (the person's cloud machine). Anything else is not a view of ours. */
  const viewOf = (text) => { const v = String(text || '').replace(/^\/+|\/+$/g, ''); return VIEW.test(v) ? v : ''; };
  const onAgent = () => { const s = X()?.S; return !!s && s.view === 'product' && s.product === 'agent'; };
  const here = () => (onAgent() ? viewOf(X().S.item) : '');

  const style = document.createElement('style');
  style.textContent = '.xar-host{position:relative;height:100%;min-height:320px;display:grid;place-items:center;color:var(--dim);font-size:13px}'
    // the side frame lies over the left panel, which sits at z-index 20 (.slot), so it is drawn just above it
    + '#xw-agent-remote,#xw-agent-remote-side{position:fixed;z-index:3;border:0;background:var(--panel);display:none}#xw-agent-remote-side{z-index:21}#xw-agent-remote.on,#xw-agent-remote-side.on{display:block}'
    + 'html.modal-open #xw-agent-remote,html.xw-splitting #xw-agent-remote,html.modal-open #xw-agent-remote-side,html.xw-splitting #xw-agent-remote-side{pointer-events:none}';
  document.head.appendChild(style);

  let frame = null, side = null, slot = null, ro = null, shown = null, signedIn = null, watched = null, settle = 0;

  /**
   * Two frames of the agent page (owner, 2026-11-15: "the right conversation panel is the only one we need to mount on
   * the right side, and on the left side sidebar extension, we mount parts of the elements from the sidebar of agent
   * interface"). The conversation lies over the main area's slot, under the breadcrumb. `/side` lies over the left
   * panel's body, under the header that panel already has, and the agent page draws its own sidebar into it: both
   * frames are its own site, so nothing of the chats passes through this page. A panel the person folded away has no
   * width, and the agent page then draws its sidebar beside the conversation again.
   */
  const over = (el, r) => Object.assign(el.style, { left: r.left + 'px', top: r.top + 'px', width: Math.max(0, r.width) + 'px', height: Math.max(0, r.height) + 'px' });
  function fit() {
    if (!slot || !frame) return;
    over(frame, slot.getBoundingClientRect());
    const main = document.getElementById('main');
    if (main) { const br = getComputedStyle(main).borderBottomLeftRadius; frame.style.borderRadius = `0 0 ${br} ${br}`; }
    const body = document.querySelector('#panel .pbody'), b = body ? body.getBoundingClientRect() : null;
    // folded, the workspace makes its panel inert and slides it away (its width stays): that is the sign it is closed
    const panelEl = document.getElementById('panel');
    const open = !!b && !!panelEl && !panelEl.inert && b.width > 120 && b.height > 1;
    if (side) {
      // folded, the side frame is given no width rather than hidden: the agent page inside it sees its width go to
      // nothing, and draws its sidebar beside the conversation again (a hidden frame does not reliably tell it)
      if (!open && b) over(side, { left: b.left, top: b.top, width: 0, height: b.height });
      if (open) {
        // the body's own padding is the panel's: the sidebar takes the whole width of the panel, edge to edge
        const panel = document.getElementById('panel').getBoundingClientRect();
        over(side, { left: panel.left, top: b.top, width: panel.width, height: panel.bottom - b.top });
        const pr = getComputedStyle(document.getElementById('panel')).borderBottomLeftRadius;
        side.style.borderRadius = `0 0 ${pr} ${pr}`;
      }
      side.classList.toggle('on', !!b);
      side.style.pointerEvents = open ? '' : 'none';
    }
    if (open) under(true); else if (body) body.removeAttribute('inert');
  }

  /**
   * The agent's sidebar in this panel is drawn in this panel's look (owner, 2026-11-15: "the design on the left sidebar
   * should be in the design of the platform, not the app"). Its sizes are fixed on the agent page; its colours are this
   * page's own, sent as resolved colours so they follow the person's theme and brightness. Sent when the side page asks,
   * and again whenever they change. Colours only: nothing else of this page crosses.
   */
  const LOOK = { canvas: '--canvas', rail: '--rail', panel: '--panel', elevated: '--elevated', control: '--control', active: '--hover-strong', hover: '--hover', border: '--border', text: '--text', muted: '--muted', dim: '--dim' };
  let lookSent = '';
  function look() {
    const probe = document.createElement('i'); probe.style.display = 'none'; document.body.appendChild(probe);
    const out = {};
    for (const [name, v] of Object.entries(LOOK)) { probe.style.color = `var(${v})`; out[name] = getComputedStyle(probe).color; }
    probe.remove();
    return out;
  }
  function sendLook(force) {
    const now = look(), text = JSON.stringify(now);
    if (!force && text === lookSent) return;
    lookSent = text;
    // both frames wear it: the sidebar in the panel, and the conversation in the main area
    for (const f of [side, frame]) { try { f?.contentWindow?.postMessage({ type: 'xeno-remote:look', look: now }, ORIGIN()); } catch {} }
  }

  /** What the frame covers cannot be seen, so it must not be reachable with the keyboard either. The panel's header stays the person's. */
  function under(covered) { const el = document.querySelector('#panel .pbody'); if (el) el.toggleAttribute('inert', covered); }

  function place() {
    const el = document.querySelector('#main .xar-host[data-xar-frame]');
    if (!el) { if (slot) { slot = null; watched = null; ro?.disconnect(); under(false); } clearTimeout(settle); frame?.classList.remove('on'); side?.classList.remove('on'); return; }
    if (el !== slot) { slot = el; watched = null; ro?.disconnect(); ro = new ResizeObserver(fit); ro.observe(el); for (const id of ['main', 'slot']) { const part = document.getElementById(id); if (part) ro.observe(part); } }
    const want = here();
    if (!frame) {
      frame = document.createElement('iframe'); frame.id = 'xw-agent-remote'; frame.title = 'XENO Agent on your PCs';
      frame.setAttribute('allow', 'clipboard-read; clipboard-write');
      frame.src = `${ORIGIN()}/${want}`; shown = want;
      document.body.appendChild(frame);
      // the place the agent page draws its sidebar into: its own site, found by the agent page among this page's frames
      side = document.createElement('iframe'); side.id = 'xw-agent-remote-side'; side.title = 'XENO Agent: chats and projects';
      side.name = 'xeno-agent-side'; side.src = `${ORIGIN()}/side`;
      document.body.appendChild(side);
    } else if (want !== shown) { shown = want; frame.src = `${ORIGIN()}/${want}`; }   // the address changed here (Back, a link): the frame follows
    frame.classList.add('on'); fit();
    // the panel is drawn anew with the page and may still be settling (its header animates in): the frame is laid
    // again once it has, and whenever the panel's body changes size
    const body = document.querySelector('#panel .pbody');
    if (body && body !== watched) { watched = body; ro?.observe(body); }
    clearTimeout(settle); settle = setTimeout(fit, 400);
  }

  /**
   * The frame asks for a sign-in code. The person is signed in here, so this page asks the sign-in server for a code for
   * the FRAME'S OWN request and hands it back: no second sign-in. The code only works with a secret that never leaves
   * the frame (PKCE), so this page cannot use it. Everything but the frame's own values is fixed here: the app it is
   * for, where the code may be sent, and what it may do. A frame asking for anything else gets no code.
   */
  const B64 = /^[A-Za-z0-9_-]{16,128}$/;
  const SCOPE = 'openid profile remote:connect';
  async function signInTheFrame(d, reply) {
    const none = () => reply({ type: 'xeno-remote:code', state: typeof d.state === 'string' ? d.state : '', code: null });
    const P = window.XENO_PLATFORM;
    if (!P || !P.served || d.clientId !== 'xeno-remote-web' || d.redirectUri !== `${ORIGIN()}/callback` || d.scope !== SCOPE
      || ![d.state, d.nonce, d.codeChallenge].every((v) => typeof v === 'string' && B64.test(v))) return none();
    const r = await P.api('POST', '/api/oauth2/authorize', { client_id: 'xeno-remote-web', redirect_uri: `${ORIGIN()}/callback`, scope: SCOPE, state: d.state, nonce: d.nonce, code_challenge: d.codeChallenge, code_challenge_method: 'S256' }).catch(() => null);
    const code = r && r.ok && r.d && typeof r.d.code === 'string' ? r.d.code : null;
    reply({ type: 'xeno-remote:code', state: d.state, code });
  }

  /**
   * The frame asks for a cloud session. This page, where the person is signed in, asks the platform to start their
   * Cloud Agent machine and to give a one-use ticket for its Agent host, and hands the frame that ticket. The ticket
   * opens one socket to that one machine's one port, lives 60 seconds and is spent on use; nothing longer-lived leaves
   * this page. A refusal goes back in the platform's own words (not open to this account, no credits, a cap).
   */
  async function openCloudForTheFrame(d, reply) {
    const state = typeof d.state === 'string' && /^[0-9a-f]{36}$/.test(d.state) ? d.state : '';
    const answer = (extra) => reply({ type: 'xeno-remote:cloud-session', state, ...extra });
    const P = window.XENO_PLATFORM;
    if (!state) return;
    if (!P || !P.served) return answer({ session: null, error: 'A cloud session needs the XENO workspace.' });
    const r = await P.api('POST', '/api/compute/cloud-agent', {}).catch(() => null);
    const a = r && r.ok && r.d && r.d.agent;
    if (!a || !a.connect) return answer({ session: null, error: (r && r.d && r.d.error) || 'The cloud session could not start.' });
    answer({ session: { machineId: a.machineId, path: a.connect.path, protocols: a.connect.protocols } });
  }

  /**
   * The frame asks how the person's cloud machine stands: whether Cloud is open to them, and whether they have a
   * machine and it is running. Nothing is started. The page draws itself at once from this and from what it
   * remembers, and asks for a session (above) only when there is work for the machine.
   */
  async function cloudStandingForTheFrame(d, reply) {
    const state = typeof d.state === 'string' && /^[0-9a-f]{36}$/.test(d.state) ? d.state : '';
    if (!state) return;
    const P = window.XENO_PLATFORM;
    if (!P || !P.served) return reply({ type: 'xeno-remote:cloud-standing', state, status: null });
    const r = await P.api('GET', '/api/compute/cloud-agent').catch(() => null);
    const a = r && r.ok && r.d && r.d.agent;
    reply({ type: 'xeno-remote:cloud-standing', state, status: a && typeof a.enabled === 'boolean'
      ? { enabled: a.enabled, machineId: a.machineId || null, state: a.state || null, lastActiveAt: a.lastActiveAt || null } : null });
  }

  // The frame says which view it shows, or asks for its sign-in code or a cloud session. Only its own origin and its own window are
  // listened to, and only messages of the known shapes are taken.
  addEventListener('message', (event) => {
    if (side && event.origin === ORIGIN() && event.source === side.contentWindow) { if (event.data && event.data.type === 'xeno-remote:look-wanted') sendLook(true); return; }
    if (!frame || event.origin !== ORIGIN() || event.source !== frame.contentWindow) return;
    const d = event.data;
    if (d && d.type === 'xeno-remote:look-wanted') { sendLook(true); return; }
    if (d && d.type === 'xeno-remote:cloud-status') { void cloudStandingForTheFrame(d, (m) => { try { frame.contentWindow.postMessage(m, ORIGIN()); } catch {} }); return; }
    if (d && d.type === 'xeno-remote:cloud') { void openCloudForTheFrame(d, (m) => { try { frame.contentWindow.postMessage(m, ORIGIN()); } catch {} }); return; }
    if (d && d.type === 'xeno-remote:authorize') { void signInTheFrame(d, (m) => { try { frame.contentWindow.postMessage(m, ORIGIN()); } catch {} }); return; }
    if (!d || d.type !== 'xeno-remote:view' || typeof d.path !== 'string') return;
    const was = signedIn; signedIn = d.signedIn === true;
    const view = viewOf(d.path);
    if (view !== shown && onAgent()) { shown = view; X().go('product', { product: 'agent', item: view || null }); }
    else if (was !== signedIn) { try { X()?.render?.(); } catch {} }
  });

  const page = () => `<div class="xar-host" data-xar-frame>Opening XENO Agent…</div>`;

  /** The breadcrumb for a view. The names of a PC and a chat are inside the encrypted page, so the trail says what kind of place it is. */
  const trail = (item) => { const v = viewOf(item); if (!v) return ['Cloud']; if (v === 'pcs') return ['Your PCs']; if (v.startsWith('cloud')) return ['Cloud', 'Chat']; return /\/c\//.test(v) ? ['A PC', 'Chat'] : /\/w\//.test(v) ? ['A PC', 'Project'] : ['A PC']; };

  // The workspace's own left panel is under the frame here: the agent's panel is the left panel (see fit). It is left
  // empty, so nothing that cannot be seen can be reached with the keyboard.
  const panel = () => '<div class="xar-under" aria-hidden="true"></div>';

  // The slot is drawn anew whenever the workspace redraws, at any depth, so the whole main area is watched, and the left panel
  // too, since its body is part of what the frame lies over; one look per frame is enough.
  let due = false;
  const soon = () => { if (due) return; due = true; requestAnimationFrame(() => { due = false; place(); }); };
  const watch = () => { const main = document.getElementById('main'); if (!main) return setTimeout(watch, 50); const seen = new MutationObserver(soon); seen.observe(main, { childList: true, subtree: true }); const sidePanel = document.getElementById('panel'); if (sidePanel) seen.observe(sidePanel, { childList: true, attributes: true, attributeFilter: ['inert'] }); sidePanel?.addEventListener('transitionend', fit); main.addEventListener('transitionend', fit); place(); };
  addEventListener('resize', fit);
  new MutationObserver(() => sendLook(false)).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-mode'] });
  watch();

  window.XENO_AGENT_REMOTE = { page, trail, panel, viewOf };
})();
