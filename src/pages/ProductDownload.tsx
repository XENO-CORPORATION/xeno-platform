import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link, Navigate } from 'react-router-dom';
import { ArrowLeft, Info, Download, Loader2, ShieldCheck } from 'lucide-react';
import Header from '../components/landing-v3/Header';
import Footer from '../components/landing-v3/Footer';
import { Reveal } from '../components/landing-v3/primitives';
import ExperimentalNotice from '../components/product/ExperimentalNotice';
import { getProduct, fetchReleases, downloadLink, type Release } from '../lib/productCatalog';
import { downloadClickHandler } from '../lib/startDownload';
import { getProductContent } from '../content/products';

/* /product/:slug/download — the dedicated download page (PRODUCT-PAGES-SPEC.md §3.3).
   Per-OS buttons hit the stable backend deep-links (302 → current installer), with
   file size + checksum when present, plus a beta block when a newer beta exists. */

const PLATFORMS: { key: 'windows' | 'mac' | 'linux'; name: string; req: string }[] = [
  { key: 'windows', name: 'Windows', req: 'Windows 10 or later · 64-bit' },
  { key: 'mac', name: 'macOS', req: 'macOS 12 (Monterey) or later' },
  { key: 'linux', name: 'Linux', req: 'AppImage · 64-bit' },
];

