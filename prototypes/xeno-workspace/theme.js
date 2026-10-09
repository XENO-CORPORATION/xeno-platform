/* XENO_THEME — the workspace on the platform's theme.
 *
 * The platform has ONE appearance preference for every signed-in surface (src/platform/platformTheme.ts):
 * System, Dark, Dim, Light, or a custom point on a brightness line of twenty-one stops, each stop a complete
 * palette. The workspace used to hard-code the first stop. It now reads the same preference, from the same
 * place, and paints the same palette; so the workspace, the chat inside it and every other platform page agree,
 * and a change made in one shows in the others at once.
 *
 *   Where the preference lives   localStorage `xeno_platform_theme` + `xeno_platform_theme_brightness`
 *                                (last known, so the first paint is right), confirmed from the account's saved
 *                                settings (`appearance.theme`, `appearance.themeBrightness`) when served.
 *   How a change is announced    the `xeno_platform_theme_change` event in this page, and the `storage` event
 *                                in every other page and frame of the same site. Same names as the platform.
 *   The palette                  theme-palette.js, generated from the platform's module (never edited here).
 *
 * This file runs in <head>, before the page paints, so there is no flash of the wrong theme.
 * window.XENO_THEME = { get(), set(preference, brightness), position(), options } */
(() => {
  const PAL = window.XENO_THEME_PALETTE;
  const KEY = 'xeno_platform_theme', BKEY = 'xeno_platform_theme_brightness', EVT = 'xeno_platform_theme_change';
  const OLD = 'xeno-chat-theme', OLDB = 'xeno-chat-theme-brightness';   // read-only: the chat's keys before the theme was platform-wide
  const PREFS = ['system', 'custom', 'dark', 'dim', 'light'];
  const root = document.documentElement;
  const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const pref = (v) => (PREFS.includes(v) ? v : null);
  const bright = (v) => { const n = Number(v); return Math.round(Math.min(100, Math.max(0, Number.isFinite(n) ? n : 0)) / PAL.step) * PAL.step; };
  const system = () => (window.matchMedia && !matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark');
  const get = () => ({ preference: pref(read(KEY)) || pref(read(OLD)) || 'system', brightness: bright(read(BKEY) ?? read(OLDB) ?? 0) });
  const position = (s = get()) => (s.preference === 'system' ? PAL.named[system()] : s.preference === 'custom' ? s.brightness : PAL.named[s.preference]);
  const nearest = (pos) => Object.entries(PAL.named).reduce((a, b) => (Math.abs(b[1] - pos) < Math.abs(a[1] - pos) ? b : a))[0];

  // the faintest text: as quiet as it can be while still 4.5:1 on the page AND on a panel, at every stop.
  // A fixed share of the text colour passes at the dark and light ends and fails on the mid-grey stops (80 to 90).
  const ch = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const blend = (a, pct, b) => ch(a).map((x, i) => x * pct / 100 + ch(b)[i] * (1 - pct / 100));
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  function dimShare(text, canvas, surface, from) { const panel = blend(canvas, 46, surface), page = ch(canvas); for (let p = from; p < 100; p += 2) { const c = blend(text, p, canvas); if (contrast(c, page) >= 4.6 && contrast(c, panel) >= 4.6) return p; } return 100; }
  function apply() {
    const pos = position(), [canvas, surface, elevated, , controlStrong, text, muted, border, , , light] = PAL.stops[Math.round(pos / PAL.step)];
    const mix = (a, pct, b) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;
    const vars = {
      '--canvas': canvas, '--rail': surface, '--rail-stroke': border, '--panel-stroke': border, '--elevated': elevated,
      '--panel': mix(canvas, 46, surface),            // the workspace's panels sit between the page and the rail
      '--control': mix(surface, 47, elevated),
      '--hover-strong': mix(elevated, 50, controlStrong),
      '--hover': mix(text, 6, 'transparent'),
      '--border': mix(text, 10, 'transparent'),
      '--text': text, '--muted': muted,
      '--dim': mix(text, dimShare(text, canvas, surface, light ? 62 : 56), canvas),
      '--danger': light ? '#dc2626' : '#ef4444',
    };
    for (const k in vars) root.style.setProperty(k, vars[k]);
    root.style.colorScheme = light ? 'light' : 'dark';
    root.dataset.theme = nearest(pos); root.dataset.themeLight = light ? '1' : '0';
  }
  apply();

  // a change made anywhere on this site: here (the event), or in another page or the chat's frame (storage)
  addEventListener(EVT, apply);
  addEventListener('storage', (e) => { if (e.key === KEY || e.key === BKEY || e.key === null) apply(); });
  window.matchMedia && matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);

  function announce(preference, brightness) {
    try { localStorage.setItem(KEY, preference); localStorage.setItem(BKEY, String(brightness)); localStorage.removeItem(OLD); localStorage.removeItem(OLDB); } catch {}
    dispatchEvent(new CustomEvent(EVT, { detail: { preference, brightness } }));
    // the chat's frame is another document of this site: `storage` reaches it, but only when the value changed
    try { const f = document.getElementById('xw-chat-frame'); f && f.contentWindow.dispatchEvent(new f.contentWindow.CustomEvent(EVT, { detail: { preference, brightness } })); } catch {}
  }
  const served = () => !!(window.XENO_PLATFORM && window.XENO_PLATFORM.served);

  // Save, then show. Served by the platform the account's settings are the record: the choice is sent there and
  // what the server confirms is what gets applied; a refusal changes nothing and is returned as the reason.
  async function set(preference, brightness) {
    const p = pref(preference); if (!p) return { ok: false, msg: 'That theme isn’t one XENO has.' };
    const b = p === 'custom' ? bright(brightness) : p === 'system' ? get().brightness : PAL.named[p];
    if (!served()) { announce(p, b); return { ok: true, preference: p, brightness: b }; }
    let r; try { r = await window.XENO_PLATFORM.api('PATCH', '/api/user-data/settings', { updates: [{ path: 'appearance.theme', value: p }, { path: 'appearance.themeBrightness', value: b }] }); } catch { r = null; }
    const saved = r && r.ok && r.d && r.d.settings && r.d.settings.appearance, cp = saved && pref(saved.theme);
    if (!cp) return { ok: false, msg: (r && r.d && typeof r.d.error === 'string' && r.d.error) || 'Your theme couldn’t be saved. Nothing changed.' };
    const cb = bright(saved.themeBrightness); announce(cp, cb);
    return { ok: true, preference: cp, brightness: cb };
  }
  // once per visit, the account's saved choice replaces the last-known local one
  async function confirm() {
    if (!served()) return;
    const r = await window.XENO_PLATFORM.api('GET', '/api/user-data/settings').catch(() => null);
    const a = r && r.ok && r.d && r.d.settings && r.d.settings.appearance, p = a && pref(a.theme); if (!p) return;
    const now = get(), b = bright(a.themeBrightness); if (now.preference !== p || now.brightness !== b) announce(p, b);
  }
  window.XENO_THEME = { get, set, position, confirm, options: [['system', 'System'], ['dark', 'Dark'], ['dim', 'Dim'], ['light', 'Light']], step: PAL.step };
  addEventListener('DOMContentLoaded', () => { const P = window.XENO_PLATFORM; if (P && P.served) Promise.resolve(P.ready).then((u) => { if (u) P.first ? P.first(confirm()) : confirm(); }); });
})();
