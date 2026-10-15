/* XENO_MCP — XENO MCP: one hosted address every agent connects to, managed here. A Dev product, real platform API.
 * Spec: XENO AGENT SURFACES & CONNECTORS - SPEC.md §7.
 *
 *   Connections   /workspace/dev/apps/mcp              every agent signed in to XENO MCP, and how to connect one
 *   a connection  /workspace/dev/apps/mcp/c/<id>       by id: its services, its recent calls, Disconnect
 *   Activity      /workspace/dev/apps/mcp/activity     every call, newest first — what was called, never what was sent
 *
 *   GET /api/mcp/connections · GET|PATCH|DELETE /api/mcp/connections/:id · GET /api/mcp/activity · GET /api/mcp/services
 *
 * Nothing is invented: from disk (no platform) it says it needs the platform. */
(() => {
  const P = window.XENO_PLATFORM;
  const X = () => window.XW;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const S = { key: null, status: 'idle', conns: [], services: [], one: null, calls: [], note: '', busy: false, copied: '' };
  const api = (...a) => P.api(...a).catch(() => ({ ok: false, d: {} }));
  const whyNot = (r, fallback) => (r && r.d && (r.d.error || r.d.message)) || fallback;
  const go = (item) => X()?.go?.('product', { product: 'mcp', item: item || null });
  const paint = () => { try { X()?.render?.(); } catch {} };
  const say = (text) => { S.note = text; paint(); clearTimeout(say.t); say.t = setTimeout(() => { S.note = ''; paint(); }, 4200); };
  const ENDPOINT = () => `${location.origin}/api/mcp`;

  /** Where the address says we are. An id read before its list loads is kept and resolved when it arrives. */
  const here = () => {
    const it = X()?.S?.item || '';
    const c = /^c\/([0-9a-f-]{36})$/i.exec(it);
    return c ? { kind: 'one', id: c[1].toLowerCase() } : it === 'activity' ? { kind: 'activity' } : { kind: 'list' };
  };

  const ago = (iso) => {
    if (!iso) return 'Never';
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    return s < 60 ? 'Just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
  };
  const OUTCOME = { ok: 'OK', tool_error: 'Tool error', refused: 'Refused', timeout: 'Timed out', failed: 'Failed' };

  async function load() {
    if (!P || !P.served) { S.status = 'offline'; return paint(); }
    const at = here();
    const [svc, list] = await Promise.all([S.services.length ? null : api('GET', '/api/mcp/services'), api('GET', '/api/mcp/connections')]);
    if (svc && svc.ok) S.services = svc.d.services || [];
    if (!list.ok) { S.status = 'error'; return paint(); }
    S.conns = list.d.connections || [];
    if (at.kind === 'one') {
      const [one, calls] = await Promise.all([api('GET', `/api/mcp/connections/${encodeURIComponent(at.id)}`), api('GET', `/api/mcp/activity?connection=${encodeURIComponent(at.id)}&limit=50`)]);
      if (one.status === 404) { S.status = 'missing'; return paint(); }
      if (!one.ok) { S.status = 'error'; return paint(); }
      S.one = one.d.connection; S.calls = calls.ok ? calls.d.calls || [] : [];
    } else if (at.kind === 'activity') {
      const calls = await api('GET', '/api/mcp/activity?limit=200');
      S.calls = calls.ok ? calls.d.calls || [] : [];
    }
    S.status = 'ready'; paint();
  }

  // ───────── the connect panel: one address, and how to add it to each agent
  // Each client's own syntax (checked against its docs, 2026-10-15). Codex signs in as a separate step.
  const CLIENTS = [
    ['XENO Agent CLI', () => `xeno mcp add xeno --http ${ENDPOINT()}`],
    ['Claude Code', () => `claude mcp add --transport http xeno ${ENDPOINT()}`],
    ['Codex', () => `codex mcp add xeno --url ${ENDPOINT()}\ncodex mcp login xeno`],
    ['Cursor', () => JSON.stringify({ mcpServers: { xeno: { url: ENDPOINT() } } }, null, 2)],
  ];
  const connect = () => `<section class="xmc-connect" aria-label="Connect an agent">
      <div class="xmc-connect-h"><b>Connect an agent</b><span>Add this one address to any agent. It opens your browser to sign in once, and appears below as its own connection.</span></div>
      <div class="xmc-addr"><code>${esc(ENDPOINT())}</code><button type="button" class="xmc-btn" data-xmc="copy" data-copy="${esc(ENDPOINT())}">${S.copied === ENDPOINT() ? 'Copied' : 'Copy'}</button></div>
      <div class="xmc-how">${CLIENTS.map(([name, cmd]) => `<div class="xmc-how-r"><span>${esc(name)}</span><pre>${esc(cmd())}</pre><button type="button" class="xmc-btn xmc-sm" data-xmc="copy" data-copy="${esc(cmd())}" aria-label="Copy the ${esc(name)} setup">${S.copied === cmd() ? 'Copied' : 'Copy'}</button></div>`).join('')}</div>
    </section>`;

  // ───────── the views
  const tabs = (at) => `<nav class="xmc-tabs" aria-label="XENO MCP">${[['list', 'Connections', ''], ['activity', 'Activity', 'activity']].map(([k, l, item]) => `<button type="button" data-xmc="tab" data-item="${item}"${at.kind === k || (k === 'list' && at.kind === 'one') ? ' aria-current="page"' : ''}>${l}</button>`).join('')}</nav>`;
  const svcName = (c) => (S.services.find((s) => s.category === c) || { title: c }).title;

  function connectionsView() {
    const rows = S.conns.map((c) => `<button type="button" class="xmc-row" data-xmc="open" data-id="${esc(c.id)}">
        <span class="xmc-face" aria-hidden="true">${esc(c.client.name.slice(0, 2).toUpperCase())}</span>
        <span class="xmc-who"><b>${esc(c.client.name)}</b><small>${c.categories.length ? esc(c.categories.map(svcName).join(' · ')) : 'Everything turned off'}</small></span>
        <span class="xmc-meta">${esc(ago(c.lastUsedAt))}</span><span class="xmc-meta">${Number(c.calls || 0)} call${Number(c.calls) === 1 ? '' : 's'}</span></button>`).join('');
    return `${connect()}<h3 class="xmc-h">Connected agents <em>${S.conns.length}</em></h3>
      <div class="xmc-list">${rows || '<div class="xmc-empty"><b>No agent is connected yet</b>Add the address above to an agent and sign in. It shows up here.</div>'}</div>`;
  }

  function callRows(calls, withClient) {
    if (!calls.length) return '<div class="xmc-empty"><b>No calls yet</b>Calls appear here as the agent uses XENO.</div>';
    return `<div class="xmc-calls-h"><span>Tool</span>${withClient ? '<span>Agent</span>' : ''}<span>Result</span><span>Time</span><span>When</span></div>` + calls.map((k) => `<div class="xmc-call" data-outcome="${esc(k.outcome)}">
        <code>${esc(k.tool)}</code>${withClient ? `<span>${esc(k.client)}</span>` : ''}<span class="xmc-out">${esc(OUTCOME[k.outcome] || k.outcome)}${k.errorCode && k.outcome !== 'ok' ? `<small>${esc(k.errorCode)}</small>` : ''}</span><span>${Number(k.latencyMs)} ms</span><span>${esc(ago(k.at))}</span></div>`).join('');
  }

  function oneView() {
    const c = S.one; if (!c) return '';
    const on = new Set(c.categories);
    const toolCount = S.services.filter((s) => on.has(s.category)).reduce((n, s) => n + s.tools, 0);
    const svcs = S.services.map((s) => `<label class="xmc-svc"><input type="checkbox" data-xmc-cat="${esc(s.category)}"${on.has(s.category) ? ' checked' : ''}${S.busy ? ' disabled' : ''}><span><b>${esc(s.title)}</b><small>${esc(s.description)} ${s.tools} tools.</small></span></label>`).join('');
    return `<div class="xmc-one-h"><span class="xmc-face xmc-face-lg" aria-hidden="true">${esc(c.client.name.slice(0, 2).toUpperCase())}</span>
        <div><h2>${esc(c.client.name)}</h2><small>Connected ${esc(ago(c.createdAt))} · last used ${esc(ago(c.lastUsedAt).toLowerCase())} · ${Number(c.calls || 0)} calls</small></div>
        <button type="button" class="xmc-btn xmc-danger" data-xmc="disconnect"${S.busy ? ' disabled' : ''}>Disconnect</button></div>
      <h3 class="xmc-h">What it can use</h3>
      <div class="xmc-svcs">${svcs}</div>
      <p class="xmc-hint">This agent sees ${toolCount} tool${toolCount === 1 ? '' : 's'}. A service turned off is hidden from it and refused if it asks anyway. If a change does not show, reconnect the agent.</p>
      <h3 class="xmc-h">Recent calls</h3>
      <div class="xmc-list xmc-calls">${callRows(S.calls, false)}</div>`;
  }

  const activityView = () => `<p class="xmc-hint">Every call any connected agent made: the tool, how it ended and how long it took. What the agent sent and got back is never stored.</p>
    <div class="xmc-list xmc-calls xmc-calls-wide">${callRows(S.calls, true)}</div>`;

  function page() {
    style();
    const at = here(), key = at.kind === 'one' ? `one:${at.id}` : at.kind;
    if (S.key !== key) { S.key = key; S.status = 'loading'; S.one = null; S.calls = []; setTimeout(load, 0); }
    if (!P || !P.served) return '<div class="xmc"><div class="xmc-empty"><b>XENO MCP is managed on the platform</b>Open it at xenosystem.ai.</div></div>';
    const body = S.status === 'loading' ? '<div class="xmc-empty" role="status">Loading</div>'
      : S.status === 'error' ? '<div class="xmc-empty"><b>This could not be loaded just now</b><button type="button" class="xmc-btn" data-xmc="retry">Try again</button></div>'
      : S.status === 'missing' ? '<div class="xmc-empty"><b>This connection is gone</b>It may have been disconnected. <button type="button" class="xmc-btn" data-xmc="tab" data-item="">Back to connections</button></div>'
      : at.kind === 'one' ? oneView() : at.kind === 'activity' ? activityView() : connectionsView();
    // the shell's breadcrumb names where you are (see trail below), so the page carries only its own tabs
    return `<div class="xmc" data-xmc-root="${esc(at.kind)}">${at.kind === 'one' ? '' : tabs(at)}
      ${S.note ? `<p class="xmc-note" role="status">${esc(S.note)}</p>` : ''}${body}</div>`;
  }

  // ───────── actions
  async function setCategories(next) {
    if (!S.one || S.busy) return;
    S.busy = true; paint();
    const r = await api('PATCH', `/api/mcp/connections/${encodeURIComponent(S.one.id)}`, { categories: next });
    S.busy = false;
    if (!r.ok) return say(whyNot(r, 'That could not be changed. It is as it was.'));
    S.one = r.d.connection; say('Saved. The agent sees the change on its next request.');
  }
  async function disconnect() {
    if (!S.one || S.busy) return;
    const name = S.one.client.name;
    if (!(await window.XD?.confirm?.({ title: `Disconnect ${name}?`, body: `${esc(name)} stops working with XENO on its next request, and its sign-in cannot be refreshed. To use it again, add the address and sign in again.`, action: 'Disconnect' }))) return;
    S.busy = true; paint();
    const r = await api('DELETE', `/api/mcp/connections/${encodeURIComponent(S.one.id)}`);
    S.busy = false;
    if (!r.ok) return say(whyNot(r, 'That could not be disconnected. It still works.'));
    X()?.toast?.(`Disconnected ${name}`); go(null);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); S.copied = text; paint(); clearTimeout(copy.t); copy.t = setTimeout(() => { S.copied = ''; paint(); }, 1600); }
    catch { say('Copy is blocked here. Select the text and copy it yourself.'); }
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-xmc]'); if (!b || !b.closest('.xmc')) return;
    const a = b.dataset.xmc;
    if (a === 'tab') return go(b.dataset.item || null);
    if (a === 'open') return go(`c/${b.dataset.id}`);
    if (a === 'retry') { S.key = null; return paint(); }
    if (a === 'copy') return copy(b.dataset.copy);
    if (a === 'disconnect') return disconnect();
  });
  document.addEventListener('change', (e) => {
    const c = e.target.closest('[data-xmc-cat]'); if (!c || !S.one) return;
    const next = [...document.querySelectorAll('.xmc [data-xmc-cat]')].filter((x) => x.checked).map((x) => x.dataset.xmcCat);
    setCategories(next);
  });

  const style = () => {
    if (document.getElementById('xmc-css')) return; const s = document.createElement('style'); s.id = 'xmc-css';
    s.textContent = '.xmc{display:flex;flex-direction:column;min-height:100%;padding:18px 28px 60px;max-width:1040px}'
      + '.xmc-top{display:flex;align-items:center;min-height:36px}.xmc-path{display:flex;align-items:center;gap:4px;font-size:18px;font-weight:600;letter-spacing:-.015em}'
      + '.xmc-path button{border:0;background:none;color:var(--muted);font:inherit;padding:4px 7px;margin-left:-7px;border-radius:6px;cursor:pointer}.xmc-path button:hover{color:var(--text);background:var(--hover)}.xmc-path i{font-style:normal;color:var(--dim);padding:0 2px}'
      + '.xmc-tabs{display:flex;gap:2px;margin:12px 0 0;border-bottom:1px solid var(--border)}.xmc-tabs button{border:0;background:none;color:var(--muted);font:inherit;font-size:13px;padding:8px 10px;margin-bottom:-1px;border-bottom:2px solid transparent;cursor:pointer}'
      + '.xmc-tabs button:hover{color:var(--text)}.xmc-tabs button[aria-current]{color:var(--text);border-bottom-color:var(--text)}'
      + '.xmc-note{margin:12px 0 0;padding:9px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;color:var(--text);background:var(--panel)}'
      + '.xmc-connect{margin-top:18px;padding:16px;border:1px solid var(--border);border-radius:12px;background:var(--panel)}'
      + '.xmc-connect-h{display:flex;flex-direction:column;gap:3px}.xmc-connect-h b{font-size:14px}.xmc-connect-h span{font-size:12.5px;color:var(--muted);line-height:1.5}'
      + '.xmc-addr{display:flex;align-items:center;gap:8px;margin:12px 0 0;padding:4px 4px 4px 12px;border:1px solid var(--border);border-radius:9px;background:var(--canvas)}.xmc-addr code{flex:1;min-width:0;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + '.xmc-how{display:flex;flex-direction:column;margin-top:12px;border-top:1px solid var(--border)}.xmc-how-r{display:grid;grid-template-columns:170px 1fr auto;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid var(--border)}.xmc-how-r:last-child{border-bottom:0}'
      + '.xmc-how-r span{font-size:12.5px;color:var(--muted)}.xmc-how-r pre{margin:0;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-all;color:var(--text)}'
      + '.xmc-btn{height:30px;padding:0 12px;border:1px solid var(--border);border-radius:8px;background:none;color:var(--text);font:inherit;font-size:12.5px;cursor:pointer;white-space:nowrap}.xmc-btn:hover{background:var(--hover)}.xmc-btn:disabled{opacity:.4;cursor:not-allowed}'
      + '.xmc-sm{height:26px;padding:0 9px;font-size:12px}.xmc-danger{color:#f87171;border-color:color-mix(in srgb,#f87171 40%,var(--border))}'
      + '.xmc-h{display:flex;align-items:center;gap:7px;margin:24px 0 8px;font-size:12px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:var(--muted)}.xmc-h em{font-style:normal;color:var(--dim);font-weight:500}'
      + '.xmc-list{border:1px solid var(--border);border-radius:12px;background:var(--panel);overflow:hidden}'
      + '.xmc-row{display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:14px;width:100%;padding:11px 14px;border:0;border-bottom:1px solid var(--border);background:none;color:var(--text);font:inherit;text-align:left;cursor:pointer}.xmc-row:last-child{border-bottom:0}.xmc-row:hover{background:var(--hover)}'
      + '.xmc-face{display:grid;place-items:center;width:32px;height:32px;border-radius:8px;background:var(--control);font-size:11.5px;font-weight:600}.xmc-face-lg{width:44px;height:44px;font-size:14px}'
      + '.xmc-who{display:flex;flex-direction:column;gap:2px;min-width:0}.xmc-who b{font-size:13.5px;font-weight:500}.xmc-who small{font-size:12px;color:var(--muted)}.xmc-meta{font-size:12px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}'
      + '.xmc-empty{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:22px 16px;font-size:13px;color:var(--muted)}.xmc-empty b{color:var(--text);font-size:14px}'
      + '.xmc-one-h{display:flex;align-items:center;gap:14px;margin-top:16px}.xmc-one-h>div{flex:1;min-width:0}.xmc-one-h h2{margin:0;font-size:18px;font-weight:600}.xmc-one-h small{font-size:12.5px;color:var(--muted)}'
      + '.xmc-svcs{display:flex;flex-direction:column;gap:6px}.xmc-svc{display:flex;align-items:flex-start;gap:11px;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:var(--panel);cursor:pointer}'
      + '.xmc-svc input{margin-top:2px;accent-color:var(--text)}.xmc-svc span{display:flex;flex-direction:column;gap:2px}.xmc-svc b{font-size:13.5px;font-weight:500}.xmc-svc small{font-size:12px;color:var(--muted);line-height:1.45}'
      + '.xmc-hint{margin:10px 0 0;font-size:12.5px;line-height:1.5;color:var(--muted)}'
      + '.xmc-calls-h,.xmc-call{display:grid;grid-template-columns:minmax(0,1.6fr) 1fr 80px 90px;gap:12px;align-items:center;padding:8px 14px;font-size:12.5px}'
      + '.xmc-calls-wide .xmc-calls-h,.xmc-calls-wide .xmc-call{grid-template-columns:minmax(0,1.4fr) minmax(0,1fr) 1fr 80px 90px}'
      + '.xmc-calls-h{color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.03em;border-bottom:1px solid var(--border)}.xmc-call{border-bottom:1px solid var(--border);color:var(--muted);font-variant-numeric:tabular-nums}.xmc-call:last-child{border-bottom:0}'
      + '.xmc-call code{color:var(--text);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.xmc-out{display:flex;flex-direction:column;color:var(--text)}.xmc-out small{color:var(--dim);font-size:11px}'
      + '.xmc-call[data-outcome="refused"] .xmc-out,.xmc-call[data-outcome="failed"] .xmc-out,.xmc-call[data-outcome="timeout"] .xmc-out{color:#f87171}'
      + '@media (max-width:720px){.xmc{padding:14px 16px 48px}.xmc-how-r{grid-template-columns:1fr auto}.xmc-how-r pre{grid-column:1/-1;grid-row:2}.xmc-row{grid-template-columns:auto 1fr}.xmc-meta{display:none}}';
    document.head.appendChild(s);
  };

  /** The breadcrumb's names for a sub-address: an id is never shown, its connection's name is. */
  const trail = (item) => {
    if (item === 'activity') return ['Activity'];
    const c = /^c\/([0-9a-f-]{36})$/i.exec(item || '');
    if (c) { const found = (S.one && S.one.id === c[1].toLowerCase() ? S.one : S.conns.find((x) => x.id === c[1].toLowerCase())); return [found ? found.client.name : 'Connection']; }
    return [];
  };
  /**
   * The sidebar: the two views, then each connected agent — the same rows the page lists, so the sidebar and the
   * page never disagree. Rows are the shell's own (`row`, `data-item`), so its keyboard and highlighting apply.
   */
  const panel = () => {
    const ic = (k) => (X() ? X().ic(k) : '');
    const at = here();
    const r = (item, icon, label, meta = '') => `<button class="row" aria-current="${(item === '' && at.kind === 'list') || (item === 'activity' && at.kind === 'activity') || (at.kind === 'one' && item === `c/${at.id}`)}" data-item="${esc(item)}" data-item-exact>${ic(icon)}<span class="t">${esc(label)}</span>${meta ? `<span class="meta">${esc(meta)}</span>` : ''}</button>`;
    const views = `<div class="views">${r('', 'share', 'Connections')}${r('activity', 'activity', 'Activity')}</div>`;
    const conns = S.conns.length
      ? S.conns.map((c) => r(`c/${c.id}`, 'bot', c.client.name, ago(c.lastUsedAt))).join('')
      : `<div class="empty-note"><b>No agent connected yet.</b><span>Add the XENO MCP address to an agent and sign in.</span></div>`;
    return `${views}<div class="sec" data-sec="mcp-agents"><div class="sh"><span class="t">Connected agents</span></div><div class="sbody">${conns}</div></div>`;
  };

  window.XENO_MCP = { page, trail, panel, reload: () => { S.key = null; paint(); } };
})();
