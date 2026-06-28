import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, ArrowUpRight, Download, Bell, Check, Copy, Terminal, Github, X, Minus,
} from 'lucide-react';
import Header from '../components/landing-v3/Header';
import Footer from '../components/landing-v3/Footer';
import { Reveal } from '../components/landing-v3/primitives';
import ReleaseFeed from '../components/product/ReleaseFeed';
import { Mockup } from '../components/product/mockups';
import {
  fetchReleases, latestRelease, downloadLink, type Release, type Product,
} from '../lib/productCatalog';
import type { ProductContent, Media } from '../content/products/_types';

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
    beta: { label: 'Beta · Public test', cls: 'border-[#9f6fff]/35 text-[#b69dff]' },
    'coming-soon': { label: 'Coming soon', cls: 'border-white/[0.12] text-[#948d83]' },
  }[status];
  return <span className={`rounded-[4px] border px-2 py-0.5 text-[11px] font-medium ${map.cls}`}>{map.label}</span>;
}

function MediaView({ media, className = '' }: { media: Media; className?: string }) {
  if (media.type === 'mockup') return <div className={className}><Mockup name={media.src} /></div>;
  if (media.type === 'video') {
    return <video src={media.src} poster={media.poster} autoPlay muted loop playsInline aria-label={media.alt}
      className={`w-full rounded-[14px] border border-white/[0.08] ${className}`} />;
  }
  return <img src={media.src} alt={media.alt} loading="lazy"
    className={`w-full rounded-[14px] border border-white/[0.08] ${className}`} />;
}

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <h2 className="text-[12px] font-semibold uppercase tracking-[0.2em] text-[#756f66]">{children}</h2>
);

