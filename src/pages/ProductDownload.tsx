import React, { useEffect, useState } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { Download, Check, Copy, Info, Loader2 } from 'lucide-react';
import ExperimentalNotice from '../components/product/ExperimentalNotice';
import { V2Page, useAccent, Eyebrow, H1, INK, MUTED, FAINT, LINE, MONO, fmtDate } from '../components/product/v2/V2Page';
import { getProduct, fetchReleases, downloadLink, type Release } from '../lib/productCatalog';
import { downloadClickHandler } from '../lib/startDownload';
import { getProductContent } from '../content/products';

/* /product/:slug/download — the dedicated download page (PRODUCT-PAGES-SPEC.md §3.3),
   in the v2 design language of the product page a visitor came from. Per-OS buttons hit
   the stable backend deep-links (302 → current installer) through the grant handler,
   with file size and checksum when present, plus a beta block when a newer beta exists.
   It is also where the design's own Download button lands when no grant is attached. */

type OS = 'windows' | 'mac' | 'linux';
const PLATFORMS: { key: OS; name: string; req: string }[] = [
  { key: 'windows', name: 'Windows', req: 'Windows 10 or later · 64-bit' },
  { key: 'mac', name: 'macOS', req: 'macOS 12 (Monterey) or later' },
  { key: 'linux', name: 'Linux', req: 'AppImage · 64-bit' },
];

function visitorOS(): OS {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
  return ua.includes('mac') ? 'mac' : ua.includes('linux') && !ua.includes('android') ? 'linux' : 'windows';
}

function fmtSize(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

const Checksum: React.FC<{ sha: string }> = ({ sha }) => {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { navigator.clipboard?.writeText(sha); setDone(true); setTimeout(() => setDone(false), 1600); }}
      title={sha}
      className="mt-2 flex w-full items-center gap-2 rounded-[7px] border border-[#E2DDD5] bg-[#F6F4F0] px-2.5 py-1.5 text-left transition-colors hover:bg-[#EFECE6]"
    >
      <span style={{ fontFamily: MONO }} className="min-w-0 flex-1 truncate text-[11px] text-[#5F5A52]">SHA-256 {sha}</span>
      {done ? <Check className="h-3.5 w-3.5 shrink-0 text-[#1F8A4C]" /> : <Copy className="h-3.5 w-3.5 shrink-0 text-[#8C867C]" />}
    </button>
  );
};

