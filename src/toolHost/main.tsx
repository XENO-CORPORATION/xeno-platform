/**
 * The tool page: /tool-host.html?tool=<id>&v=<version>. The workspace shows it in a frame
 * (prototypes/xeno-workspace/platform-tools.js). It loads ONE verified package from /api/tools and mounts it with
 * the web ToolHost — the same way Hub mounts a runtime tool (xeno-hub tools/runtimeTools.ts), on the web.
 */
import React, { useEffect, useState } from 'react';
import * as ReactJsxRuntime from 'react/jsx-runtime';
import { createRoot } from 'react-dom/client';
import { createWebHost } from './webHost';
import type { ToolModule, NotifyLevel } from './contract';

// what the import map's shims hand a tool: this page's own React and the kit's runtime (defineTool)
(globalThis as Record<string, unknown>).__xenoHostModules = {
  react: React,
  'react/jsx-runtime': ReactJsxRuntime,
  '@xeno-tools/kit': { defineTool: (manifest: unknown, Component: unknown) => ({ manifest, Component }) },
};

const params = new URLSearchParams(location.search);
const toolId = params.get('tool') || '';
const version = params.get('v') || '';
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

function App() {
  const [mod, setMod] = useState<ToolModule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<{ id: number; level: NotifyLevel; message: string }[]>([]);
  const [host] = useState(() => createWebHost(toolId, (level, message) => {
    const id = Date.now() + Math.random();
    setToasts((x) => [...x, { id, level, message }]);
    setTimeout(() => setToasts((x) => x.filter((t) => t.id !== id)), 5000);
  }));

  useEffect(() => {
    if (!SAFE.test(toolId) || !SAFE.test(version)) { setError('No tool was named.'); return; }
    const base = `/api/tools/${toolId}/${version}`;
    // the stylesheet first, so the tool never paints unstyled; both come only from the verified package
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = `${base}/index.css`;
    link.onerror = () => link.remove(); document.head.appendChild(link);
    import(/* @vite-ignore */ `${base}/index.js`)
      .then((m) => { const t = (m.default || m) as ToolModule; if (!t || !t.Component) throw new Error('This package is not a XENO tool.'); setMod(t); document.title = `${t.manifest?.name || toolId} — XENO`; window.parent?.postMessage({ type: 'xeno-tool:ready', tool: toolId }, location.origin); })
      .catch((e) => setError(`This tool could not be opened: ${e && e.message ? e.message : e}`));
  }, []);

  if (error) return <div data-tool-error style={{ padding: 32, color: '#948d83' }}>{error}</div>;
  if (!mod) return <div data-tool-loading style={{ padding: 32, color: '#69635b' }}>Opening the tool…</div>;
  const C = mod.Component;
  return (
    <div data-tool-mounted={toolId} style={{ height: '100%' }}>
      <C host={host} onClose={() => window.parent?.postMessage({ type: 'xeno-tool:close', tool: toolId }, location.origin)} />
      <Toasts items={toasts} />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
