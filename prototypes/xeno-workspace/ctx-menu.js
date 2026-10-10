/* XCM — the ONE context-menu engine for the workspace.
 *
 * Every object answers "what can I do with this?" from a single model, and that model drives:
 *   · the right-click menu            (contextmenu, Shift+F10, the ContextMenu key, long-press on touch)
 *   · the "…" button on the object    (same menu, anchored to the button)
 *   · its keyboard shortcuts          (F2, Delete, Enter… are read FROM the menu items, so a shortcut
 *                                       shown in a menu always works and never drifts from it — VS Code's
 *                                       command/menu/keybinding model)
 *
 * Resolution walks up from the clicked element and the FIRST (most specific) object that has a menu wins;
 * a button with no menu of its own falls through to its container, and the page itself is the last stop
 * (Figma's canvas menu, Finder's desktop menu). Selected text and editable fields add their own section on
 * top. Shift+right-click always gives the browser's native menu — the escape hatch.
 *
 * Accessibility follows the WAI-ARIA APG menu pattern: role=menu/menuitem(checkbox), roving focus,
 * ↑ ↓ Home End, type-ahead, → / ← for submenus, Esc returns focus to where the menu was opened.
 *
 * A resolver: { id, sel, priority?, when?(node), build(node, ctx) → [section, …] }
 * A section:  [item, …]   An item: { label, icon?, kbd?, key?, run?, sub?, danger?, checked?, disabled?: 'reason' }
 */
