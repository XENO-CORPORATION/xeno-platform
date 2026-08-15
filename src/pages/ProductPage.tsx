import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link, Navigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowUpRight, Download, Bell, Check, Copy, Terminal, Github, AlertTriangle,
} from 'lucide-react';
import Header from '../components/landing-v3/Header';
import Footer from '../components/landing-v3/Footer';
import { Reveal } from '../components/landing-v3/primitives';
import ReleaseFeed from '../components/product/ReleaseFeed';
import ForumThreadsWidget from '../components/product/ForumThreadsWidget';
import ExperimentalNotice from '../components/product/ExperimentalNotice';
import {
  getProduct, fetchReleases, latestRelease, downloadLink, type Release, type Product,
} from '../lib/productCatalog';
import { getProductContent } from '../content/products';
import ProductLanding from './ProductLanding';

type OS = 'windows' | 'mac' | 'linux';
function detectOS(): OS {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
  if (ua.includes('mac')) return 'mac';
  if (ua.includes('linux')) return 'linux';
  return 'windows';
}
const OS_NAME: Record<OS, string> = { windows: 'Windows', mac: 'macOS', linux: 'Linux' };

function StatusPill({ status }: { status: Product['status'] }) {
  const map = {
    shipping: { label: 'Available now', cls: 'border-emerald-400/30 text-emerald-300/90' },
    beta: { label: 'Beta', cls: 'border-[#9f6fff]/35 text-[#b69dff]' },
    'coming-soon': { label: 'Coming soon', cls: 'border-white/[0.12] text-[#948d83]' },
  }[status];
  return <span className={`rounded-[4px] border px-2 py-0.5 text-[11px] font-medium ${map.cls}`}>{map.label}</span>;
}