const ProductLanding: React.FC<{ product: Product; content: ProductContent }> = ({ product, content }) => {
  const navigate = useNavigate();
  const [releases, setReleases] = useState<Release[]>([]);
  const [copied, setCopied] = useState(false);
  const os = detectOS();

  useEffect(() => {
    if (product.delivery === 'desktop' || product.delivery === 'cli') fetchReleases(product).then(setReleases);
  }, [product]);

  const latest = latestRelease(releases);
  const downloadUrl = (o: OS): string | null => (latest?.assets?.[o]?.[0]?.file ? downloadLink(product, o) : null);
  const copyInstall = () => {
    if (!product.install) return;
    navigator.clipboard?.writeText(product.install);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const Cta = (
    <>
      {product.delivery === 'web' && (
        <div className="flex flex-wrap items-center gap-3">
          <Link to={product.launchPath ?? '/auth'} className="inline-flex items-center gap-2 rounded-[9px] bg-white px-5 py-3 text-[14px] font-semibold text-black transition-colors hover:bg-white/90">
            Open {product.name}<ArrowUpRight className="h-4 w-4" />
          </Link>
          <span className="text-[12.5px] text-[#69635b]">Runs in your browser — no install</span>
        </div>
      )}
      {product.delivery === 'desktop' && (
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
      {product.delivery === 'cli' && (
        <div className="max-w-[520px]">
          <div className="flex items-center justify-between gap-3 rounded-[9px] border border-white/[0.08] bg-[#0d0d0d] px-4 py-3 font-mono text-[13px] text-[#cdc7be]">
            <span className="flex items-center gap-2 truncate"><Terminal className="h-3.5 w-3.5 shrink-0 text-[#69635b]" />{product.install}</span>
            <button onClick={copyInstall} className="shrink-0 text-[#827b71] transition-colors hover:text-white">{copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}</button>
          </div>
          {product.repo && <a href={`https://github.com/XENO-CORPORATION/${product.repo}`} className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-[#827b71] transition-colors hover:text-white"><Github className="h-3.5 w-3.5" />View on GitHub</a>}
        </div>
      )}
      {product.delivery === 'soon' && (
        <Link to="/auth" className="inline-flex items-center gap-2 rounded-[9px] bg-white px-5 py-3 text-[14px] font-semibold text-black transition-colors hover:bg-white/90">
          <Bell className="h-4 w-4" />Get notified
        </Link>
      )}
    </>
  );

  const hasFeatureMedia = content.features.some((f) => f.media);

  return (
    <div className="flex min-h-screen flex-col bg-[#060606] text-white font-['Inter',sans-serif] overflow-x-clip antialiased">
      <Header onGetStarted={() => navigate('/auth')} visible={true} />

      <main className="flex-1">
        {/* ── Hero ─────────────────────────────────────────── */}
        <section className="page-gutter relative overflow-hidden pt-[clamp(92px,12vh,140px)] pb-[clamp(40px,6vh,72px)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(ellipse_55%_75%_at_50%_-10%,rgba(167,96,255,0.12),transparent_70%)]" />
          <div className="relative mx-auto grid max-w-[1180px] items-center gap-[clamp(32px,5vw,64px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
            <div>
              <Reveal>
                <Link to="/products" className="inline-flex items-center gap-1.5 text-[12.5px] text-[#69635b] transition-colors hover:text-[#cdc7be]">
                  <ArrowLeft className="h-3.5 w-3.5" /> All products
                </Link>
              </Reveal>
              <Reveal delay={60}>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#756f66]">{product.category}</span>
                  <StatusPill status={product.status} />
                </div>
              </Reveal>
              <Reveal delay={100}>
                <h1 className="mt-3 text-[clamp(2.1rem,3.6vw,3.4rem)] font-semibold leading-[1.06] tracking-[-0.02em] text-[#ece7df]">{content.hero.headline}</h1>
              </Reveal>
              <Reveal delay={140}>
                <p className="mt-5 max-w-[560px] text-[clamp(14px,1.1vw,17px)] leading-[1.65] text-[#948d83]">{content.hero.sub}</p>
              </Reveal>
              {content.hero.badges && (
                <Reveal delay={170}>
                  <div className="mt-5 flex flex-wrap gap-2">
                    {content.hero.badges.map((b) => (
                      <span key={b} className="rounded-[6px] border border-white/[0.09] bg-white/[0.02] px-2.5 py-1 text-[11.5px] text-[#b3aca2]">{b}</span>
                    ))}
                  </div>
                </Reveal>
              )}
              <Reveal delay={200} className="mt-8">{Cta}</Reveal>
            </div>
            <Reveal delay={150}><MediaView media={content.hero.media} /></Reveal>
          </div>
        </section>

        {/* ── Highlights ─────────────────────────────────────── */}
        {content.highlights && (
          <section className="page-gutter">
            <div className="mx-auto grid max-w-[1100px] grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-white/[0.07] bg-white/[0.05] md:grid-cols-4">
              {content.highlights.map((h) => (
                <div key={h.label} className="bg-[#070707] px-5 py-6">
                  <div className="text-[clamp(18px,1.6vw,24px)] font-semibold tracking-[-0.01em] text-[#ece7df]">{h.value}</div>
                  <div className="mt-1 text-[12.5px] text-[#827b71]">{h.label}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Feature spotlights ─────────────────────────────── */}
        {content.features.length > 0 && (
          <section className="page-gutter pt-[clamp(56px,9vh,120px)]">
            <div className="mx-auto max-w-[1100px]">
              <Reveal><SectionLabel>What you can do</SectionLabel></Reveal>
              {hasFeatureMedia ? (
                <div className="mt-10 space-y-[clamp(48px,7vh,90px)]">
                  {content.features.map((f, i) => (
                    <Reveal key={f.title}>
                      <div className={`grid items-center gap-[clamp(28px,4vw,56px)] lg:grid-cols-2 ${i % 2 ? 'lg:[&>*:first-child]:order-2' : ''}`}>
                        <div>
                          {f.eyebrow && <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#9f6fff]/80">{f.eyebrow}</div>}
                          <h3 className="mt-2 text-[clamp(1.3rem,2vw,1.9rem)] font-semibold tracking-[-0.01em] text-[#ece7df]">{f.title}</h3>
                          <p className="mt-3 max-w-[480px] text-[14.5px] leading-[1.65] text-[#948d83]">{f.desc}</p>
                          {f.bullets && <FeatureBullets bullets={f.bullets} />}
                        </div>
                        {f.media ? <MediaView media={f.media} /> : <div />}
                      </div>
                    </Reveal>
                  ))}
                </div>
              ) : (
                <div className="mt-10 grid gap-px overflow-hidden rounded-[16px] border border-white/[0.07] bg-white/[0.05] md:grid-cols-2">
                  {content.features.map((f) => (
                    <Reveal key={f.title}>
                      <div className="h-full bg-[#070707] p-[clamp(22px,2.4vw,34px)]">
                        {f.eyebrow && <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#9f6fff]/80">{f.eyebrow}</div>}
                        <h3 className="mt-2 text-[clamp(1.15rem,1.6vw,1.5rem)] font-semibold tracking-[-0.01em] text-[#ece7df]">{f.title}</h3>
                        <p className="mt-2.5 text-[14px] leading-[1.6] text-[#948d83]">{f.desc}</p>
                        {f.bullets && <FeatureBullets bullets={f.bullets} />}
                      </div>
                    </Reveal>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── Gallery ────────────────────────────────────────── */}
        {content.gallery && content.gallery.length > 0 && (
          <section className="page-gutter pt-[clamp(56px,9vh,110px)]">
            <div className="mx-auto grid max-w-[1100px] gap-4 sm:grid-cols-2">
              {content.gallery.map((m, i) => <Reveal key={i}><MediaView media={m} /></Reveal>)}
            </div>
          </section>
        )}

        {/* ── Use cases ──────────────────────────────────────── */}
        {content.useCases && content.useCases.length > 0 && (
          <section className="page-gutter pt-[clamp(56px,9vh,110px)]">
            <div className="mx-auto max-w-[1100px]">
              <Reveal><SectionLabel>Who it’s for</SectionLabel></Reveal>
              <div className="mt-8 grid gap-4 md:grid-cols-3">
                {content.useCases.map((u) => (
                  <Reveal key={u.title}>
                    <div className="h-full rounded-[12px] border border-white/[0.07] bg-[#0a0a0a] p-6">
                      <h3 className="text-[15px] font-semibold text-[#ece7df]">{u.title}</h3>
                      <p className="mt-2 text-[13.5px] leading-[1.6] text-[#948d83]">{u.desc}</p>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── How it works ───────────────────────────────────── */}
        {content.howItWorks && content.howItWorks.length > 0 && (
          <section className="page-gutter pt-[clamp(56px,9vh,110px)]">
            <div className="mx-auto max-w-[1100px]">
              <Reveal><SectionLabel>How it works</SectionLabel></Reveal>
              <div className="mt-8 grid gap-6 md:grid-cols-3">
                {content.howItWorks.map((s) => (
                  <Reveal key={s.step}>
                    <div>
                      <div className="grid h-9 w-9 place-items-center rounded-full border border-[#9f6fff]/30 text-[14px] font-semibold text-[#b69dff]">{s.step}</div>
                      <h3 className="mt-4 text-[15px] font-semibold text-[#ece7df]">{s.title}</h3>
                      <p className="mt-1.5 text-[13.5px] leading-[1.6] text-[#948d83]">{s.desc}</p>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── Comparison ─────────────────────────────────────── */}
        {content.comparison && (
          <section className="page-gutter pt-[clamp(56px,9vh,110px)]">
            <div className="mx-auto max-w-[820px]">
              <Reveal><SectionLabel>{product.name} vs {content.comparison.competitor}</SectionLabel></Reveal>
              <Reveal>
                <div className="mt-8 overflow-hidden rounded-[12px] border border-white/[0.07]">
                  <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-b border-white/[0.06] bg-white/[0.02] px-5 py-3 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#756f66]">
                    <span>Feature</span>
                    <span className="text-right text-[#b69dff]">{product.name}</span>
                    <span className="w-[120px] text-right">{content.comparison.competitor}</span>
                  </div>
                  {content.comparison.rows.map((r) => (
                    <div key={r.feature} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-b border-white/[0.04] px-5 py-3 text-[13.5px] last:border-0">
                      <span className="text-[#cdc7be]">{r.feature}</span>
                      <span className="text-right"><Cell v={r.xeno} accent /></span>
                      <span className="w-[120px] text-right"><Cell v={r.them} /></span>
                    </div>
                  ))}
                </div>
              </Reveal>
            </div>
          </section>
        )}

        {/* ── Specs ──────────────────────────────────────────── */}
        {content.specs && content.specs.length > 0 && (
          <section className="page-gutter pt-[clamp(56px,9vh,110px)]">
            <div className="mx-auto grid max-w-[1100px] grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-white/[0.07] bg-white/[0.05] md:grid-cols-4">
              {content.specs.map((s) => (
                <div key={s.label} className="bg-[#070707] px-5 py-5">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#756f66]">{s.label}</div>
                  <div className="mt-1.5 text-[13.5px] text-[#e7e2d9]">{s.value}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── FAQ ────────────────────────────────────────────── */}
        {content.faq && content.faq.length > 0 && (
          <section className="page-gutter pt-[clamp(56px,9vh,110px)]">
            <div className="mx-auto max-w-[820px]">
              <Reveal><SectionLabel>Questions</SectionLabel></Reveal>
              <div className="mt-8 divide-y divide-white/[0.06] border-y border-white/[0.06]">
                {content.faq.map((f) => (
                  <details key={f.q} className="group py-4">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15px] font-medium text-[#e7e2d9]">
                      {f.q}
                      <span className="text-[#69635b] transition-transform group-open:rotate-45">+</span>
                    </summary>
                    <p className="mt-3 text-[14px] leading-[1.65] text-[#948d83]">{f.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── Releases + closing CTA ─────────────────────────── */}
        <section className="page-gutter pt-[clamp(56px,9vh,110px)] pb-[clamp(64px,10vh,130px)]">
          <div className="mx-auto max-w-[820px]">
            <div className="rounded-[16px] border border-white/[0.08] bg-gradient-to-b from-[#0c0a12] to-[#070707] p-[clamp(28px,4vw,52px)] text-center">
              <h2 className="text-[clamp(1.5rem,2.4vw,2.1rem)] font-semibold tracking-[-0.01em] text-[#ece7df]">Get {product.name}</h2>
              <p className="mx-auto mt-3 max-w-[440px] text-[14px] leading-[1.6] text-[#948d83]">{content.hero.sub}</p>
              <div className="mt-7 flex justify-center">{Cta}</div>
            </div>

            {(product.delivery === 'desktop' || product.delivery === 'cli') && (
              <div className="mt-[clamp(48px,7vh,90px)]">
                <div className="mb-4 flex items-center justify-between">
                  <SectionLabel>Latest releases</SectionLabel>
                  <Link to={`/product/${product.slug}/releases`} className="text-[12.5px] text-[#827b71] transition-colors hover:text-white">View all →</Link>
                </div>
                <ReleaseFeed releases={releases} slug={product.slug} limit={3} />
              </div>
            )}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

function FeatureBullets({ bullets }: { bullets: string[] }) {
  return (
    <ul className="mt-4 space-y-2">
      {bullets.map((b) => (
        <li key={b} className="flex items-start gap-2.5 text-[13.5px] leading-[1.55] text-[#b3aca2]">
          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#9f6fff]" />{b}
        </li>
      ))}
    </ul>
  );
}

function Cell({ v, accent }: { v: boolean | string; accent?: boolean }) {
  if (v === true) return <Check className={`ml-auto h-4 w-4 ${accent ? 'text-[#b69dff]' : 'text-emerald-400/80'}`} />;
  if (v === false) return <Minus className="ml-auto h-4 w-4 text-[#5f5a53]" />;
  return <span className={`text-[12.5px] ${accent ? 'text-[#b69dff]' : 'text-[#948d83]'}`}>{v}</span>;
}

export default ProductLanding;
