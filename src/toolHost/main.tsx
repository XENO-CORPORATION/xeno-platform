/**
 * The tool page. Two addresses, one page:
 *   /tools                  the picker (Picker.tsx) — what do you want to do?   tools.xenosystem.ai redirects here
 *   /tools/<id>             one tool, its newest version, full page
 *   /tool-host.html?tool=<id>&v=<version>   one exact version, in the workspace's frame (platform-tools.js) It loads ONE verified package from /api/tools and mounts it with
 * the web ToolHost — the same way Hub mounts a runtime tool (xeno-hub tools/runtimeTools.ts), on the web.
 */
import React, { useEffect, useState } from 'react';
import * as ReactJsxRuntime from 'react/jsx-runtime';
import { createRoot } from 'react-dom/client';
import { createWebHost } from './webHost';
import { Picker } from './Picker';
import { Header, initialTheme } from './chrome';
import { mineIdFromPath, onSitePath, toolIdFromPath, toolPath, toolsHome } from './where';
import { MineTool } from './Mine';
import './tools.css';

document.documentElement.dataset.theme = initialTheme();
import type { ToolModule, NotifyLevel } from './contract';

// what the import map's shims hand a tool: this page's own React and the kit's runtime (defineTool)
(globalThis as Record<string, unknown>).__xenoHostModules = {
  react: React,
  'react/jsx-runtime': ReactJsxRuntime,
  '@xeno-tools/kit': { defineTool: (manifest: unknown, Component: unknown) => ({ manifest, Component }) },
};

const params = new URLSearchParams(location.search);
const onSite = onSitePath(location.pathname);
const toolId = onSite ? toolIdFromPath(location.pathname) : params.get('tool') || '';
const pinned = onSite ? '' : params.get('v') || '';
const framed = window.parent !== window;
const SAFE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function Toasts({ items }: { items: { id: number; level: NotifyLevel; message: string }[] }) {
  return (
    <div style={{ position: 'fixed', bottom: 16, left: 16, right: 16, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'none', zIndex: 50 }}>
      {items.map((t) => (
        <div key={t.id} data-tool-toast={t.level} style={{ alignSelf: 'center', maxWidth: 560, padding: '10px 14px', borderRadius: 10, background: t.level === 'error' ? '#2a1414' : '#151515', border: '1px solid rgba(255,255,255,0.08)', color: '#ece7df', fontSize: 13 }}>{t.message}</div>
      ))}
    </div>
  );
}

function Bar({ name }: { name: string }) {
  if (framed) return null;
  return <Header toolName={name || undefined} />;
}

function App() {
  const mine = onSite ? mineIdFromPath(location.pathname) : '';
  if (mine) return <MineTool id={mine} />;
  if (onSite && !toolId) return <Picker onOpen={(id) => { location.href = toolPath(id); }} />;
  return <ToolPage />;
}

function ToolPage() {
  const [mod, setMod] = useState<ToolModule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<{ id: number; level: NotifyLevel; message: string }[]>([]);
  const [host] = useState(() => createWebHost(toolId, (level, message) => {
    const id = Date.now() + Math.random();
    setToasts((x) => [...x, { id, level, message }]);
    setTimeout(() => setToasts((x) => x.filter((t) => t.id !== id)), 5000);
  }));

  useEffect(() => {
    (async () => {
    let version = pinned;
    if (SAFE.test(toolId) && !version) {
      try { const j = await (await fetch('/api/tools')).json(); const t = (j.tools || []).find((x: { id: string; contract: string }) => x.id === toolId && x.contract === 'tool@1'); version = t ? t.version : ''; } catch { /* fall through to the error below */ }
    }
    if (!SAFE.test(toolId) || !SAFE.test(version)) { setError(toolId ? `There is no tool called ${toolId}.` : 'No tool was named.'); return; }
    const base = `/api/tools/${toolId}/${version}`;
    // the stylesheet first, so the tool never paints unstyled; both come only from the verified package
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = `${base}/index.css`;
    link.onerror = () => link.remove(); document.head.appendChild(link);
    import(/* @vite-ignore */ `${base}/index.js`)
      .then((m) => { const t = (m.default || m) as ToolModule; if (!t || !t.Component) throw new Error('This package is not a XENO tool.'); setMod(t); document.title = `${t.manifest?.name || toolId} — XENO`; window.parent?.postMessage({ type: 'xeno-tool:ready', tool: toolId }, location.origin); })
      .catch((e) => setError(`This tool could not be opened: ${e && e.message ? e.message : e}`));
    })();
  }, []);

  if (error) return <div className="xt xt-page"><Bar name="" /><div data-tool-error className="xt-msg">{error}</div></div>;
  if (!mod) return <div className="xt xt-page"><Bar name="" /><div data-tool-loading className="xt-msg">Opening the tool…</div></div>;
  const C = mod.Component;
  const close = () => (framed ? window.parent.postMessage({ type: 'xeno-tool:close', tool: toolId }, location.origin) : (location.href = toolsHome));
  return (
    <div data-tool-mounted={toolId} className="xt" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Bar name={mod.manifest?.name || toolId} />
      <div className="xt-tool"><C host={host} onClose={close} /></div>
      <Toasts items={toasts} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
