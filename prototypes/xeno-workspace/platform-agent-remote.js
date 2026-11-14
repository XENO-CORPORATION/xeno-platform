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
    + '#xw-agent-remote{position:fixed;z-index:3;border:0;background:var(--panel);display:none}#xw-agent-remote.on{display:block}'
    + 'html.modal-open #xw-agent-remote,html.xw-splitting #xw-agent-remote{pointer-events:none}';
  document.head.appendChild(style);

  let frame = null, slot = null, ro = null, shown = null, signedIn = null;

  function fit() {
    if (!slot || !frame) return;
    const r = slot.getBoundingClientRect(), main = document.getElementById('main');
    Object.assign(frame.style, { left: r.left + 'px', top: r.top + 'px', width: Math.max(0, r.width) + 'px', height: Math.max(0, r.height) + 'px' });
    if (main) { const br = getComputedStyle(main).borderBottomLeftRadius; frame.style.borderRadius = `0 0 ${br} ${br}`; }
  }

  function place() {
    const el = document.querySelector('#main .xar-host[data-xar-frame]');
    if (!el) { if (slot) { slot = null; ro?.disconnect(); } frame?.classList.remove('on'); return; }
    if (el !== slot) { slot = el; ro?.disconnect(); ro = new ResizeObserver(fit); ro.observe(el); const main = document.getElementById('main'); if (main) ro.observe(main); }
    const want = here();
    if (!frame) {
      frame = document.createElement('iframe'); frame.id = 'xw-agent-remote'; frame.title = 'XENO Agent on your PCs';
      frame.setAttribute('allow', 'clipboard-read; clipboard-write');
      frame.src = `${ORIGIN()}/${want}`; shown = want;
      document.body.appendChild(frame);
    } else if (want !== shown) { shown = want; frame.src = `${ORIGIN()}/${want}`; }   // the address changed here (Back, a link): the frame follows
    frame.classList.add('on'); fit();
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

  // The frame says which view it shows, or asks for its sign-in code or a cloud session. Only its own origin and its own window are
  // listened to, and only messages of the known shapes are taken.
  addEventListener('message', (event) => {
    if (!frame || event.origin !== ORIGIN() || event.source !== frame.contentWindow) return;
    const d = event.data;
    if (d && d.type === 'xeno-remote:cloud') { void openCloudForTheFrame(d, (m) => { try { frame.contentWindow.postMessage(m, ORIGIN()); } catch {} }); return; }
    if (d && d.type === 'xeno-remote:authorize') { void signInTheFrame(d, (m) => { try { frame.contentWindow.postMessage(m, ORIGIN()); } catch {} }); return; }
    if (!d || d.type !== 'xeno-remote:view' || typeof d.path !== 'string') return;
    const was = signedIn; signedIn = d.signedIn === true;
    const view = viewOf(d.path);
    if (view !== shown && onAgent()) { shown = view; X().go('product', { product: 'agent', item: view || null }); }
    else if (was !== signedIn) { try { X()?.render?.(); } catch {} }
  });

  const page = () => `<div class="xar-host" data-xar-frame>Opening your PCs…</div>`;

  /** The breadcrumb for a view. The names of a PC and a chat are inside the encrypted page, so the trail says what kind of place it is. */
  const trail = (item) => { const v = viewOf(item); if (!v) return ['Cloud']; if (v === 'pcs') return ['Your PCs']; if (v.startsWith('cloud')) return ['Cloud', 'Chat']; return /\/c\//.test(v) ? ['A PC', 'Chat'] : /\/w\//.test(v) ? ['A PC', 'Project'] : ['A PC']; };

  const panel = () => {
    const ic = (k) => (X() ? X().ic(k) : '');
    const at = here();
    return `<div class="views"><button class="row" aria-current="${at === '' || at.startsWith('cloud')}" data-item="" data-item-exact>${ic('bot')}<span class="t">Cloud</span></button><button class="row" aria-current="${at === 'pcs' || at.startsWith('pc/')}" data-item="pcs" data-item-exact>${ic('side')}<span class="t">Your PCs</span></button></div>
      <div class="empty-note"><b>Where it runs</b><span>Cloud is your own XENO machine: it starts when you type, keeps working after you close the tab, and its time is paid from your credits. Your PCs run it on your own computer, end-to-end encrypted: connect one once, then open a chat you shared with /remote or start a new one.${signedIn === false ? ' Sign in on the right to see your PCs.' : ''}</span></div>
      <button class="act" data-xl-download="agent">${ic('download')}Get XENO Agent for your PC</button>`;
  };

  // The slot is drawn anew whenever the workspace redraws, at any depth, so the whole main area is watched; one look per frame is enough.
  let due = false;
  const soon = () => { if (due) return; due = true; requestAnimationFrame(() => { due = false; place(); }); };
  const watch = () => { const main = document.getElementById('main'); if (!main) return setTimeout(watch, 50); new MutationObserver(soon).observe(main, { childList: true, subtree: true }); main.addEventListener('transitionend', fit); place(); };
  addEventListener('resize', fit);
  watch();

  window.XENO_AGENT_REMOTE = { page, trail, panel, viewOf };
})();
