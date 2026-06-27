import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Download, AlertTriangle } from 'lucide-react';
import { assetUrl, type Release } from '../../lib/productCatalog';

/* Shared renderer for a product's release / patch / hotfix history.
   Used both on the product overview (recent, limited) and the full
   /product/:slug/releases feed. */

const PLATFORMS: { key: 'windows' | 'mac' | 'linux'; name: string }[] = [
  { key: 'windows', name: 'Windows' },
  { key: 'mac', name: 'macOS' },
  { key: 'linux', name: 'Linux' },
];

function TypeBadge({ r }: { r: Release }) {
  const t = r.type ?? 'release';
  if (t === 'hotfix') {
    return <span className="inline-flex items-center gap-1 rounded-[4px] border border-[#ff6b6b]/30 bg-[#ff6b6b]/[0.08] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#ff8585]"><AlertTriangle className="h-2.5 w-2.5" />Hotfix</span>;
  }
  if (t === 'patch') {
    return <span className="rounded-[4px] border border-white/[0.10] bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#9b948a]">Patch</span>;
  }
  return <span className="rounded-[4px] border border-[#9f6fff]/25 bg-[#a760ff]/[0.08] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#b69dff]">Release</span>;
}

function ReleaseRow({ release, slug, defaultOpen, linkToDetail }: { release: Release; slug: string; defaultOpen: boolean; linkToDetail: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const hasAssets = release.assets && PLATFORMS.some((p) => (release.assets?.[p.key]?.length ?? 0) > 0);

  return (
    <div className="border-t border-white/[0.06]">
      <button onClick={() => setOpen(!open)} className="group flex w-full items-center justify-between gap-3 py-4 text-left">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="text-[16px] font-semibold text-[#e3ded5]">v{release.version}</span>
          <TypeBadge r={release} />
          {release.channel === 'beta' && <span className="rounded-[4px] border border-white/[0.10] px-1.5 py-0.5 text-[10px] font-medium text-[#827b71]">Beta</span>}
          {release.latest && <span className="rounded-[4px] border border-white/[0.10] px-1.5 py-0.5 text-[10px] font-medium text-[#827b71]">Latest</span>}
          {release.title && <span className="truncate text-[12.5px] text-[#827b71]">{release.title}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-[11.5px] text-[#69635b]">{release.date}</span>
          <span className="grid h-6 w-6 place-items-center rounded-[5px] bg-white/[0.03] transition-colors group-hover:bg-white/[0.06]">
            <ChevronDown className={`h-3.5 w-3.5 text-[#827b71] transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
          </span>
        </div>
      </button>

      {open && (
        <div className="pb-5">
          {release.notes && (
            <div className="whitespace-pre-line text-[13px] leading-[1.65] text-[#9b948a]">{release.notes}</div>
          )}
          {hasAssets && (
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              {PLATFORMS.map((p) => {
                const assets = release.assets?.[p.key] ?? [];
                return (
                  <div key={p.key} className="rounded-[10px] border border-white/[0.06] bg-white/[0.015] p-3">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[#69635b]">{p.name}</div>
                    {assets.length === 0 ? (
                      <p className="text-[12px] italic text-[#5d5850]">—</p>
                    ) : assets.map((a) => (
                      <a key={a.file} href={assetUrl(slug, a.file)} className="group flex items-center justify-between py-1.5 text-[12.5px] text-[#9b948a] transition-colors hover:text-white">
                        {a.label}<Download className="h-3.5 w-3.5 text-[#5d5850] transition-colors group-hover:text-white" />
                      </a>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
          {linkToDetail && (
            <Link to={`/product/${slug}/releases/${release.version}`} className="mt-3 inline-block text-[12.5px] text-[#827b71] transition-colors hover:text-white">Permalink →</Link>
          )}
        </div>
      )}
    </div>
  );
}

const ReleaseFeed: React.FC<{ releases: Release[]; slug: string; limit?: number; linkToDetail?: boolean }> = ({ releases, slug, limit, linkToDetail = true }) => {
  const list = limit ? releases.slice(0, limit) : releases;
  if (list.length === 0) {
    return (
      <div className="rounded-[12px] border border-white/[0.06] bg-[#0d0d0d] px-6 py-10 text-center">
        <p className="text-[13px] text-[#827b71]">No releases published yet. Check back soon.</p>
      </div>
    );
  }
  return (
    <div className="border-b border-white/[0.06]">
      {list.map((r, i) => (
        <ReleaseRow key={r.version} release={r} slug={slug} defaultOpen={i === 0} linkToDetail={linkToDetail} />
      ))}
    </div>
  );
};

export default ReleaseFeed;