const ProductDownload: React.FC = () => {
  const { slug } = useParams();
  const product = getProduct(slug);
  const content = getProductContent(slug);
  const accent = useAccent(slug || '');
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const os = visitorOS();

  useEffect(() => {
    if (!product) return;
    fetchReleases(product).then((rs) => { setReleases(rs); setLoading(false); });
  }, [product]);

  if (!product) return <Navigate to="/" replace />;
  // Only downloadable (desktop) products have a download page.
  if (product.delivery !== 'desktop') return <Navigate to={`/product/${product.slug}`} replace />;

  const withAssets = (r: Release) => !!r.assets && (['windows', 'mac', 'linux'] as const).some((k) => (r.assets?.[k]?.length ?? 0) > 0);
  const stable = releases.find((r) => (r.channel ?? 'stable') === 'stable' && withAssets(r)) ?? releases.find(withAssets);
  const beta = releases.find((r) => r.channel === 'beta' && withAssets(r));
  const showBeta = beta && stable && beta.version !== stable.version;
  // Don't label a build "stable" when the feed says otherwise: `stable` falls back to
  // the newest asset-bearing release, which for a beta-only product is a beta entry —
  // and then its buttons must carry ?channel=beta, or the backend resolves another asset.
  const stableChannel: 'stable' | 'beta' = (stable?.channel ?? 'stable') === 'beta' ? 'beta' : 'stable';

  const cards = (rel: Release, channel: 'stable' | 'beta') => (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {PLATFORMS.map((p) => {
        const a = rel.assets?.[p.key]?.[0];
        const size = fmtSize(a?.size);
        const mine = p.key === os && !!a;
        return (
          <div key={p.key} className="flex flex-col rounded-[14px] bg-white p-5"
            style={{ boxShadow: mine ? `0 0 0 1.5px ${INK}, 0 24px 50px -30px rgba(29,27,24,.35)` : `0 0 0 1px ${a ? 'rgba(29,27,24,.1)' : LINE}`, opacity: a ? 1 : 0.75 }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[17px] font-semibold">{p.name}</span>
              {mine && <span style={{ fontFamily: MONO, background: accent.raw + '22', color: accent.text }} className="rounded-[5px] px-1.5 py-0.5 text-[10.5px]">your system</span>}
            </div>
            <div className="mt-1 text-[13px]" style={{ color: MUTED }}>{p.req}</div>
            {!a ? (
              <div style={{ fontFamily: MONO, color: FAINT }} className="mt-auto pt-6 text-[12px]">not available yet</div>
            ) : (
              <>
                <div style={{ fontFamily: MONO, color: MUTED }} className="mt-4 truncate text-[12px]" title={a.file}>{a.label}{size ? ` · ${size}` : ''}</div>
                <a
                  href={`${downloadLink(product, p.key)}${channel === 'beta' ? '?channel=beta' : ''}`}
                  onClick={downloadClickHandler(product.slug, p.key)}
                  className="mt-4 inline-flex items-center justify-center gap-2 rounded-[8px] px-4 py-3 text-[15px] font-medium transition-opacity hover:opacity-90"
                  style={{ background: mine ? INK : '#FFFFFF', color: mine ? '#F6F4F0' : INK, boxShadow: mine ? 'none' : 'inset 0 0 0 1px #D6D0C7' }}
                >
                  <Download className="h-4 w-4" />Download for {p.name}
                </a>
                {a.sha256 && <Checksum sha={a.sha256} />}
              </>
            )}
          </div>
        );
      })}
    </div>
  );

  const steps = content?.howItWorks ?? [];
  const recent = releases.slice(0, 3);

  return (
    <V2Page product={product.name}>
      <section style={{ padding: 'clamp(36px,6vh,72px) 24px 40px' }}>
        <div className="mx-auto max-w-[1100px]">
          <Link to={`/product/${product.slug}`} className="text-[14px] font-medium" style={{ color: MUTED }}>← {product.name}</Link>
          <div className="mt-8 flex flex-wrap items-end justify-between gap-x-14 gap-y-6">
            <div className="min-w-0 flex-[1_1_520px]">
              <Eyebrow color={accent.text}>Download</Eyebrow>
              <H1>Get {product.name}.</H1>
            </div>
            <div className="flex-[0_1_380px] pb-2 text-[17px] leading-[1.55]" style={{ color: MUTED }}>
              {loading ? 'Checking the latest build…' : stable
                ? <>Latest {stableChannel} <b style={{ color: INK, fontWeight: 600 }}>v{stable.version}</b>, released {fmtDate(stable.date)}. Sign in with your XENO account to download.</>
                : 'No public builds are available yet. Check back soon.'}
            </div>
          </div>
        </div>
      </section>

      <section style={{ padding: '0 24px 72px' }}>
        <div className="mx-auto max-w-[1100px]">
          {/* Caveats sit ABOVE the buttons: a warning read after downloading is not a warning. */}
          <div className={`grid grid-cols-1 items-start gap-3 ${content?.downloadNotice ? 'lg:grid-cols-2' : ''}`}>
            <ExperimentalNotice product={product} variant="band" tone="paper" />
            {content?.downloadNotice && (
              <div className="rounded-[12px] bg-[#EFECE6] p-[clamp(16px,1.6vw,22px)]" style={{ color: '#3F3B35' }}>
                <div className="flex items-center gap-2.5"><Info className="h-4 w-4 shrink-0" strokeWidth={1.8} /><span className="text-[15px] font-semibold">Specific to {product.name}</span></div>
                <p className="mt-2 text-[14px] leading-[1.6]">{content.downloadNotice}</p>
              </div>
            )}
          </div>

          <div className="mt-8">
            {loading ? (
              <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin" style={{ color: FAINT }} /></div>
            ) : stable ? cards(stable, stableChannel) : null}
          </div>

          {!loading && showBeta && (
            <div className="mt-12">
              <div className="mb-4 flex items-center gap-3">
                <Eyebrow color={accent.text}>Beta channel</Eyebrow>
                <span style={{ fontFamily: MONO }} className="rounded-[5px] bg-white px-2 py-0.5 text-[12px] shadow-[0_0_0_1px_rgba(29,27,24,.1)]">v{beta!.version}</span>
              </div>
              {cards(beta!, 'beta')}
            </div>
          )}

          {!loading && stable && (
            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-[14px]" style={{ color: MUTED }}>
              <span>
                {content?.autoUpdates === false
                  ? `This build does not update itself — reinstall from here to move to a newer ${product.name} version.`
                  : `Updates install automatically from inside ${product.name}.`}
              </span>
              <Link to={`/product/${product.slug}/releases`} className="font-semibold" style={{ color: accent.text }}>All versions &amp; release notes →</Link>
            </div>
          )}
        </div>
      </section>

      {steps.length > 0 && (
        <section style={{ borderTop: `1px solid ${LINE}`, padding: '80px 24px', background: '#FBFAF8' }}>
          <div className="mx-auto max-w-[1100px]">
            <Eyebrow color={accent.text}>After you download</Eyebrow>
            <h2 className="mt-3 text-[clamp(30px,3.6vw,46px)] font-bold leading-[1.02] tracking-[-0.035em]">Up and running in minutes.</h2>
            <ol className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
              {steps.map((s) => (
                <li key={s.step} className="rounded-[14px] bg-white p-6 shadow-[0_0_0_1px_rgba(29,27,24,.08)]">
                  <span style={{ fontFamily: MONO, color: accent.text }} className="text-[12px]">0{s.step}</span>
                  <div className="mt-3 text-[18px] font-semibold">{s.title}</div>
                  <p className="mt-2 text-[14.5px] leading-[1.55]" style={{ color: MUTED }}>{s.desc}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section style={{ borderTop: `1px solid ${LINE}`, padding: '80px 24px 100px' }}>
          <div className="mx-auto max-w-[1100px]">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <h2 className="m-0 text-[clamp(28px,3.2vw,40px)] font-bold tracking-[-0.03em]">Latest releases</h2>
              <Link to={`/product/${product.slug}/releases`} className="text-[14px] font-semibold" style={{ color: accent.text }}>View all →</Link>
            </div>
            <div className="mt-6" style={{ borderTop: `1px solid ${INK}` }}>
              {recent.map((r, i) => (
                <Link key={r.version} to={`/product/${product.slug}/releases/${r.version}`}
                  className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-6 gap-y-1 py-5 transition-colors hover:bg-[#EFECE6] sm:grid-cols-[120px_minmax(0,1fr)_auto]"
                  style={{ borderBottom: `1px solid ${LINE}`, color: INK }}>
                  <span style={{ fontFamily: MONO }} className="flex items-center gap-2 text-[13px]">v{r.version}
                    {i === 0 && <span className="rounded-[4px] px-1.5 py-0.5 text-[10.5px]" style={{ background: accent.raw + '22', color: accent.text }}>Latest</span>}</span>
                  <span className="min-w-0 truncate text-[16px] font-semibold">{r.title || `${product.name} ${r.version}`}</span>
                  <span style={{ fontFamily: MONO, color: FAINT }} className="hidden text-[12px] sm:block">{r.date}</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}
    </V2Page>
  );
};

export default ProductDownload;
