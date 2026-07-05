import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, CornerDownLeft } from 'lucide-react';
import { allDocRoutes } from '../../content/docs';

/* Client-side docs search (⌘K). Indexes every doc page's title/section/body in
 * memory and does a simple token-AND ranked match — no backend needed. */

function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DocsSearch: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);

  const index = useMemo(
    () => allDocRoutes().map((r) => ({ route: r, text: plainText(r.body).toLowerCase(), title: r.title.toLowerCase(), desc: (r.description || '').toLowerCase() })),
    [],
  );

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    const tokens = term.split(/\s+/).filter(Boolean);
    const scored = index
      .map((item) => {
        let score = 0;
        for (const t of tokens) {
          const inTitle = item.title.includes(t);
          const inDesc = item.desc.includes(t);
          const inBody = item.text.includes(t);
          if (!inTitle && !inDesc && !inBody) return null;
          score += inTitle ? 12 : 0;
          score += inDesc ? 4 : 0;
          score += inBody ? 1 : 0;
        }
        // snippet around first body hit
        const pos = item.text.indexOf(tokens[0]);
        const snippet = pos >= 0 ? item.text.slice(Math.max(0, pos - 40), pos + 80) : item.desc || '';
        return { route: item.route, score, snippet };
      })
      .filter((x): x is { route: any; score: number; snippet: string } => !!x)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    return scored;
  }, [q, index]);

  useEffect(() => {
    if (open) {
      setQ('');
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  useEffect(() => setCursor(0), [q]);

  if (!open) return null;

  const go = (slug: string, page: string) => {
    onClose();
    navigate(`/docs/${slug}/${page}`);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter' && results[cursor]) { e.preventDefault(); go(results[cursor].route.productSlug, results[cursor].route.pageSlug); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-[620px] overflow-hidden rounded-[14px] border border-white/[0.10] bg-[#0d0d10] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-white/[0.07] px-4">
          <Search className="h-4 w-4 shrink-0 text-[#69635b]" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search the docs…"
            className="w-full bg-transparent py-4 text-[15px] text-[#e3ded5] outline-none placeholder:text-[#5d5850]"
          />
          <kbd className="rounded-[4px] border border-white/[0.12] px-1.5 py-0.5 font-mono text-[10px] text-[#69635b]">Esc</kbd>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2">
          {q.trim() === '' ? (
            <p className="px-3 py-6 text-center text-[13px] text-[#5d5850]">Type to search every doc page.</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-[#827b71]">No results for “{q}”.</p>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.route.productSlug}/${r.route.pageSlug}`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(r.route.productSlug, r.route.pageSlug)}
                className={`flex w-full items-start gap-3 rounded-[9px] px-3 py-2.5 text-left transition-colors ${i === cursor ? 'bg-white/[0.05]' : 'hover:bg-white/[0.03]'}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wide text-[#69635b]">{r.route.productName} · {r.route.sectionTitle}</span>
                  </div>
                  <div className="text-[14px] font-medium text-[#e3ded5]">{r.route.title}</div>
                  {r.snippet && <div className="mt-0.5 truncate text-[12px] text-[#827b71]">{r.snippet}…</div>}
                </div>
                {i === cursor && <CornerDownLeft className="mt-1 h-3.5 w-3.5 shrink-0 text-[#69635b]" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default DocsSearch;