function fmtSize(bytes?: number): string | null {
  if (!bytes || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

const ProductDownload: React.FC = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const product = getProduct(slug);
  const content = getProductContent(slug);
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!product) return;
    fetchReleases(product).then((rs) => {
      setReleases(rs);
      setLoading(false);
    });
  }, [product]);

  if (!product) return <Navigate to="/" replace />;
  // Only downloadable (desktop) products have a download page.
  if (product.delivery !== 'desktop') return <Navigate to={`/product/${product.slug}`} replace />;

  const withAssets = (r: Release) => !!r.assets && (['windows', 'mac', 'linux'] as const).some((k) => (r.assets?.[k]?.length ?? 0) > 0);
  const stable = releases.find((r) => (r.channel ?? 'stable') === 'stable' && withAssets(r)) ?? releases.find(withAssets);
  const beta = releases.find((r) => r.channel === 'beta' && withAssets(r));
  const showBeta = beta && stable && beta.version !== stable.version;

  const channelBlock = (rel: Release, channel: 'stable' | 'beta') => (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
      {PLATFORMS.map((p) => {
        const a = rel.assets?.[p.key]?.[0];
        const size = fmtSize(a?.size);
        return (
          <div key={p.key} className="flex flex-col rounded-[12px] border border-white/[0.07] bg-[#0d0d0d] p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#69635b]">{p.name}</div>
            {!a ? (
              <p className="mt-3 text-[12.5px] italic text-[#5d5850]">Not available</p>
            ) : (
              <>
                <a
                  href={`${downloadLink(product, p.key)}${channel === 'beta' ? '?channel=beta' : ''}`}
                  onClick={downloadClickHandler(product.slug, p.key)}
                  className="mt-3 inline-flex items-center justify-center gap-2 rounded-[8px] bg-white px-3.5 py-2.5 text-[13px] font-semibold text-black transition-colors hover:bg-white/90"
                >
                  <Download className="h-3.5 w-3.5" />Download
                </a>
                <div className="mt-2.5 text-[11.5px] text-[#69635b]">{p.req}</div>
                {size && <div className="text-[11.5px] text-[#69635b]">{a.label} · {size}</div>}
                {a.sha256 && (
                  <div className="mt-1 flex items-center gap-1 truncate text-[10.5px] text-[#5d5850]" title={a.sha256}>
                    <ShieldCheck className="h-3 w-3 shrink-0" />SHA-256 {a.sha256.slice(0, 12)}…
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-[#060606] text-white font-['Inter',sans-serif] overflow-x-clip antialiased">
      <Header onGetStarted={() => navigate('/login')} visible={true} />
      <main className="flex-1 page-gutter pt-[clamp(92px,12vh,140px)] pb-[clamp(56px,8vh,110px)]">
        <div className="mx-auto max-w-[820px]">
          <Reveal>
            <Link to={`/product/${product.slug}`} className="inline-flex items-center gap-1.5 text-[12.5px] text-[#69635b] transition-colors hover:text-[#cdc7be]">
              <ArrowLeft className="h-3.5 w-3.5" /> {product.name}
            </Link>
          </Reveal>

          <Reveal delay={60}>
            <h1 className="mt-6 text-[clamp(1.9rem,3.2vw,3rem)] font-semibold tracking-[-0.01em] text-[#ece7df]">Download {product.name}</h1>
            {/* Don't label a build "stable" when the feed says otherwise. `stable`
                falls back to the newest asset-bearing release, which for a
                beta-only product (e.g. comms) is a beta entry. */}
            {stable && (
              <p className="mt-2 text-[13px] text-[#69635b]">
                Latest {(stable.channel ?? 'stable') === 'beta' ? 'beta' : 'stable'} v{stable.version} · {stable.date}
              </p>
            )}
          </Reveal>

          {/* Pre-download caveats. Deliberately ABOVE the buttons — a warning a
              visitor reads after downloading is not a warning.

              Two blocks, in order of generality. First the maturity + signing
              posture, which is DERIVED from the catalog and therefore identical
              on every product. Then whatever is true only of this product.
              Both are monochrome so they read as one considered statement
              rather than a stack of alarms — the amber band this replaced made
              XENO's own stated posture look like a malware warning. */}
          <Reveal delay={80}><ExperimentalNotice product={product} variant="band" className="mt-7" /></Reveal>

          {content?.downloadNotice && (
            <Reveal delay={100}>
              <div className="mt-3 rounded-[12px] border border-white/[0.09] bg-[#0b0b0b] p-[clamp(16px,1.6vw,22px)]">
                <div className="flex items-center gap-2.5">
                  <Info className="h-4 w-4 shrink-0 text-[#948d83]" strokeWidth={1.7} />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#948d83]">
                    Specific to {product.name}
                  </span>
                </div>
                <p className="mt-3 text-[13.5px] leading-[1.7] text-[#b3aca2]">{content.downloadNotice}</p>
              </div>
            </Reveal>
          )}

          {loading ? (
            <div className="flex justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-[#827b71]" /></div>
          ) : !stable ? (
            <Reveal delay={100}>
              <p className="mt-8 text-[14px] text-[#948d83]">No public builds are available yet. Check back soon.</p>
            </Reveal>
          ) : (
            <>
              {/* …and don't link a beta build through the stable deep-link either.
                  If `stable` came from the fallback it IS a beta entry, so the
                  buttons must carry ?channel=beta or the backend resolves a
                  different (or missing) asset than the one labelled above. */}
              <Reveal delay={100} className="mt-8">{channelBlock(stable, (stable.channel ?? 'stable') === 'beta' ? 'beta' : 'stable')}</Reveal>

              {showBeta && (
                <Reveal delay={140}>
                  <div className="mt-10">
                    <div className="mb-3 flex items-center gap-2.5">
                      <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#756f66]">Beta channel</h2>
                      <span className="rounded-[4px] border border-white/30 px-2 py-0.5 text-[11px] font-medium text-[#e8e3dc]">v{beta!.version}</span>
                    </div>
                    {channelBlock(beta!, 'beta')}
                  </div>
                </Reveal>
              )}

              <Reveal delay={180}>
                <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12.5px] text-[#827b71]">
                  <span>
                    {content?.autoUpdates === false
                      ? `This build does not update itself — reinstall from here to move to a newer ${product.name} version.`
                      : `Updates install automatically from inside ${product.name}.`}
                  </span>
                  <Link to={`/product/${product.slug}/releases`} className="text-[#e8e3dc] transition-colors hover:text-white">All versions & release notes →</Link>
                </div>
              </Reveal>
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default ProductDownload;
