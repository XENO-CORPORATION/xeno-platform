/**
 * My tools — tools a person made (XENO Artifacts of kind 'tool', docs/decisions/2026-10-29-personal-tools-are-artifacts.md).
 * The list reads GET /api/artifacts?kind=tool as the signed-in person. Opening one runs it SEALED: the page asks for a
 * view token and frames the raw files from the user-content origin, sandboxed, with no network and no cookies — the
 * same posture as every XENO Artifact. A person's tool is never XENO-signed and never runs with the page's privileges.
 */
import React, { useEffect, useState } from 'react';
import { Arrow, Header, Plus, useMe } from './chrome';
import { csrfToken, mineToolPath, signInUrl, siteUrl } from './where';

export interface MineRow { id: string; title: string; description?: string; category?: string; currentRevision: number; updatedAt: string }
const CAT: Record<string, string> = { generator: 'Generate', extractor: 'Extract', converter: 'Convert', ai: 'AI', capture: 'Capture', utility: 'Documents' };

export function MineList({ onFind }: { onFind: () => void }) {
  const me = useMe();
  const [rows, setRows] = useState<MineRow[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!me) return;
    fetch('/api/artifacts?kind=tool', { credentials: 'include' })
      .then(async (r) => { if (!r.ok) throw new Error(r.status === 401 ? 'signin' : 'Your tools could not be read.'); return r.json(); })
      .then((j) => setRows(j.artifacts || []))
      .catch((e) => setError(e.message === 'signin' ? '' : e.message));
  }, [me]);
  if (me === null) return (
    <div className="xt-empty" data-tools-mine>
      <b>Sign in to see your tools.</b>
      <span>Tools you make with the XENO Agent are kept in your account, with every version.</span>
      <a className="xt-prim" href={signInUrl(location.pathname + location.search)}>Sign in</a>
    </div>
  );
  if (error) return <p className="xt-note" data-tools-mine>{error}</p>;
  if (!rows) return <p className="xt-note">Loading…</p>;
  if (!rows.length) return (
    <div className="xt-empty" data-tools-mine>
      <b>No tools of your own yet.</b>
      <span>Type what you need under All tools and press Create my own: the XENO Agent builds it with you in Workshop, and it is kept here with its versions.</span>
      <button type="button" className="xt-ghost" onClick={onFind}><Plus />Make one</button>
    </div>
  );
  return (
    <div className="xt-grid" data-tools-mine>
      {rows.map((t) => (
        <a key={t.id} className="xt-card" href={mineToolPath(t.id)} data-tools-mine-card={t.id}>
          <div className="xt-card-top"><b className="xt-card-name">{t.title}</b></div>
          <span className="xt-desc">{t.description || 'A tool you made.'}</span>
          <div className="xt-card-foot">
            <span className="xt-cat xt-mono">{t.category ? CAT[t.category] || t.category : 'Yours'}</span>
            <span className="xt-sep" aria-hidden="true" />
            <span className="xt-where">Version {t.currentRevision}</span>
            <Arrow className="xt-go" />
          </div>
        </a>
      ))}
    </div>
  );
}

/** One tool the person made, running sealed. */
export function MineTool({ id }: { id: string }) {
  const [frame, setFrame] = useState<{ url: string; title: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    (async () => {
      try {
        const meta = await fetch('/api/artifacts/' + encodeURIComponent(id), { credentials: 'include' });
        if (meta.status === 401) { location.href = signInUrl(location.pathname); return; }
        if (!meta.ok) throw new Error('There is no tool of yours here.');
        const a = (await meta.json()).artifact;
        if (a.kind !== 'tool') throw new Error('This is a page, not a tool.');
        const vt = await fetch('/api/artifacts/' + encodeURIComponent(id) + '/view-token', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', 'x-xeno-csrf': csrfToken() }, body: '{}' });
        if (!vt.ok) throw new Error('This tool could not be opened.');
        const j = await vt.json();
        document.title = `${a.title} — XENO Tools`;
        setFrame({ url: j.frameUrl, title: a.title });
      } catch (e) { setError((e as Error).message); }
    })();
  }, [id]);
  return (
    <div className="xt xt-page" style={{ height: '100%' }} data-tools-mine-tool={id}>
      <Header toolName={frame?.title} />
      {error ? <div className="xt-msg" data-tool-error>{error} <a href={siteUrl('/workspace/library')} style={{ color: 'var(--text)' }}>Your files</a></div>
        : !frame ? <div className="xt-msg">Opening your tool…</div>
        : <iframe className="xt-tool" title={frame.title} src={frame.url} sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads" style={{ border: 0, width: '100%', flex: 1, background: '#fff' }} />}
    </div>
  );
}
