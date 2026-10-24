import React from 'react';
import { Link } from 'react-router-dom';
import { Download, AlertTriangle } from 'lucide-react';
import ExperimentalNotice from '../ExperimentalNotice';
import { downloadLink, getProduct, type Release } from '../../../lib/productCatalog';
import { downloadClickHandler } from '../../../lib/startDownload';
import { INK, MUTED, FAINT, MONO, fmtDate } from './V2Page';

/* One release in the v2 language: its badges, notes and per-OS installer links.
   Shared by /releases (the list) and /releases/<version> (the permalink). Every
   installer link goes through the grant handler, like every other Download control
   (scripts/download-gate.test.mjs). */

export const OSES: { key: 'windows' | 'mac' | 'linux'; name: string }[] = [
  { key: 'windows', name: 'Windows' }, { key: 'mac', name: 'macOS' }, { key: 'linux', name: 'Linux' },
];

export const hasAssets = (r: Release) => !!r.assets && OSES.some((o) => (r.assets?.[o.key]?.length ?? 0) > 0);

export const TypeBadge: React.FC<{ release: Release }> = ({ release }) => {
  const t = release.type ?? 'release';
  const style = t === 'hotfix'
    ? { background: '#FDE8E4', color: '#9F2A16' }
    : t === 'patch' ? { background: '#EFECE6', color: MUTED } : { background: INK, color: '#F6F4F0' };
  return (
    <span style={{ fontFamily: MONO, ...style }} className="inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 text-[10.5px] uppercase tracking-[.04em]">
      {t === 'hotfix' && <AlertTriangle className="h-3 w-3" />}{t === 'hotfix' ? 'Hotfix' : t === 'patch' ? 'Patch' : 'Release'}
    </span>
  );
};

export const ReleaseDownloads: React.FC<{ release: Release; slug: string }> = ({ release, slug }) => {
  const product = getProduct(slug);
  if (!product || !hasAssets(release)) return null;
  return (
    <div className="mt-5">
      {/* Every installer link here starts a download, so the notice belongs here too. */}
      <ExperimentalNotice product={product} variant="line" tone="paper" className="mb-3" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {OSES.map((o) => {
          const assets = release.assets?.[o.key] ?? [];
          return (
            <div key={o.key} className="rounded-[10px] bg-white p-3 shadow-[0_0_0_1px_rgba(29,27,24,.08)]">
              <div style={{ fontFamily: MONO, color: FAINT }} className="mb-1.5 text-[10.5px] uppercase tracking-[.06em]">{o.name}</div>
              {assets.length === 0 ? <div className="text-[13px]" style={{ color: FAINT }}>Not available</div> : assets.map((a) => (
                <a key={a.file} href={downloadLink(product, o.key, release.version)} onClick={downloadClickHandler(product.slug, o.key, release.version)}
                  className="group flex items-center justify-between gap-2 rounded-[6px] py-1.5 text-[13.5px] font-medium" style={{ color: INK }}>
                  <span className="min-w-0 truncate">{a.label}</span><Download className="h-3.5 w-3.5 shrink-0 opacity-50 transition-opacity group-hover:opacity-100" />
                </a>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const ReleaseMeta: React.FC<{ release: Release; latest?: boolean; accent: { raw: string; text: string } }> = ({ release, latest, accent }) => (
  <div className="flex flex-wrap items-center gap-2">
    <TypeBadge release={release} />
    {release.channel === 'beta' && <span style={{ fontFamily: MONO, color: MUTED }} className="rounded-[5px] bg-[#EFECE6] px-1.5 py-0.5 text-[10.5px] uppercase tracking-[.04em]">Beta</span>}
    {latest && <span style={{ fontFamily: MONO, background: accent.raw + '22', color: accent.text }} className="rounded-[5px] px-1.5 py-0.5 text-[10.5px] uppercase tracking-[.04em]">Latest</span>}
    <span style={{ fontFamily: MONO, color: FAINT }} className="text-[12px]">{fmtDate(release.date)}</span>
  </div>
);

export const PermalinkRow: React.FC<{ slug: string; version: string; color: string }> = ({ slug, version, color }) => (
  <Link to={`/product/${slug}/releases/${version}`} className="mt-4 inline-block text-[13.5px] font-semibold" style={{ color }}>Permalink →</Link>
);