(() => {
  const X = () => window.XW;
  const ic = (k) => (window.XW ? X().ic(k) : '');
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const resolvers = [];
  let stack = [];                 // open menus, root first: { el, items, opener }
  let opener = null, textCtx = null, kbdMode = false, hoverTimer = 0, lastPt = null;

  // ---------- shared helpers resolvers use ----------
  async function copy(text, what = 'Copied') {
    try { await navigator.clipboard.writeText(text); }
    catch { const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
    X().toast(what);
  }
  const link = (hash) => window.XENO_ADDR.url(hash);
  const openWindow = (hash) => { window.open(link(hash), '_blank', 'noopener'); };
  // reading the clipboard needs the person's permission (Chrome asks once per site; Safari asks every time). When it is
  // refused, say which of the two it is and what to do — never a silent nothing (Google Docs, Figma in the browser)
  async function clipboardState() { try { return (await navigator.permissions.query({ name: 'clipboard-read' })).state; } catch { return 'unknown'; } }
  async function clipboardHelp() {
    const st = await clipboardState();
    X().toast(st === 'denied' ? 'Clipboard access is blocked for this site — allow it from the lock icon in the address bar, or press Ctrl V' : 'The browser didn’t share the clipboard — press Ctrl V to paste');
  }
  const H = {
    copy, link, openWindow, clipboardHelp, clipboardState,
    copyLink: (hash, what = 'Link copied') => copy(link(hash), what),
    open: (hash) => { window.XENO_ADDR.go(hash); },
    // the standard trio every navigable object gets, in this order (Finder, Drive, Linear)
    nav: (hash, openRun, label = 'Open') => [
      { label, icon: 'open', key: 'Enter', kbd: '↵', run: openRun || (() => { window.XENO_ADDR.go(hash); }) },
      { label: 'Open in new window', icon: 'hub', run: () => openWindow(hash) },
    ],
    linkItems: (hash, name) => [
      { label: 'Copy link', icon: 'share', run: () => copy(link(hash), 'Link copied') },
      ...(name ? [{ label: 'Copy name', icon: 'doc', run: () => copy(name, 'Name copied') }] : []),
    ],
    esc, ic,
  };

  function register(r) { resolvers.push({ priority: 0, ...r }); resolvers.sort((a, b) => b.priority - a.priority); }

  function resolve(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      for (const r of resolvers) {
        if (!n.matches(r.sel) || (r.when && !r.when(n))) continue;
        const sections = (r.build(n, {}) || []).map((s) => s.filter(Boolean)).filter((s) => s.length);
        if (sections.length) return { node: n, r, sections };
      }
    }
    return null;
  }

  // ---------- text: selection and editable fields ----------
  const EDITABLE = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=button]):not([type=submit]), textarea, [contenteditable=""], [contenteditable="true"]';
  function readText(target) {
    const ed = target.closest?.(EDITABLE);
    if (ed) {
      const isField = 'selectionStart' in ed && ed.selectionStart != null;
      const s = isField ? ed.selectionStart : 0, e = isField ? ed.selectionEnd : 0;
      return { ed, s, e, text: isField ? ed.value.slice(s, e) : String(getSelection() || '') };
    }
    const sel = getSelection();
    if (sel && !sel.isCollapsed && sel.rangeCount) {
      const r = sel.getRangeAt(0), host = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
      const t = String(sel).trim();
      // only if the right-click landed on (or inside) what is selected — right-clicking elsewhere is about that thing
      if (t && (host.contains(target) || target.contains(host) || r.intersectsNode(target))) return { ed: null, text: t, range: r.cloneRange() };
    }
    return null;
  }
  function restoreField(t) { if (!t?.ed) return; t.ed.focus({ preventScroll: true }); if ('setSelectionRange' in t.ed && t.s != null) try { t.ed.setSelectionRange(t.s, t.e); } catch {} }
  function textSection(t) {
    if (!t) return [];
    const short = t.text.length > 28 ? t.text.slice(0, 26).trim() + '…' : t.text;
    const ask = t.text ? [{ label: `Ask XENO about “${short}”`, icon: 'chat', run: () => askXeno(t.text) }, { label: `Search for “${short}”`, icon: 'search', run: () => X().search?.(t.text) }] : [];
    if (!t.ed) return [[{ label: 'Copy', icon: 'copy', kbd: 'Ctrl C', run: () => copy(t.text, 'Copied') }], ask];
    const ro = t.ed.readOnly || t.ed.disabled, has = !!t.text;
    const exec = (cmd) => () => { restoreField(t); document.execCommand(cmd); };
    return [[
      { label: 'Undo', icon: 'undo', kbd: 'Ctrl Z', run: exec('undo'), disabled: ro ? 'Read-only field' : null },
      { label: 'Redo', icon: 'redo', kbd: 'Ctrl Y', run: exec('redo'), disabled: ro ? 'Read-only field' : null },
    ], [
      { label: 'Cut', icon: 'cut', kbd: 'Ctrl X', run: exec('cut'), disabled: !has ? 'Select some text first' : ro ? 'Read-only field' : null },
      { label: 'Copy', icon: 'copy', kbd: 'Ctrl C', run: () => copy(t.text, 'Copied'), disabled: !has ? 'Select some text first' : null },
      { label: 'Paste', icon: 'paste', kbd: 'Ctrl V', disabled: ro ? 'Read-only field' : null, run: async () => {
        restoreField(t);
        if (await clipboardState() === 'denied') return clipboardHelp();
        try { const v = await navigator.clipboard.readText(); restoreField(t); if (!document.execCommand('insertText', false, v)) { const s = t.ed.selectionStart, e = t.ed.selectionEnd; t.ed.setRangeText(v, s, e, 'end'); t.ed.dispatchEvent(new Event('input', { bubbles: true })); } }
        catch { clipboardHelp(); } } },
      { label: 'Select all', icon: 'grid', kbd: 'Ctrl A', run: () => { restoreField(t); t.ed.select ? t.ed.select() : document.execCommand('selectAll'); } },
    ], has ? ask : []];
  }
  function askXeno(text) {
    X().go('product', { product: 'chat' });
    const fill = (n = 0) => { const ta = document.querySelector('#main .live-chat textarea, #main .chat textarea'); if (!ta) return n < 20 && setTimeout(() => fill(n + 1), 60);
      ta.focus(); ta.value = `About this:\n> ${text.replace(/\n/g, '\n> ')}\n\n`; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.setSelectionRange(ta.value.length, ta.value.length); };
    fill();
  }

  // ---------- rendering ----------
  function itemHTML(it, i) {
    if (it.sub) return `<button class="xcm-i" role="menuitem" tabindex="-1" data-i="${i}" aria-haspopup="menu" aria-expanded="false">${it.iconHTML || (it.icon ? ic(it.icon) : '<i class="xcm-ph"></i>')}<span class="xcm-l">${esc(it.label)}</span>${ic('right').replace('class="i"', 'class="i xcm-chev"')}</button>`;
    const role = it.checked != null ? 'menuitemcheckbox' : 'menuitem';
    // the icon column never changes: a toggle keeps its icon and shows its state as a check on the trailing edge (Linear, Figma)
    const lead = it.iconHTML || (it.icon ? ic(it.icon) : '<i class="xcm-ph"></i>');
    const ck = it.checked != null ? `<span class="xcm-ck">${it.checked ? ic('check') : ''}</span>` : '';
    return `<button class="xcm-i${it.danger ? ' danger' : ''}" role="${role}" tabindex="-1" data-i="${i}"${it.checked != null ? ` aria-checked="${!!it.checked}"` : ''}${it.disabled ? ` aria-disabled="true" title="${esc(it.disabled)}"` : ''}>${lead}<span class="xcm-l">${esc(it.label)}${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</span>${ck}${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ''}</button>`;
  }
  function build(sections, label) {
    const items = []; let html = '';
    sections.forEach((sec, si) => { if (si) html += '<div class="xcm-sep" role="separator"></div>'; sec.forEach((it) => { html += itemHTML(it, items.length); items.push(it); }); });
    const el = document.createElement('div'); el.className = 'xcm'; el.setAttribute('role', 'menu'); el.tabIndex = -1;
    if (label) el.setAttribute('aria-label', label);
    el.innerHTML = html; return { el, items };
  }
  function place(el, x, y, flipX = null) {
    document.body.appendChild(el);
    el.style.maxHeight = innerHeight - 16 + 'px';
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = x, top = y;
    if (left + w > innerWidth - 8) left = flipX != null ? flipX - w : Math.max(8, x - w);
    if (top + h > innerHeight - 8) top = Math.max(8, innerHeight - 8 - h);
    el.style.left = Math.max(8, left) + 'px'; el.style.top = top + 'px';
    el.style.transformOrigin = `${x - left}px ${y - top}px`;
    requestAnimationFrame(() => el.classList.add('on'));
  }

  // ---------- open / close ----------
  let touchMode = false;
  function show(sections, { x, y, label, opener: op = null, keyboard = false, touch = false } = {}) {
    close(false);
    if (window.XW) { try { document.querySelectorAll('#menu.on').forEach(() => X().hidePops?.()); } catch {} }
    opener = op; kbdMode = keyboard;
    touchMode = touch; const m = build(sections, label); if (touch) m.el.classList.add('touch'); stack = [{ ...m, opener: op }];
    place(m.el, x, y); wire(m, 0);
    op?.setAttribute('data-menu-open', '');
    op?.setAttribute?.('aria-expanded', 'true');
    m.el.focus({ preventScroll: true });
    if (keyboard) focusItem(0, 0);
    return m.el;
  }
  function open(target, { x, y, keyboard = false, fromButton = null, touch = false } = {}) {
    textCtx = fromButton ? null : readText(target);
    const res = resolve(target);
    // text is the subject when there is text: a field or a selection inside the page gets the text menu alone, the way
    // every OS does — only a real OBJECT (a message, a file) adds its own section beneath; the page/app fallbacks do not
    const obj = res && !(textCtx && res.r.priority < 0) ? res.sections : [];
    const sections = [...(textCtx ? textSection(textCtx) : []).filter((s) => s.length), ...obj];
    if (!sections.length) return null;
    const r = (fromButton || res?.node || target).getBoundingClientRect();
    return show(sections, { x: x ?? r.left, y: y ?? r.bottom + 4, keyboard, touch, opener: fromButton || res?.node || null, label: res?.node ? labelOf(res.node) : 'Text' });
  }
  const labelOf = (n) => (n.getAttribute('aria-label') || n.querySelector?.('.t, b, h1, h2')?.textContent || n.textContent || '').trim().slice(0, 60) || 'Actions';
  function closeFrom(level) {
    while (stack.length > level) { const m = stack.pop(); m.el.remove(); const parent = stack[stack.length - 1]; parent?.el.querySelector('[aria-expanded="true"]')?.setAttribute('aria-expanded', 'false'); }
  }
  function close(restore = true) {
    clearTimeout(hoverTimer);
    if (!stack.length) return;
    const root = stack[0];
    // the root fades where it is; submenus go at once (macOS)
    closeFrom(1); const el = root.el; el.classList.remove('on'); el.classList.add('out'); el.inert = true; setTimeout(() => el.remove(), 120);
    stack = [];
    if (opener) { opener.removeAttribute('data-menu-open'); if (opener.hasAttribute('aria-expanded')) opener.setAttribute('aria-expanded', 'false'); }
    if (restore) { if (textCtx?.ed) restoreField(textCtx); else if (opener?.isConnected && opener.focus) opener.focus({ preventScroll: true }); }
    opener = null;
  }

  // ---------- behaviour ----------
  const btns = (lvl) => [...stack[lvl].el.querySelectorAll('.xcm-i')];
  function focusItem(lvl, idx) { const b = btns(lvl); if (!b.length) return; const n = b[(idx + b.length) % b.length]; stack[lvl].el.querySelectorAll('.hl').forEach((x) => x.classList.remove('hl')); n.classList.add('hl'); n.focus({ preventScroll: true }); n.scrollIntoView({ block: 'nearest' }); }
  function openSub(lvl, btn, focusFirst) {
    const it = stack[lvl].items[+btn.dataset.i]; if (!it?.sub) return;
    if (btn.getAttribute('aria-expanded') === 'true') { if (focusFirst) focusItem(lvl + 1, 0); return; }
    closeFrom(lvl + 1);
    const subs = typeof it.sub === 'function' ? it.sub() : it.sub;
    const m = build(Array.isArray(subs[0]) ? subs : [subs], it.label); if (touchMode) m.el.classList.add('touch'); stack.push({ ...m, parentBtn: btn });
    const r = btn.getBoundingClientRect(); m.el.classList.add('sub');
    place(m.el, r.right + 2, r.top - 5, r.left - 2); wire(m, lvl + 1);
    btn.setAttribute('aria-expanded', 'true');
    if (focusFirst) focusItem(lvl + 1, 0);
  }
  async function activate(lvl, btn) {
    const it = stack[lvl].items[+btn.dataset.i]; if (!it) return;
    if (it.disabled) { X().toast(it.disabled); return; }
    if (it.sub) return openSub(lvl, btn, true);
    const t = textCtx; close(false);
    if (t?.ed && !/^(Copy|Ask|Search)/.test(it.label)) restoreField(t);
    try { await it.run?.(); } catch (err) { console.error(err); X().toast('That didn’t work — try again'); }
  }
  // is the pointer travelling toward the open submenu? (Ben Kamens' triangle — Amazon's mega menu, macOS)
  function towardSub(lvl, pt) {
    const sub = stack[lvl + 1]; if (!sub || !lastPt) return false;
    const r = sub.el.getBoundingClientRect(), right = r.left > lastPt.x;
    const ex = right ? r.left : r.right, a = { x: ex, y: r.top - 8 }, b = { x: ex, y: r.bottom + 8 };
    const sign = (p1, p2, p3) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
    const d1 = sign(pt, lastPt, a), d2 = sign(pt, a, b), d3 = sign(pt, b, lastPt);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  }
  function wire(m, lvl) {
    m.el.addEventListener('mousedown', (e) => e.preventDefault());   // keep the page's text selection and the field's caret
    m.el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); });
    m.el.addEventListener('pointermove', (e) => {
      const btn = e.target.closest('.xcm-i'); const pt = { x: e.clientX, y: e.clientY };
      if (btn && !btn.classList.contains('hl')) {
        clearTimeout(hoverTimer);
        const go = () => { if (!stack[lvl]) return; stack[lvl].el.querySelectorAll('.hl').forEach((x) => x.classList.remove('hl')); btn.classList.add('hl'); btn.focus({ preventScroll: true });
          const it = stack[lvl].items[+btn.dataset.i]; if (it?.sub) openSub(lvl, btn, false); else closeFrom(lvl + 1); };
        if (stack[lvl + 1] && towardSub(lvl, pt)) hoverTimer = setTimeout(go, 260); else hoverTimer = setTimeout(go, stack[lvl + 1] || stack[lvl].items[+btn.dataset.i]?.sub ? 90 : 0);
      }
      lastPt = pt;
    });
    m.el.addEventListener('click', (e) => { const btn = e.target.closest('.xcm-i'); if (btn) activate(lvl, btn); });
  }
  let ta = { s: '', t: 0 };
  document.addEventListener('keydown', (e) => {
    if (!stack.length) return;
    const lvl = stack.length - 1, b = btns(lvl), i = b.indexOf(document.activeElement);
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); if (lvl) { const pb = stack[lvl].parentBtn; closeFrom(lvl); pb?.focus(); } else close(); return; }
    if (k === 'Tab') { e.preventDefault(); close(); return; }
    if (k === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); focusItem(lvl, i + 1); return; }
    if (k === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); focusItem(lvl, i < 0 ? -1 : i - 1); return; }
    if (k === 'Home') { e.preventDefault(); focusItem(lvl, 0); return; }
    if (k === 'End') { e.preventDefault(); focusItem(lvl, -1); return; }
    if (k === 'ArrowRight') { e.preventDefault(); if (i >= 0 && b[i].hasAttribute('aria-haspopup')) openSub(lvl, b[i], true); return; }
    if (k === 'ArrowLeft') { e.preventDefault(); if (lvl) { const pb = stack[lvl].parentBtn; closeFrom(lvl); pb?.focus(); pb?.classList.add('hl'); } return; }
    if ((k === 'Enter' || k === ' ') && i >= 0) { e.preventDefault(); e.stopPropagation(); activate(lvl, b[i]); return; }
    if (k.length === 1 && /\S/.test(k) && !e.ctrlKey && !e.metaKey && !e.altKey) {   // type-ahead
      e.preventDefault(); const now = Date.now(); ta.s = now - ta.t > 600 ? k.toLowerCase() : ta.s + k.toLowerCase(); ta.t = now;
      const labels = b.map((x) => x.querySelector('.xcm-l').textContent.toLowerCase());
      let j = labels.findIndex((l, n) => n > i && l.startsWith(ta.s)); if (j < 0) j = labels.findIndex((l) => l.startsWith(ta.s)); if (j >= 0) focusItem(lvl, j);
    }
  }, true);
  // after a press-and-hold the browser still sends the compatibility mouse events for that touch — they are not a click away
  document.addEventListener('mousedown', (e) => { if (stack.length && !e.target.closest('.xcm') && !lpQuiet()) close(false); }, true);
  addEventListener('blur', () => close(false));
  addEventListener('resize', () => close(false));
  // the PERSON scrolling away closes the menu (wheel, swipe); a layout shift the app makes underneath it does not
  document.addEventListener('wheel', (e) => { if (stack.length && !e.target.closest?.('.xcm')) close(false); }, { capture: true, passive: true });
  document.addEventListener('touchmove', (e) => { if (stack.length && !lpQuiet() && !e.target.closest?.('.xcm')) close(false); }, { capture: true, passive: true });

  // ---------- triggers ----------
  document.addEventListener('contextmenu', (e) => {
    if (e.shiftKey) return;                                   // the native menu, on purpose
    if (e.target.closest('.xcm')) return;
    if (e.target.closest('#logo')) return;                    // the logo keeps its own gesture (mode switcher)
    if (lpQuiet()) { e.preventDefault(); e.stopImmediatePropagation(); return; }   // our long-press already answered
    e.preventDefault(); e.stopImmediatePropagation();
    const kb = e.button === -1 || (e.clientX === 0 && e.clientY === 0 && e.detail === 0);   // ContextMenu key reaches us as a contextmenu event
    const target = kb ? (focusTarget() || e.target) : e.target;
    if (kb) { const r = target.getBoundingClientRect(); open(target, { x: r.left + 8, y: r.bottom + 2, keyboard: true }); }
    else if (!open(target, { x: e.clientX, y: e.clientY })) close(false);
  }, true);
  // ---------- touch: press and hold (iOS, iPadOS, Android — Files, Photos, Drive all open their menu this way) ----------
  // 500 ms without moving more than 10 px opens the menu where the finger is; a light haptic confirms it; lifting the
  // finger does NOT then click the thing underneath, and the browser's own long-press menu and callout are suppressed.
  let lp = null, lpFiredAt = 0, lpHold = false, lpUntil = 0, lpEat = false;
  const lpQuiet = () => lpHold || lpEat || Date.now() < lpUntil;   // the finger that opened the menu is still down, or just lifted
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || !e.isPrimary || e.target.closest('.xcm, #logo')) return;
    if (stack.length) return;
    const x = e.clientX, y = e.clientY, target = e.target;
    lp = { x, y, id: e.pointerId, timer: setTimeout(() => {
      if (!lp) return; lp.fired = true; lpFiredAt = Date.now(); lpHold = true; try { navigator.vibrate?.(8); } catch {}
      const ed = target.closest?.(EDITABLE); if (ed) return;          // in a field the platform's own selection handles win
      open(target, { x: x + 4, y: y + 4, touch: true });
    }, 500) };
  }, true);
  const lpCancel = () => { if (lp) { clearTimeout(lp.timer); if (lp.fired) { lpHold = false; lpEat = true; lpUntil = Date.now() + 450; } lp = null; } };
  document.addEventListener('pointermove', (e) => { if (lp && e.pointerId === lp.id && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) lpCancel(); }, true);
  document.addEventListener('pointerup', (e) => { if (lp && e.pointerId === lp.id) { const fired = lp.fired; lpCancel(); void fired; } }, true);
  document.addEventListener('pointercancel', lpCancel, true);
  // cancelling the touchend of a long-press stops the synthetic mouse events and the click at the source
  document.addEventListener('touchend', (e) => { if (lpEat) { lpEat = false; if (e.cancelable) e.preventDefault(); } }, { capture: true, passive: false });

  // the object the keyboard is "on": the focused element, or the selected file when focus is on the page
  function focusTarget() {
    const a = document.activeElement;
    if (a && a !== document.body && !a.closest('.xcm')) return a;
    return document.querySelector('#main [data-pg-file][aria-selected]') || null;
  }
  document.addEventListener('keydown', (e) => {
    if (stack.length) return;
    if (e.key === 'F10' && e.shiftKey) {
      if (document.activeElement?.id === 'logo') return;   // the logo's Shift+F10 opens the mode switcher
      e.preventDefault(); const t = focusTarget() || document.querySelector('#main .mview') || document.body; const r = t.getBoundingClientRect();
      open(t, { x: r.left + 8, y: Math.min(r.bottom + 2, innerHeight - 40), keyboard: true });
      return;
    }
    // shortcuts are read from the object's own menu: what the menu shows is exactly what the key does
    if (e.altKey || e.target.closest?.(EDITABLE + ', .xd')) return;
    const combo = (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.shiftKey && e.key.length > 1 ? 'Shift+' : '') + (e.key.length === 1 ? e.key.toLowerCase() : e.key);
    if (!['F2', 'Delete', 'Ctrl+d', 's', 'Ctrl+Enter'].includes(combo)) return;
    const t = focusTarget(); if (!t) return;
    const res = resolve(t); if (!res) return;
    const it = res.sections.flat().find((x) => x.key === combo && !x.disabled && x.run);
    if (!it) return;
    e.preventDefault(); e.stopPropagation(); it.run();
  }, true);

  window.XCM = { register, open, show, close, resolve, isOpen: () => stack.length > 0, H };
})();
