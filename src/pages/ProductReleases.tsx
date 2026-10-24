import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { V2Page, useAccent, Eyebrow, H1, INK, MUTED, FAINT, LINE, MONO } from '../components/product/v2/V2Page';
import { ReleaseMeta, ReleaseDownloads, PermalinkRow } from '../components/product/v2/ReleaseEntry';
import { getProduct, fetchReleases, type Release } from '../lib/productCatalog';

/* /product/:slug/releases — every release, patch and hotfix, newest first, in the
   v2 design language. Filterable by kind (and channel, when a beta exists); each
   entry opens to its notes and installers, and links to its permalink. */

type Kind = 'all' | 'release' | 'patch' | 'hotfix';
const KINDS: [Kind, string][] = [['all', 'All'], ['release', 'Releases'], ['patch', 'Patches'], ['hotfix', 'Hotfixes']];

const Chip: React.FC<{ on: boolean; onClick: () => void; children: React.ReactNode; count?: number }> = ({ on, onClick, children, count }) => (
  <button type="button" onClick={onClick} aria-pressed={on}
    className="flex h-9 items-center gap-2 rounded-[8px] px-3.5 text-[14px] font-semibold transition-colors"
    style={{ background: on ? INK : '#FFFFFF', color: on ? '#F6F4F0' : INK, boxShadow: on ? 'none' : 'inset 0 0 0 1px #DDD8D0' }}>
    {children}{count !== undefined && <span style={{ fontFamily: MONO, opacity: 0.6 }} className="text-[11px]">{count}</span>}
  </button>
);

const ProductReleases: React.FC = () => {
  const { slug } = useParams();
  const product = getProduct(slug);
  const accent = useAccent(slug || '');
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<Kind>('all');
  const [beta, setBeta] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!product) return;
    fetchReleases(product).then((r) => { setReleases(r); setLoading(false); });
  }, [product]);

  const hasBeta = releases.some((r) => r.channel === 'beta');
  const shown = useMemo(() => releases.filter((r) => (kind === 'all' || (r.type ?? 'release') === kind) && (beta || r.channel !== 'beta')), [releases, kind, beta]);
  const count = (k: Kind) => releases.filter((r) => k === 'all' || (r.type ?? 'release') === k).length;

  if (!product) return <Navigate to="/" replace />;

  return (
    <V2Page product={product.name}>
      <section style={{ padding: 'clamp(36px,6vh,72px) 24px 32px' }}>
        <div className="mx-auto max-w-[1100px]">
          <Link to={`/product/${product.slug}`} className="text-[14px] font-medium" style={{ color: MUTED }}>← {product.name}</Link>
          <div className="mt-8 flex flex-wrap items-end justify-between gap-x-14 gap-y-6">
            <div className="min-w-0 flex-[1_1_520px]">
              <Eyebrow color={accent.text}>Release notes</Eyebrow>
              <H1>What’s new in {product.name}.</H1>
            </div>
            <p className="m-0 flex-[0_1_360px] pb-2 text-[17px] leading-[1.55]" style={{ color: MUTED }}>
              Every release, patch and hotfix, newest first.{product.delivery === 'desktop' && <> <Link to={`/product/${product.slug}/download`} className="font-semibold" style={{ color: accent.text }}>Download the latest →</Link></>}
            </p>
          </div>
        </div>
      </section>

      <section style={{ padding: '0 24px 110px' }}>
        <div className="mx-auto max-w-[1100px]">
          {releases.length > 1 && (
            <div className="mb-6 flex flex-wrap items-center gap-2">
              {KINDS.filter(([k]) => k === 'all' || count(k) > 0).map(([k, l]) => <Chip key={k} on={kind === k} onClick={() => setKind(k)} count={count(k)}>{l}</Chip>)}
              {hasBeta && <span className="mx-1 h-6 w-px" style={{ background: LINE }} />}
              {hasBeta && <Chip on={beta} onClick={() => setBeta(!beta)}>Include beta</Chip>}
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-20"><Loader2 className="h-5 w-5 animate-spin" style={{ color: FAINT }} /></div>
          ) : shown.length === 0 ? (
            <div className="rounded-[14px] bg-white px-6 py-14 text-center text-[15px] shadow-[0_0_0_1px_rgba(29,27,24,.08)]" style={{ color: MUTED }}>
              {releases.length === 0 ? 'No releases published yet. Check back soon.' : 'Nothing matches this filter.'}
            </div>
          ) : (
            <div style={{ borderTop: `1px solid ${INK}` }}>
              {shown.map((r) => {
                const isOpen = open[r.version] ?? r.version === releases[0]?.version;
                return (
                  <article key={r.version} className="grid grid-cols-1 gap-x-10 gap-y-3 py-8 md:grid-cols-[200px_minmax(0,1fr)]" style={{ borderBottom: `1px solid ${LINE}` }}>
                    <div>
                      <Link to={`/product/${product.slug}/releases/${r.version}`} style={{ fontFamily: MONO, color: INK }} className="text-[22px] font-medium tracking-[-0.02em]">v{r.version}</Link>
                      <div className="mt-2"><ReleaseMeta release={r} latest={r.version === releases[0]?.version} accent={accent} /></div>
                    </div>
                    <div className="min-w-0">
                      <button type="button" onClick={() => setOpen({ ...open, [r.version]: !isOpen })} aria-expanded={isOpen}
                        className="flex w-full items-start justify-between gap-4 text-left">
                        <span className="text-[20px] font-semibold leading-[1.3] tracking-[-0.01em]">{r.title || `${product.name} ${r.version}`}</span>
                        <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full transition-transform duration-300"
                          style={{ boxShadow: 'inset 0 0 0 1px #D6D0C7', transform: isOpen ? 'rotate(45deg)' : 'none' }}>
                          <svg width="11" height="11" viewBox="0 0 12 12"><path d="M6 1.5v9M1.5 6h9" stroke={INK} strokeWidth="1.6" strokeLinecap="round" /></svg>
                        </span>
                      </button>
                      <div className="grid transition-[grid-template-rows] duration-300" style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}>
                        <div className="min-h-0 overflow-hidden">
                          {r.notes && <div className="mt-3 max-w-[720px] whitespace-pre-line text-[15.5px] leading-[1.65]" style={{ color: MUTED }}>{r.notes}</div>}
                          <ReleaseDownloads release={r} slug={product.slug} />
                          <PermalinkRow slug={product.slug} version={r.version} color={accent.text} />
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </V2Page>
  );
};

export default ProductReleases;
