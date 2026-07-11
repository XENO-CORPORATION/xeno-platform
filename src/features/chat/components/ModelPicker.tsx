import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Check, Search, Sparkles } from 'lucide-react';
import { getGroupedModels, FALLBACK_MODELS, type GroupedModels, type Model } from '@/services/modelService';
import { useChatStore } from '../store';

/** Prettify a model id for a compact button label. */
function shortLabel(all: GroupedModels[], id: string): string {
  for (const g of all) {
    const m = g.models.find((x) => x.id === id);
    if (m) return m.name;
  }
  return id.split('/').pop() || id;
}

const ModelPicker: React.FC = () => {
  const selectedModel = useChatStore((s) => s.selectedModel);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);

  const [groups, setGroups] = useState<GroupedModels[]>(FALLBACK_MODELS);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    getGroupedModels()
      .then((g) => {
        if (alive && g.length) setGroups(g);
      })
      .catch(() => {
        /* keep FALLBACK_MODELS */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        models: g.models.filter(
          (m) => m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q) || g.companyName.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.models.length > 0);
  }, [groups, query]);

  const label = shortLabel(groups, selectedModel);

  const pick = (m: Model) => {
    setSelectedModel(m.id);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[13px] font-medium text-white/80 transition-colors hover:bg-white/[0.07]"
      >
        <Sparkles size={13} className="text-[#a760ff]" />
        <span className="max-w-[180px] truncate">{label}</span>
        <ChevronDown size={14} className="text-white/40" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 max-h-[380px] w-[300px] overflow-hidden rounded-xl border border-white/10 bg-[#141414] shadow-2xl shadow-black/50">
          <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2">
            <Search size={14} className="text-white/35" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search models…"
              autoFocus
              className="w-full bg-transparent text-[13px] text-white/85 placeholder:text-white/30 focus:outline-none"
            />
          </div>
          <div className="max-h-[320px] overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-center text-[13px] text-white/40">No models found</div>
            )}
            {filtered.map((g) => (
              <div key={g.companyName} className="py-1">
                <div className="px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white/35">
                  {g.companyName}
                </div>
                {g.models.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => pick(m)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-white/80 transition-colors hover:bg-white/[0.06]"
                  >
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                    {m.id === selectedModel && <Check size={14} className="text-[#a760ff]" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ModelPicker;
