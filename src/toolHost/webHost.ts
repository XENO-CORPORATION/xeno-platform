/**
 * The ToolHost a XENO tool gets on the web (xeno-tools packages/tool-kit/src/host.ts is the contract; Hub's
 * tools/hubHost.ts is the desktop one). Same contract, browser means:
 *
 *   fs        a file the person picks (no paths leave the page); saving downloads the file
 *   llm       /api/ai/chat          imagegen  /api/xeno/images/generate · /edit     metered on the person's account
 *   capture   the browser's screen-share picker        clipboard  navigator.clipboard
 *   storage   this browser, namespaced per tool        credits    the person's balance (read only)
 *   inference · convert · font   need XENO Hub (local models, native conversion): they refuse with that reason,
 *             never a fake result. WEB_CAPABILITIES in src/server/services/toolPackages.js must match this file.
 */
import type { ToolHost, ChatRequest, ImageGenRequest, ImageEditRequest, NotifyLevel } from './contract';

export class NeedsHubError extends Error {
  constructor(what: string) { super(`${what} needs XENO Hub on your computer. Open this tool in Hub to use it.`); this.name = 'NeedsHubError'; }
}

const csrf = (): string | null => {
  for (const n of ['__Host-xeno_csrf', 'xeno_csrf']) {
    const m = document.cookie.split(';').map((p) => p.trim()).find((p) => p.startsWith(n + '='));
    if (m) return decodeURIComponent(m.slice(n.length + 1));
  }
  return null;
};
async function call(method: string, url: string, body?: unknown): Promise<any> {
  const headers: Record<string, string> = { 'x-xeno-surface': 'xeno-web-tool' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const t = method !== 'GET' ? csrf() : null; if (t) headers['x-xeno-csrf'] = t;
  const r = await fetch(url, { method, credentials: 'same-origin', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j: any = null; try { j = await r.json(); } catch { /* not JSON */ }
  if (r.status === 401) throw new Error('Sign in to XENO to use this.');
  if (!r.ok) throw new Error((j && (j.message || (typeof j.error === 'string' ? j.error : j.error?.message))) || `The request failed (${r.status})`);
  return j;
}

const dataUrlOf = (d: any): string => (d && d.b64_json ? `data:image/png;base64,${d.b64_json}` : d && d.url ? String(d.url) : '');
const sizeOf = (s?: string) => { const [w, h] = String(s || '1024x1024').split('x').map((x) => parseInt(x, 10)); return { width: w || 1024, height: h || w || 1024 }; };

export function createWebHost(toolId: string, notify: (level: NotifyLevel, message: string) => void): ToolHost {
  // a picked file is held here under an address the tool can pass back; nothing about the person's disk leaves the page
  const files = new Map<string, Blob>();
  let n = 0;
  const pick = (opts: { multiple?: boolean; filters?: { extensions: string[] }[] } = {}) => new Promise<string[]>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = !!opts.multiple;
    const ext = (opts.filters || []).flatMap((f) => f.extensions || []).filter((e) => e && e !== '*');
    if (ext.length) input.accept = ext.map((e) => '.' + e.replace(/^\./, '')).join(',');
    input.onchange = () => resolve([...(input.files || [])].map((f) => { const id = `web-file:${++n}/${f.name}`; files.set(id, f); return id; }));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
  const store = (k: string) => `xeno-tool:${toolId}:${k}`;

  return {
    mode: 'standalone',
    env: { online: navigator.onLine, credits: true, nativeConvert: false, imagegen: true },
    fs: {
      openDialog: (opts) => pick(opts || {}),
      // no save dialog on the web: the name is kept and writeFile downloads the bytes under it
      async saveDialog(opts) { const name = (opts?.defaultPath || 'output').split(/[\\/]/).pop() || 'output'; return `web-save:${++n}/${name}`; },
      async readFile(path) { const f = files.get(path); if (!f) throw new Error('That file is not open in this tool.'); return new Uint8Array(await f.arrayBuffer()); },
      async writeFile(path, data) {
        const name = path.split('/').pop() || 'output';
        files.set(path, new Blob([data]));
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data])); a.download = name;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
      },
    },
    llm: {
      async chat(req: ChatRequest) {
        const j = await call('POST', '/api/ai/chat', { model: req.model || 'auto', messages: req.messages, temperature: req.temperature, max_tokens: req.maxTokens });
        return { content: String(j?.choices?.[0]?.message?.content ?? j?.content ?? '') };
      },
      // one chunk: the whole reply. Streaming over /api/ai/chat/stream is the next step, not a different answer.
      async *stream(req: ChatRequest) { yield { delta: (await this.chat(req)).content }; },
    },
    inference: { async run() { throw new NeedsHubError('Running a local AI model'); } },
    imagegen: {
      async generate(req: ImageGenRequest) {
        const j = await call('POST', '/api/xeno/images/generate', { prompt: req.prompt, n: req.n, model: req.model || 'auto', ...sizeOf(req.size) });
        return { images: (j?.data || []).map(dataUrlOf).filter(Boolean) };
      },
      async edit(req: ImageEditRequest) {
        if (!req.images?.[0]) throw new Error('imagegen.edit requires at least one image.');
        const j = await call('POST', '/api/xeno/images/edit', { prompt: req.prompt, image: req.images[0], model: req.model || 'auto' });
        return { images: (j?.data || []).map(dataUrlOf).filter(Boolean) };
      },
    },
    font: { async trace() { throw new NeedsHubError('Tracing glyphs'); }, async compile() { throw new NeedsHubError('Compiling a font'); } },
    convert: { async run() { throw new NeedsHubError('Native file conversion'); } },
    capture: {
      async screen() {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        try {
          const v = document.createElement('video'); v.srcObject = stream; v.muted = true; await v.play();
          const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
          c.getContext('2d')!.drawImage(v, 0, 0);
          const b: Blob = await new Promise((r) => c.toBlob((x) => r(x!), 'image/png'));
          return new Uint8Array(await b.arrayBuffer());
        } finally { stream.getTracks().forEach((t) => t.stop()); }
      },
    },
    clipboard: { readText: () => navigator.clipboard.readText(), writeText: (t) => navigator.clipboard.writeText(t) },
    storage: {
      async get(k) { try { return localStorage.getItem(store(k)); } catch { return null; } },
      async set(k, v) { try { localStorage.setItem(store(k), v); } catch { /* private mode */ } },
      async remove(k) { try { localStorage.removeItem(store(k)); } catch { /* private mode */ } },
      async keys() { const p = store(''); try { return Object.keys(localStorage).filter((x) => x.startsWith(p)).map((x) => x.slice(p.length)); } catch { return []; } },
    },
    credits: {
      async balance() { const j = await call('GET', '/api/v2/ledger/balance'); return Number(j?.availableMicro || 0) / 1_000_000; },
      // what a tool does is billed by the call itself (chat, image generation); a tool never charges directly here
      async charge() { throw new Error('On the web, a tool is billed by the work it asks for, not by a direct charge.'); },
    },
    notify: (level, message) => notify(level, message),
    telemetry: () => { /* nothing leaves the page for telemetry yet */ },
  };
}
