/**
 * xenosystem.ai/tools (tools.xenosystem.ai redirects here): say what you want to do and the XENO tools that fit are
 * offered, best first, from GET /api/tools/suggest; every tool is listed below. Choosing one opens /tools/<id>, which
 * mounts it (main.tsx). "Create my own" is announced, not built: it says coming soon and does nothing else.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface ToolRow { id: string; name: string; description: string; category: string; version: string; contract: string; web: { runs: boolean; needsHub: string[] }; score?: number }

const T = { page: '#060606', card: '#101010', cardHi: '#151515', line: 'rgba(255,255,255,0.06)', title: '#ece7df', body: '#948d83', dim: '#69635b' };
const EXAMPLES = ['Remove the background from my logo', 'Turn a voice memo into text', 'Make a LinkedIn banner from a photo', 'Merge two PDFs', 'What font is this?'];

function Card({ t, onOpen }: { t: ToolRow; onOpen: (id: string) => void }) {
  return (
    <button data-tools-card={t.id} onClick={() => onOpen(t.id)} style={{ textAlign: 'left', padding: 18, borderRadius: 14, background: T.card, border: `1px solid ${T.line}`, color: T.title, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 120 }}>
      <b style={{ fontSize: 15, fontWeight: 600 }}>{t.name}</b>
      <span style={{ fontSize: 13, color: T.body, lineHeight: 1.45 }}>{t.description}</span>
      <span style={{ marginTop: 'auto', fontSize: 12, color: T.dim }}>{t.web.needsHub.length ? `Needs XENO Hub for ${t.web.needsHub.join(', ')}` : 'Runs in your browser'}</span>
    </button>
  );
}

export function Picker({ onOpen }: { onOpen: (id: string) => void }) {
  const [all, setAll] = useState<ToolRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [asked, setAsked] = useState('');
  const [fit, setFit] = useState<ToolRow[] | null>(null);
  const [soon, setSoon] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    document.title = 'XENO Tools';
    fetch('/api/tools').then((r) => r.json()).then((j) => setAll((j.tools || []).filter((t: ToolRow) => t.contract === 'tool@1'))).catch(() => setError('XENO tools could not be reached. Try again in a moment.'));
    input.current?.focus();
  }, []);

  const ask = async (q: string) => {
    const v = q.trim(); if (!v) return;
    setText(v); setAsked(v); setFit(null);
    try { const j = await (await fetch('/api/tools/suggest?q=' + encodeURIComponent(v))).json(); setFit(j.tools || []); } catch { setFit([]); }
  };
  const grid = useMemo(() => ({ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }) as React.CSSProperties, []);

  return (
    <div data-tools-picker style={{ minHeight: '100%', background: T.page, color: T.title, padding: '56px 16px 80px', boxSizing: 'border-box' }}>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <p style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.dim, margin: 0 }}>XENO Tools</p>
        <h1 style={{ fontSize: 'clamp(28px, 4vw, 44px)', fontWeight: 600, margin: '10px 0 8px', letterSpacing: '-0.02em' }}>What do you want to do?</h1>
        <p style={{ color: T.body, margin: '0 0 24px', fontSize: 15 }}>Describe it in your own words and we’ll suggest the tools for it.</p>

        <form onSubmit={(e) => { e.preventDefault(); ask(text); }} style={{ background: T.cardHi, border: `1px solid ${T.line}`, borderRadius: 16, padding: 12, display: 'flex', gap: 10, alignItems: 'flex-end' }}>
          <textarea ref={input} data-tools-input value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="e.g. remove the background from my product photo"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(text); } }}
            style={{ flex: 1, resize: 'none', background: 'transparent', border: 0, outline: 'none', color: T.title, fontSize: 15, lineHeight: 1.5, fontFamily: 'inherit' }} />
          <button type="submit" data-tools-ask disabled={!text.trim()} style={{ padding: '10px 16px', borderRadius: 10, border: 0, background: text.trim() ? T.title : '#2a2a2a', color: text.trim() ? '#0b0b0b' : T.dim, fontWeight: 600, cursor: text.trim() ? 'pointer' : 'default' }}>Find tools</button>
        </form>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {EXAMPLES.map((x) => <button key={x} onClick={() => ask(x)} style={{ padding: '6px 12px', borderRadius: 999, border: `1px solid ${T.line}`, background: 'transparent', color: T.body, fontSize: 13, cursor: 'pointer' }}>{x}</button>)}
        </div>

        {asked && (
          <section data-tools-results style={{ marginTop: 36 }}>
            <h2 style={{ fontSize: 14, color: T.body, fontWeight: 500, margin: '0 0 12px' }}>For “{asked}”</h2>
            {fit === null ? <p style={{ color: T.dim }}>Finding tools…</p> : (
              <div style={grid}>
                {fit.map((t) => <Card key={t.id} t={t} onOpen={onOpen} />)}
                <button data-tools-create onClick={() => setSoon(true)} style={{ textAlign: 'left', padding: 18, borderRadius: 14, background: 'transparent', border: `1px dashed rgba(255,255,255,0.14)`, color: T.title, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 120 }}>
                  <b style={{ fontSize: 15, fontWeight: 600 }}>Create my own</b>
                  <span style={{ fontSize: 13, color: T.body, lineHeight: 1.45 }}>{fit.length ? 'Not quite it? Describe the tool and XENO builds it for you.' : 'No tool does this yet. Describe it and XENO builds it for you.'}</span>
                  <span data-tools-soon={soon ? 'shown' : undefined} style={{ marginTop: 'auto', fontSize: 12, color: T.dim }}>{soon ? 'Coming soon — we’ll tell you when it’s ready.' : 'Coming soon'}</span>
                </button>
              </div>
            )}
          </section>
        )}

        <section style={{ marginTop: 48 }}>
          <h2 style={{ fontSize: 14, color: T.body, fontWeight: 500, margin: '0 0 12px' }}>All tools</h2>
          {error ? <p data-tools-error style={{ color: T.body }}>{error}</p> : !all ? <p style={{ color: T.dim }}>Loading…</p> : (
            <div style={grid} data-tools-all>{all.map((t) => <Card key={t.id} t={t} onOpen={onOpen} />)}</div>
          )}
        </section>
      </div>
    </div>
  );
}