const LeanProductPage: React.FC<{ product: Product }> = ({ product }) => {
  const navigate = useNavigate();
  const [releases, setReleases] = useState<Release[]>([]);
  const [copied, setCopied] = useState(false);
  const os = detectOS();

  useEffect(() => {
    if (product.delivery === 'desktop' || product.delivery === 'cli') {
      fetchReleases(product).then(setReleases);
    }
  }, [product]);

  const latest = latestRelease(releases);
  // Stable backend deep-link (302s to the current installer) — present only when
  // the latest release actually ships a build for that OS.
  const downloadUrl = (o: OS): string | null => {
    const has = !!latest?.assets?.[o]?.[0]?.file;
    return has ? downloadLink(product, o) : null;
  };
  const criticalHotfix = latest && latest.type === 'hotfix' && latest.severity === 'critical';
  const copyInstall = () => {
    if (!product.install) return;
    navigator.clipboard?.writeText(product.install);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#060606] text-white font-['Inter',sans-serif] overflow-x-clip antialiased">
      <Header onGetStarted={() => navigate('/auth')} visible={true} />

      <main className="flex-1">
        {/* ── Hero ─────────────────────────────────────────── */}
        <section className="page-gutter relative overflow-hidden pt-[clamp(92px,12vh,140px)] pb-[clamp(28px,4vh,52px)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[380px] bg-[radial-gradient(ellipse_55%_75%_at_50%_-10%,rgba(167,96,255,0.10),transparent_70%)]" />
          <div className="relative mx-auto max-w-[820px]">
            <Reveal delay={60}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#756f66]">{product.category}</span>
                <StatusPill status={product.status} />
              </div>
            </Reveal>
            <Reveal delay={100}>
              <h1 className="mt-3 text-[clamp(2.2rem,4vw,3.6rem)] font-semibold leading-[1.05] tracking-[-0.02em] text-[#ece7df]">{product.name}</h1>
            </Reveal>
            <Reveal delay={140}>
              <p className="mt-4 max-w-[560px] text-[clamp(14px,1.1vw,17px)] leading-[1.6] text-[#948d83]">{product.tagline}</p>
            </Reveal>

            {/* ── CTA by delivery type ── */}
            <Reveal delay={180} className="mt-8">
              {/* Off-site distribution (public GitHub release, hosted app) wins over
                  the delivery CTA — the R2-backed branches would show a dead button. */}
              {product.externalUrl && (
                <div className="flex flex-wrap items-center gap-3">
                  <a href={product.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-[9px] bg-white px-5 py-3 text-[14px] font-semibold text-black transition-colors hover:bg-white/90">
                    <Download className="h-4 w-4" />{product.externalLabel ?? `Get ${product.name}`}<ArrowUpRight className="h-4 w-4" />
                  </a>
                  {/* An off-site download on a still-'soon' product is a tester build,
                      not general availability — so keep the notify path rather than
                      implying this is the finished thing. */}
                  {product.delivery === 'soon' && (
                    <Link to="/auth" className="inline-flex items-center gap-1.5 rounded-[9px] border border-white/15 px-5 py-3 text-[13px] font-medium text-white transition-colors hover:bg-white/[0.06]">
                      <Bell className="h-3.5 w-3.5" />Notify me when it ships
                    </Link>
                  )}
                </div>
              )}

              {!product.externalUrl && product.delivery === 'web' && (
                <div className="flex flex-wrap items-center gap-3">
                  <Link to={product.launchPath ?? '/auth'} className="inline-flex items-center gap-2 rounded-[9px] bg-white px-5 py-3 text-[14px] font-semibold text-black transition-colors hover:bg-white/90">
                    Open {product.name}<ArrowUpRight className="h-4 w-4" />
                  </Link>
                  <span className="text-[12.5px] text-[#69635b]">Runs in your browser — no install</span>
                </div>
              )}

              {!product.externalUrl && product.delivery === 'desktop' && (
                <div className="flex flex-wrap items-center gap-3">
                  {downloadUrl(os) ? (
                    <a href={downloadUrl(os)!} className="inline-flex items-center gap-2 rounded-[9px] bg-white px-5 py-3 text-[14px] font-semibold text-black transition-colors hover:bg-white/90">
                      <Download className="h-4 w-4" />Download for {OS_NAME[os]}
                    </a>
                  ) : (
                    <span className="inline-flex items-center gap-2 rounded-[9px] border border-white/15 px-5 py-3 text-[14px] font-medium text-[#948d83]">
                      <Download className="h-4 w-4" />Builds coming soon
                    </span>
                  )}
                  <Link to={`/product/${product.slug}/download`} className="inline-flex items-center gap-1.5 rounded-[9px] border border-white/15 px-5 py-3 text-[13px] font-medium text-white transition-colors hover:bg-white/[0.06]">
                    All platforms & versions
                  </Link>
                  {latest && <span className="text-[12px] text-[#69635b]">Latest v{latest.version}</span>}
                </div>
              )}

              {!product.externalUrl && product.delivery === 'cli' && (
                <div className="max-w-[520px]">
                  <div className="flex items-center justify-between gap-3 rounded-[9px] border border-white/[0.08] bg-[#0d0d0d] px-4 py-3 font-mono text-[13px] text-[#cdc7be]">
                    <span className="flex items-center gap-2 truncate"><Terminal className="h-3.5 w-3.5 shrink-0 text-[#69635b]" />{product.install}</span>
                    <button onClick={copyInstall} className="shrink-0 text-[#827b71] transition-colors hover:text-white">{copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}</button>
                  </div>
                  {product.repo && product.repoPublic && <a href={`https://github.com/XENO-CORPORATION/${product.repo}`} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-[#827b71] transition-colors hover:text-white"><Github className="h-3.5 w-3.5" />View on GitHub</a>}
                </div>
              )}

              {!product.externalUrl && product.delivery === 'soon' && (
                <div className="flex flex-wrap items-center gap-3">
                  <Link to="/auth" className="inline-flex items-center gap-2 rounded-[9px] bg-white px-5 py-3 text-[14px] font-semibold text-black transition-colors hover:bg-white/90">
                    <Bell className="h-4 w-4" />Get notified
                  </Link>
                  {product.repo && product.repoPublic && <a href={`https://github.com/XENO-CORPORATION/${product.repo}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-[9px] border border-white/15 px-5 py-3 text-[13px] font-medium text-white transition-colors hover:bg-white/[0.06]"><Github className="h-3.5 w-3.5" />Follow development</a>}
                </div>
              )}
            </Reveal>

            {/* The lean page has no content module to hand-write a caveat into,
                which is exactly why the notice is derived: a desktop product
                that never gets a landing page still cannot ship silently. */}
            <Reveal delay={210}><ExperimentalNotice product={product} variant="inline" className="mt-6" /></Reveal>
          </div>
        </section>

        {/* ── Critical hotfix banner ── */}
        {criticalHotfix && (
          <section className="page-gutter pb-2">
            <div className="mx-auto flex max-w-[820px] items-center gap-2.5 rounded-[10px] border border-[#ff6b6b]/30 bg-[#ff6b6b]/[0.06] px-4 py-3 text-[13px] text-[#ffb0b0]">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span><strong className="font-semibold">Critical hotfix v{latest!.version}</strong> — update as soon as you can.</span>
            </div>
          </section>
        )}

        {/* ── Recent releases (desktop / cli only) ── */}
        {(product.delivery === 'desktop' || product.delivery === 'cli') && (
          <section className="page-gutter pb-[clamp(56px,8vh,110px)] pt-[clamp(20px,3vh,40px)]">
            <div className="mx-auto max-w-[820px]">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#756f66]">Latest releases</h2>
                <Link to={`/product/${product.slug}/releases`} className="text-[12.5px] text-[#827b71] transition-colors hover:text-white">View all →</Link>
              </div>
              <ReleaseFeed releases={releases} slug={product.slug} limit={4} />
            </div>
          </section>
        )}

        {/* Known issues and answers — renders NOTHING when this product has
            no threads, so a quiet product page stays quiet rather than
            advertising an empty forum. */}
        <ForumThreadsWidget slug={product.slug} />
      </main>

      <Footer />
    </div>
  );
};

/* Dispatcher: products with a rich content module (src/content/products) render
 * the full ProductLanding; everything else keeps the lean page (SPEC L3). */
const ProductPage: React.FC = () => {
  const { slug } = useParams();
  const product = getProduct(slug);
  if (!product) return <Navigate to="/" replace />;
  const content = getProductContent(slug);
  return content ? <ProductLanding product={product} content={content} /> : <LeanProductPage product={product} />;
};

export default ProductPage;
