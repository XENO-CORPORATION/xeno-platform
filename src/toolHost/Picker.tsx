/**
 * xenosystem.ai/tools (tools.xenosystem.ai redirects here) — XENO Tools, its own product. Type what you want and the
 * tools that fit come first, updated as you type: an instant local match, then GET /api/tools/suggest re-ranks.
 * Choosing one opens /tools/<id> (main.tsx). "Create my own" appears once something is typed; it opens Workshop with
 * those words ready to send. Workshop does not yet make the project itself, and saving to My tools is not built: the
 * dialog says so. Design: https://claude.ai/artifact/EYy1EHJsDN8nFDecuBvi21 · styles: tools.css.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Header, Plus, Arrow } from './chrome';
import { toolPath } from './where';

export interface ToolRow { id: string; name: string; description: string; category: string; version: string; contract: string; web: { runs: boolean; needsHub: string[] }; score?: number }

const WORKSHOP = 'https://workshop.xenosystem.ai/';
const CATS: [string, string][] = [['all', 'All'], ['generator', 'Generate'], ['extractor', 'Extract'], ['converter', 'Convert'], ['ai', 'AI'], ['capture', 'Capture'], ['utility', 'Documents']];
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATS.slice(1));
const EXAMPLES = ['Remove the background from my logo', 'Turn a voice memo into text', 'Merge two PDFs', 'What font is this?', 'Make an investor deck', 'Upscale a photo'];

const ICON: Record<string, string> = {
  generator: 'M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4M3.5 3.5l2.2 2.2M10.3 10.3l2.2 2.2M12.5 3.5l-2.2 2.2M5.7 10.3l-2.2 2.2',
  extractor: 'M4 1.5v10.5h10.5M1.5 4H12v10.5',
  converter: 'M2 5h11M10 2l3 3-3 3M14 11H3M6 8l-3 3 3 3',
  ai: 'M4 4h8v8H4zM6.5 1.5V4M9.5 1.5V4M6.5 12v2.5M9.5 12v2.5M1.5 6.5H4M1.5 9.5H4M12 6.5h2.5M12 9.5h2.5',
  capture: 'M1.5 5V1.5H5M11 1.5h3.5V5M14.5 11v3.5H11M5 14.5H1.5V11M6 6h4v4H6z',
  utility: 'M3 1.5h7l3 3v10H3zM5.5 7h5M5.5 9.5h5M5.5 12h3',
};
const CatIcon = ({ cat }: { cat: string }) => (
  <span className="xt-ico"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d={ICON[cat] || ICON.utility} stroke="currentColor" strokeWidth="1.4" /></svg></span>
);

// words that say nothing about the job ("remove the background from my logo" → remove, background, logo)
const STOP = new Set(['the', 'and', 'for', 'from', 'with', 'into', 'this', 'that', 'what', 'want', 'need', 'make', 'some', 'can', 'how', 'you', 'your', 'mine', 'our', 'out', 'all', 'get', 'use', 'any']);
const words = (q: string) => q.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
function localScore(t: ToolRow, ws: string[]) {
  const name = t.name.toLowerCase(), hay = `${name} ${t.description} ${t.category} ${t.id}`.toLowerCase();
  return ws.reduce((s, w) => s + (name.includes(w) ? 3 : 0) + (hay.includes(w) ? 1 : 0), 0);
}

function Card({ t, best, onOpen }: { t: ToolRow; best: boolean; onOpen: (id: string) => void }) {
  return (
    <a className="xt-card" data-tools-card={t.id} href={toolPath(t.id)} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); onOpen(t.id); }}>
      <div className="xt-card-top">
        <CatIcon cat={t.category} />
        <b className="xt-card-name">{t.name}</b>
        {best && <span className="xt-best xt-mono">Best match</span>}
      </div>
      <span className="xt-desc">{t.description}</span>
      <div className="xt-card-foot">
        <span className="xt-cat xt-mono">{CAT_LABEL[t.category] || t.category}</span>
        <span className="xt-sep" aria-hidden="true" />
        <span className="xt-where">{t.web.needsHub.length ? `Needs XENO Hub for ${t.web.needsHub.join(', ')}` : 'Runs in your browser'}</span>
        <Arrow className="xt-go" />
      </div>
    </a>
  );
}

function CreateDialog({ start, onClose }: { start: string; onClose: () => void }) {
  const [what, setWhat] = useState(start);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const go = () => { const v = what.trim(); if (v) location.href = WORKSHOP + '?start=' + encodeURIComponent(v); };
  return (
    <div className="xt-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="xt-dlg" role="dialog" aria-modal="true" aria-labelledby="xt-ct" data-tools-create-dialog>
        <div className="xt-plate xt-plate-top">
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <b id="xt-ct" style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-.01em' }}>Create my own tool</b>
            <span style={{ fontSize: 12.5, color: 'var(--dim)' }}>Built with the XENO Agent in Workshop</span>
          </div>
          <button type="button" className="xt-x" aria-label="Close" onClick={onClose}><svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" /></svg></button>
        </div>
        <div className="xt-plate xt-plate-mid">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label className="xt-label" htmlFor="xt-what">What should it do?</label>
            <textarea id="xt-what" ref={ref} className="xt-fld" rows={4} value={what} onChange={(e) => setWhat(e.target.value)} style={{ resize: 'none', lineHeight: 1.5 }} data-tools-create-what />
            <span style={{ fontSize: 12, color: 'var(--dim)' }}>Carried over from your search. The Agent starts from these words.</span>
          </div>
          <ol className="xt-steps">
            <li><span className="xt-step-n xt-mono">1</span><span><b>Workshop opens with your words</b><span className="t">Sign in there if you are not already. Your description is ready to send to the Agent.</span></span></li>
            <li><span className="xt-step-n xt-mono">2</span><span><b>The Agent builds it with you</b><span className="t">You watch it run beside the conversation and ask for changes until it is right.</span></span></li>
            <li><span className="xt-step-n xt-mono">3</span><span><b>Keep it</b><span className="t">Saving what you made to My tools is the next part we are building.</span></span></li>
          </ol>
        </div>
        <div className="xt-plate xt-plate-bot">
          <span className="xt-mono" style={{ flex: 1, fontSize: 11, color: 'var(--dim)' }}>Opens workshop.xenosystem.ai</span>
          <button type="button" className="xt-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="xt-prim" onClick={go} disabled={!what.trim()} data-tools-create-go>Open in Workshop<Arrow /></button>
        </div>
      </div>
    </div>
  );
}

export function Picker({ onOpen }: { onOpen: (id: string) => void }) {
  const [all, setAll] = useState<ToolRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState(() => new URLSearchParams(location.search).get('q') || '');
  const [server, setServer] = useState<{ q: string; scores: Map<string, number> } | null>(null);
  const [cat, setCat] = useState('all');
  const [browserOnly, setBrowserOnly] = useState(false);
  const [tab, setTab] = useState<'all' | 'mine'>('all');
  const [creating, setCreating] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    document.title = 'XENO Tools';
    fetch('/api/tools').then((r) => r.json()).then((j) => setAll((j.tools || []).filter((t: ToolRow) => t.contract === 'tool@1'))).catch(() => setError('XENO Tools could not be reached. Try again in a moment.'));
    input.current?.focus();
  }, []);

  // the server's ranking, a moment after typing stops; the local match shows meanwhile
  const q = text.trim();
  useEffect(() => {
    if (words(q).length === 0) { setServer(null); return; }
    const t = setTimeout(() => {
      fetch('/api/tools/suggest?q=' + encodeURIComponent(q)).then((r) => r.json())
        .then((j) => setServer({ q, scores: new Map((j.tools || []).map((x: ToolRow) => [x.id, Number(x.score) || 0])) })).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const ws = useMemo(() => words(q), [q]);
  const shown = useMemo(() => {
    if (!all) return [];
    const srv = server && server.q === q ? server.scores : null;
    let list = all.filter((t) => (cat === 'all' || t.category === cat) && (!browserOnly || t.web.needsHub.length === 0))
      .map((t) => ({ t, s: ws.length ? localScore(t, ws) + (srv?.get(t.id) || 0) * 4 : 0 }));
    if (ws.length) list = list.filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
    return list;
  }, [all, cat, browserOnly, ws, server, q]);
  const best = ws.length && shown.length > 1 && shown[0].s > shown[1].s ? shown[0].t.id : ws.length && shown.length === 1 ? shown[0].t.id : null;

  const focusSearch = () => { setTab('all'); setTimeout(() => input.current?.focus(), 0); };

  return (
    <div className="xt xt-page" data-tools-picker>
      <Header tab={tab} onTab={setTab} onSearch={focusSearch} />
      {tab === 'mine' ? (
        <main className="xt-main">
          <div className="xt-empty" data-tools-mine>
            <b>No tools of your own yet.</b>
            <span>Tools you make with the XENO Agent will be kept here, with their versions. Saving a tool from Workshop is the part we are building next.</span>
            <button type="button" className="xt-ghost" onClick={focusSearch}>Find a tool</button>
          </div>
        </main>
      ) : (
        <main className="xt-main">
          <section className="xt-hero">
            <span className="xt-eyebrow xt-mono">XENO Tools</span>
            <h1 className="xt-h1">What do you want to do?</h1>
            <form className="xt-comp" onSubmit={(e) => e.preventDefault()}>
              <label className="xt-sr" htmlFor="xt-ask">Describe what you want to do</label>
              <textarea id="xt-ask" ref={input} rows={3} value={text} onChange={(e) => setText(e.target.value)} data-tools-input
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (shown[0]) onOpen(shown[0].t.id); } }}
                placeholder="Remove the background from my logo, turn a voice memo into text, merge two PDFs…" />
              <div className="xt-comp-row">
                <button type="button" className="xt-tog" aria-pressed={browserOnly} onClick={() => setBrowserOnly((v) => !v)} data-tools-browser-only><span className="xt-sw"><i /></span>Runs in my browser</button>
                <div style={{ flex: 1 }} />
                <span className="xt-hint xt-mono xt-wide">{q ? 'Enter opens the best match' : 'Type, and the tools that fit come first'}</span>
                {q && <button type="button" className="xt-prim" onClick={() => setCreating(true)} data-tools-create><Plus />Create my own</button>}
              </div>
            </form>
            <div className="xt-chips" aria-label="Suggestions">
              {EXAMPLES.map((x) => <button key={x} type="button" className="xt-chip" onClick={() => { setText(x); input.current?.focus(); }}>{x}</button>)}
            </div>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }} data-tools-results={q ? '' : undefined}>
            <div className="xt-listhead">
              <h2 className="xt-h2">{q ? `For “${q}”` : 'All tools'}</h2>
              <span className="xt-count">{all ? `${shown.length} ${shown.length === 1 ? 'tool' : 'tools'}` : ''}</span>
              <div style={{ flex: 1 }} />
              <div className="xt-seg" role="tablist" aria-label="Category">
                {CATS.map(([id, label]) => <button key={id} type="button" role="tab" className="xt-segb" aria-selected={cat === id} onClick={() => setCat(id)}>{label}</button>)}
              </div>
            </div>
            {error ? <p className="xt-note" data-tools-error>{error}</p> : !all ? <p className="xt-note">Loading…</p> : shown.length ? (
              <div className="xt-grid" data-tools-all>
                {shown.map(({ t }) => <Card key={t.id} t={t} best={t.id === best} onOpen={onOpen} />)}
                {q && (
                  <button type="button" className="xt-card xt-card-make" onClick={() => setCreating(true)} data-tools-create-card>
                    <span className="xt-ico xt-ico-make"><Plus /></span>
                    <b style={{ fontSize: 14, fontWeight: 600 }}>Not quite it?</b>
                    <span className="xt-desc">Describe the tool you need and build it with the XENO Agent in Workshop.</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="xt-empty" data-tools-none>
                <b>{q ? 'No tool does this yet.' : 'No tools match these filters.'}</b>
                <span>{q ? 'Describe it and build it with the XENO Agent in Workshop.' : 'Try another category, or turn off “Runs in my browser”.'}</span>
                {q && <button type="button" className="xt-prim" onClick={() => setCreating(true)}><Plus />Create my own</button>}
              </div>
            )}
          </section>
        </main>
      )}
      {creating && <CreateDialog start={q} onClose={() => setCreating(false)} />}
    </div>
  );
}
