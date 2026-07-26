import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, ArrowUpRight, ArrowRight, Download, Bell, Check, Copy, Terminal, Github, Minus,
  MessageSquare, Sparkles, ShieldCheck, MonitorSmartphone, Users, Bot, Lock, Zap, Globe, Boxes, ChevronDown,
  GitBranch, Cpu, Layers, Blocks, Network, Table2,
  Music, SlidersHorizontal, Gauge, Mic, Upload, Fingerprint,
} from 'lucide-react';
import Header from '../components/landing-v3/Header';
import Footer from '../components/landing-v3/Footer';
import { Reveal, SectionHeading, Eyebrow, T, cx } from '../components/landing-v3/primitives';
import ReleaseFeed from '../components/product/ReleaseFeed';
import { Mockup } from '../components/product/mockups';
import {
  fetchReleases, latestRelease, downloadLink, type Release, type Product,
} from '../lib/productCatalog';
import type { ProductContent, Media } from '../content/products/_types';
import { getProductDocs } from '../content/docs';

type OS = 'windows' | 'mac' | 'linux';
function detectOS(): OS {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
  if (ua.includes('mac')) return 'mac';
  if (ua.includes('linux')) return 'linux';
  return 'windows';
}
const OS_NAME: Record<OS, string> = { windows: 'Windows', mac: 'macOS', linux: 'Linux' };

/* lucide icons referenced by name from content modules */
const ICONS: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  MessageSquare, Sparkles, ShieldCheck, MonitorSmartphone, Users, Bot, Lock, Zap, Globe, Boxes,
  Terminal, GitBranch, Cpu, Layers, Blocks, Network, Table2,
  Music, SlidersHorizontal, Gauge, Mic, Upload, Fingerprint,
};

function StatusPill({ status }: { status: Product['status'] }) {
  const map = {
    shipping: { label: 'Available now', cls: 'border-emerald-400/30 text-emerald-300/90' },
    beta: { label: 'Beta · Public test', cls: 'border-white/[0.16] text-[#b3aca2]' },
    'coming-soon': { label: 'Coming soon', cls: 'border-white/[0.12] text-[#948d83]' },
  }[status];
  return <span className={`rounded-[4px] border px-2 py-0.5 text-[11px] font-medium ${map.cls}`}>{map.label}</span>;
}

function MediaView({ media }: { media: Media }) {
  if (media.type === 'mockup') return <Mockup name={media.src} />;
  if (media.type === 'video') {
    return <video src={media.src} poster={media.poster} autoPlay muted loop playsInline aria-label={media.alt}
      className="w-full rounded-[12px] border border-white/[0.08]" />;
  }
  return <img src={media.src} alt={media.alt} loading="lazy" className="w-full rounded-[12px] border border-white/[0.08]" />;
}

const ACCENTS = [
  { id: 'violet', rgb: '159 111 255' },
  { id: 'amber', rgb: '245 176 70' },
  { id: 'blue', rgb: '56 168 255' },
  { id: 'green', rgb: '45 212 149' },
] as const;
function initAccent(): string {
  if (typeof window === 'undefined') return 'violet';
  const p = new URLSearchParams(window.location.search).get('accent');
  if (p && ACCENTS.some((a) => a.id === p)) return p;
  try { return localStorage.getItem('xeno-accent') || 'violet'; } catch { return 'violet'; }
}

const ProductLanding: React.FC<{ product: Product; content: ProductContent }> = ({ product, content }) => {
  const navigate = useNavigate();
  const [releases, setReleases] = useState<Release[]>([]);
  const [copied, setCopied] = useState(false);
  const [accent, setAccent] = useState(initAccent);
  const [themeOpen, setThemeOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('theme') === 'open';
  });
  const openedOnce = useRef(false);
  useEffect(() => { if (themeOpen) openedOnce.current = true; }, [themeOpen]);
  useEffect(() => { try { localStorage.setItem('xeno-accent', accent); } catch { /* ignore */ } }, [accent]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      if (e.shiftKey && (e.key === 'T' || e.key === 't') && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) {
        e.preventDefault();
        setThemeOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
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

  /* A product distributed off-site (public GitHub release, hosted app) overrides
     every delivery CTA — otherwise the R2-backed branches render a dead button. */
  const Cta = product.externalUrl ? (
    <a href={product.externalUrl} target="_blank" rel="noreferrer"
      className="group inline-flex items-center gap-2 rounded-[6px] bg-white px-6 py-3 text-[14px] font-semibold text-black transition-colors hover:bg-white/90">
      <Download className="h-4 w-4" />{product.externalLabel ?? `Get ${product.name}`}
      <ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
    </a>
  ) : (
    <>
      {product.delivery === 'web' && (
        <Link to={product.launchPath ?? '/auth'} className="group inline-flex items-center gap-2 rounded-[6px] bg-white px-6 py-3 text-[14px] font-semibold text-black transition-colors hover:bg-white/90">
          Open {product.name}<ArrowUpRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}
      {product.delivery === 'desktop' && (
        downloadUrl(os) ? (
          <a href={downloadUrl(os)!} className="group inline-flex items-center gap-2 rounded-[6px] bg-white px-6 py-3 text-[14px] font-semibold text-black transition-colors hover:bg-white/90">
            <Download className="h-4 w-4" />Download for {OS_NAME[os]}
          </a>
        ) : (
          <span className="inline-flex items-center gap-2 rounded-[6px] border border-white/15 px-6 py-3 text-[14px] font-medium text-[#948d83]">
            <Download className="h-4 w-4" />Builds coming soon
          </span>
        )
      )}
      {product.delivery === 'cli' && (
        <div className="flex items-center justify-between gap-3 rounded-[6px] border border-white/[0.08] bg-[#0d0d0d] px-4 py-3 font-mono text-[13px] text-[#cdc7be]">
          <span className="flex items-center gap-2 truncate"><Terminal className="h-3.5 w-3.5 shrink-0 text-[#69635b]" />{product.install}</span>
          <button onClick={copyInstall} className="shrink-0 text-[#827b71] transition-colors hover:text-white">{copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}</button>
        </div>
      )}
      {product.delivery === 'soon' && (
        <Link to="/auth" className="inline-flex items-center gap-2 rounded-[6px] bg-white px-6 py-3 text-[14px] font-semibold text-black transition-colors hover:bg-white/90">
          <Bell className="h-4 w-4" />Get notified
        </Link>
      )}
    </>
  );

  const hasDocs = !!getProductDocs(product.slug);
  const secondaryLink = 'inline-flex items-center gap-1.5 rounded-[6px] border border-white/[0.10] px-5 py-3 text-[13px] font-medium text-[#d8d2ca] transition-colors hover:border-white/25 hover:bg-white/[0.03]';
  const Secondary = (
    <>
      {(product.delivery === 'desktop' || product.delivery === 'cli') && (
        <Link to={`/product/${product.slug}/${product.delivery === 'cli' ? 'releases' : 'download'}`} className={secondaryLink}>
          {product.delivery === 'cli' ? 'Release notes' : 'All platforms & versions'}
        </Link>
      )}
      {hasDocs && (
        <Link to={`/docs/${product.slug}`} className={secondaryLink}>Documentation</Link>
      )}
    </>
  );

  const SERIF = { fontFamily: "'Cormorant Garamond', 'Playfair Display', Georgia, serif", fontWeight: 400, letterSpacing: '0.01em' } as const;

  return (
    <div data-accent={accent} className="flex min-h-screen flex-col bg-[#060606] text-white font-['Inter',sans-serif] overflow-x-clip antialiased">
      <Header onGetStarted={() => navigate('/auth')} visible={true} />

      <main className="flex-1">
        {/* ── Hero ─────────────────────────────────────────── */}
        <section className="px-[max(12px,0.6vw)] relative flex min-h-[80svh] items-center overflow-hidden pt-[clamp(76px,9vh,108px)] pb-[clamp(52px,7vh,88px)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[64vh]" style={{ background: 'radial-gradient(ellipse 60% 80% at 60% -4%, rgb(var(--acc) / 0.10), transparent 72%)' }} />
          <div className="relative mx-auto grid w-full max-w-[1560px] items-center gap-[clamp(28px,4vw,64px)] lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]">
            <div>
              <Reveal delay={60}>
                <div className="flex flex-wrap items-center gap-3">
                  <Eyebrow>{product.category}</Eyebrow>
                  <StatusPill status={product.status} />
                </div>
              </Reveal>
              <Reveal delay={100}>
                <h1 className="mt-5 text-[clamp(2.3rem,3.8vw,4rem)] leading-[1.04] text-[#f3efe8]" style={SERIF}>{content.hero.headline}</h1>
              </Reveal>
              <Reveal delay={140}>
                <div className="mt-6 flex items-center gap-2">
                  <span className="h-px w-[16%] min-w-[52px] bg-gradient-to-r from-white/40 via-white/20 to-transparent" />
                  <span className="h-1.5 w-1.5 rounded-[2px]" style={{ backgroundColor: 'rgb(var(--acc))' }} />
                </div>
              </Reveal>
              <Reveal delay={160}>
                <p className="mt-6 max-w-[540px] text-[clamp(14px,1.05vw,16.5px)] leading-[1.65]" style={{ color: T.body }}>{content.hero.sub}</p>
              </Reveal>
              {content.hero.badges && (
                <Reveal delay={190}>
                  <div className="mt-6 flex flex-wrap gap-2">
                    {content.hero.badges.map((b) => (
                      <span key={b} className="rounded-[4px] border border-white/[0.12] bg-black/30 px-2.5 py-1 text-[11px] font-medium text-[#c2bbb1]">{b}</span>
                    ))}
                  </div>
                </Reveal>
              )}
              <Reveal delay={220}>
                <div className="mt-9 flex flex-wrap items-center gap-3">
                  {Cta}{Secondary}
                  {latest && <span className="text-[12px] text-[#69635b]">Latest v{latest.version}</span>}
                </div>
              </Reveal>
              {content.hero.note && <Reveal delay={250}><p className="mt-4 text-[12px] leading-relaxed text-[#69635b]">{content.hero.note}</p></Reveal>}
            </div>
            <Reveal delay={150}><MediaView media={content.hero.media} /></Reveal>
          </div>
          {/* scroll cue — NN/g: signal there's more below a tall hero */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-5 mx-auto flex w-fit flex-col items-center gap-1 text-[#5d5850]">
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.24em]">Scroll</span>
            <ChevronDown className="h-4 w-4 motion-safe:animate-bounce" />
          </div>
        </section>

        {/* ── Trust band (honest proof signals, NN/g social proof) ── */}
        {content.trust && content.trust.length > 0 && (
          <section className="px-[max(16px,1.1vw)] pb-[clamp(28px,4vh,52px)]">
            <div className="mx-auto flex max-w-[1000px] flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[12px] text-[#69635b]">
              {content.trust.map((t, i) => (
                <React.Fragment key={t}>
                  {i > 0 && <span className="hidden h-1 w-1 rounded-full bg-white/20 sm:inline-block" />}
                  <span>{t}</span>
                </React.Fragment>
              ))}
            </div>
          </section>
        )}

        {/* ── Highlights ─────────────────────────────────────── */}
        {content.highlights && (
          <section className="px-[max(16px,1.1vw)] pb-[clamp(8px,2vh,24px)]">
            <div className="mx-auto max-w-[1240px] overflow-hidden rounded-[12px] border border-white/[0.07] bg-[#101010]">
              <div className="grid grid-cols-2 lg:grid-cols-4">
                {content.highlights.map((h, i) => (
                  <div key={h.label} className={cx('px-[clamp(18px,1.6vw,30px)] py-[clamp(18px,2.4vh,28px)]', i > 0 && 'lg:border-l lg:border-white/[0.06]', i >= 2 && 'border-t border-white/[0.06] lg:border-t-0', i === 1 && 'border-l border-white/[0.06] lg:border-l')}>
                    <div className="text-[clamp(17px,1.5vw,22px)] font-semibold tracking-[-0.01em] text-[#ece7df]">{h.value}</div>
                    <div className="mt-1 text-[12.5px] text-[#827b71]">{h.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── Feature spotlights (bento) ─────────────────────── */}
        {content.features.length > 0 && (
          <section className="px-[max(16px,1.1vw)] border-t border-white/[0.06] py-[clamp(72px,11vh,150px)]">
            <SectionHeading eyebrow="What you can do" title={`Everything ${product.name} does well.`}
              sub={`The fundamentals done right — built from ${product.name}'s real product, not a template.`} />
            <div className="mx-auto mt-[clamp(40px,6vh,68px)] grid max-w-[1240px] grid-cols-1 gap-[clamp(14px,1vw,20px)] md:grid-cols-2">
              {content.features.map((f, i) => {
                const Icon = f.icon ? ICONS[f.icon] : undefined;
                return (
                  <Reveal as="article" key={f.title} delay={(i % 2) * 70}
                    className="group relative flex flex-col overflow-hidden rounded-[16px] border border-white/[0.07] p-[clamp(22px,1.9vw,34px)] transition-all duration-300 hover:-translate-y-1 hover:border-white/[0.18]"
                  >
                    <div className="pointer-events-none absolute inset-0 opacity-90" style={{ background: f.accent ?? 'linear-gradient(165deg,#121212,#070707 74%)' }} />
                    <div className="relative z-10">
                      {Icon && (
                        <div className="grid h-[clamp(40px,3.2vw,50px)] w-[clamp(40px,3.2vw,50px)] place-items-center rounded-[12px] border border-white/[0.16] bg-white/[0.06] text-[#e8e3db] backdrop-blur-sm">
                          <Icon className="h-[44%] w-[44%]" strokeWidth={1.6} />
                        </div>
                      )}
                      {f.eyebrow && <div className="mt-5 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#827b71]">{f.eyebrow}</div>}
                      <h3 className="mt-2 text-[clamp(1.2rem,1.7vw,1.6rem)] font-semibold tracking-[-0.01em] text-[#f3efe8]">{f.title}</h3>
                      <p className="mt-3 max-w-[440px] text-[14px] leading-[1.6]" style={{ color: T.body }}>{f.desc}</p>
                      {f.bullets && (
                        <ul className="mt-5 space-y-2.5">
                          {f.bullets.map((b) => (
                            <li key={b} className="flex items-start gap-2.5 text-[13px] leading-[1.5] text-[#b3aca2]">
                              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8a847b]" />{b}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Gallery ────────────────────────────────────────── */}
        {content.gallery && content.gallery.length > 0 && (
          <section className="px-[max(16px,1.1vw)] border-t border-white/[0.06] py-[clamp(72px,11vh,150px)]">
            <div className="mx-auto grid max-w-[1240px] gap-4 sm:grid-cols-2">
              {content.gallery.map((m, i) => <Reveal key={i}><MediaView media={m} /></Reveal>)}
            </div>
          </section>
        )}

        {/* ── Use cases ──────────────────────────────────────── */}
        {content.useCases && content.useCases.length > 0 && (
          <section className="px-[max(16px,1.1vw)] border-t border-white/[0.06] py-[clamp(72px,11vh,150px)]">
            <SectionHeading eyebrow="Who it’s for" title="Built for the way you work." />
            <div className="mx-auto mt-[clamp(40px,6vh,68px)] grid max-w-[1240px] gap-[clamp(14px,1vw,20px)] md:grid-cols-3">
              {content.useCases.map((u, i) => {
                const Icon = u.icon ? ICONS[u.icon] : undefined;
                return (
                  <Reveal as="article" key={u.title} delay={(i % 3) * 70}
                    className="group h-full rounded-[16px] border border-white/[0.07] bg-[#0b0b0b] p-[clamp(22px,1.9vw,30px)] transition-all duration-300 hover:-translate-y-1 hover:border-white/[0.18]">
                    {Icon && (
                      <div className="grid h-11 w-11 place-items-center rounded-[12px] border border-white/[0.14] bg-white/[0.05] text-[#e8e3db]">
                        <Icon className="h-[42%] w-[42%]" strokeWidth={1.6} />
                      </div>
                    )}
                    <h3 className="mt-5 text-[16px] font-semibold text-[#f3efe8]">{u.title}</h3>
                    <p className="mt-2.5 text-[13.5px] leading-[1.6]" style={{ color: T.body }}>{u.desc}</p>
                  </Reveal>
                );
              })}
            </div>
          </section>
        )}

        {/* ── How it works ───────────────────────────────────── */}
        {content.howItWorks && content.howItWorks.length > 0 && (
          <section className="px-[max(16px,1.1vw)] border-t border-white/[0.06] py-[clamp(72px,11vh,150px)]">
            <SectionHeading eyebrow="How it works" title={`Up and running in minutes.`} />
            <div className="mx-auto mt-[clamp(40px,6vh,68px)] grid max-w-[980px] gap-[clamp(20px,3vw,44px)] md:grid-cols-3">
              {content.howItWorks.map((s, i) => (
                <Reveal key={s.step} delay={i * 70} className="relative">
                  <div className="grid h-10 w-10 place-items-center rounded-full border border-white/[0.14] text-[15px] font-semibold text-[#e8e3db]" style={SERIF}>{s.step}</div>
                  <h3 className="mt-5 text-[16px] font-semibold text-[#f3efe8]">{s.title}</h3>
                  <p className="mt-2 text-[13.5px] leading-[1.6]" style={{ color: T.body }}>{s.desc}</p>
                </Reveal>
              ))}
            </div>
          </section>
        )}

        {/* ── Comparison ─────────────────────────────────────── */}
        {content.comparison && (
          <section className="px-[max(16px,1.1vw)] border-t border-white/[0.06] py-[clamp(72px,11vh,150px)]">
            <SectionHeading eyebrow="How it compares" title={`${product.name} vs ${content.comparison.competitor}`} />
            <div className="mx-auto mt-[clamp(36px,5vh,56px)] max-w-[760px] overflow-hidden rounded-[14px] border border-white/[0.07] bg-[#0a0a0a]">
              <div className="grid grid-cols-[1fr_92px_92px] items-center gap-x-4 border-b border-white/[0.07] bg-white/[0.02] px-5 py-3.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#756f66] sm:grid-cols-[1fr_120px_120px]">
                <span>Feature</span>
                <span className="text-right text-[#e8e3db]">{product.name}</span>
                <span className="text-right">{content.comparison.competitor}</span>
              </div>
              {content.comparison.rows.map((r) => (
                <div key={r.feature} className="grid grid-cols-[1fr_92px_92px] items-center gap-x-4 border-b border-white/[0.05] px-5 py-3.5 text-[13.5px] last:border-0 sm:grid-cols-[1fr_120px_120px]">
                  <span className="text-[#cdc7be]">{r.feature}</span>
                  <span className="flex justify-end"><Cell v={r.xeno} primary /></span>
                  <span className="flex justify-end"><Cell v={r.them} /></span>
                </div>
              ))}
            </div>
            <p className="mx-auto mt-4 max-w-[760px] text-center text-[11.5px] text-[#5d5850]">Comparison reflects {product.name}’s current public test — we list where {content.comparison.competitor} still lead too.</p>
          </section>
        )}

        {/* ── Specs ──────────────────────────────────────────── */}
        {content.specs && content.specs.length > 0 && (
          <section className="px-[max(16px,1.1vw)] border-t border-white/[0.06] py-[clamp(56px,8vh,100px)]">
            <div className="mx-auto grid max-w-[1240px] grid-cols-2 overflow-hidden rounded-[12px] border border-white/[0.07] bg-[#101010] lg:grid-cols-4">
              {content.specs.map((s, i) => (
                <div key={s.label} className={cx('px-[clamp(18px,1.6vw,28px)] py-[clamp(16px,2.2vh,24px)]', i > 0 && 'lg:border-l lg:border-white/[0.06]', i >= 2 && 'border-t border-white/[0.06] lg:border-t-0', i === 1 && 'border-l border-white/[0.06] lg:border-l')}>
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-[#756f66]">{s.label}</div>
                  <div className="mt-1.5 text-[13.5px] text-[#e7e2d9]">{s.value}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── FAQ ────────────────────────────────────────────── */}
        {content.faq && content.faq.length > 0 && (
          <section className="px-[max(16px,1.1vw)] border-t border-white/[0.06] py-[clamp(72px,11vh,150px)]">
            <SectionHeading eyebrow="Questions" title="Good to know." />
            <div className="mx-auto mt-[clamp(36px,5vh,56px)] max-w-[800px] divide-y divide-white/[0.06] border-y border-white/[0.06]">
              {content.faq.map((f) => (
                <details key={f.q} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[15.5px] font-medium text-[#e7e2d9]">
                    {f.q}
                    <span className="text-[20px] leading-none text-[#69635b] transition-transform duration-200 group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 max-w-[680px] text-[14px] leading-[1.7]" style={{ color: T.body }}>{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        {/* ── Closing CTA + releases ─────────────────────────── */}
        <section className="px-[max(16px,1.1vw)] border-t border-white/[0.06] py-[clamp(72px,11vh,150px)]">
          <div className="mx-auto max-w-[900px]">
            <div className="relative overflow-hidden rounded-[20px] border border-white/[0.08] px-[clamp(28px,5vw,72px)] py-[clamp(40px,7vh,80px)] text-center">
              <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 70% 120% at 50% -10%, rgb(var(--acc) / 0.14), transparent 70%), linear-gradient(180deg,#0c0a12,#070707 80%)' }} />
              <div className="relative z-10">
                <h2 className="text-[clamp(1.8rem,3vw,2.8rem)] leading-[1.08] text-[#f3efe8]" style={SERIF}>Get {product.name}.</h2>
                <p className="mx-auto mt-4 max-w-[440px] text-[14.5px] leading-[1.6]" style={{ color: T.body }}>{content.hero.sub}</p>
                <div className="mt-8 flex flex-wrap items-center justify-center gap-3">{Cta}{Secondary}</div>
              </div>
            </div>

            {(product.delivery === 'desktop' || product.delivery === 'cli') && (
              <div className="mt-[clamp(48px,8vh,96px)]">
                <div className="mb-5 flex items-center justify-between">
                  <span className="text-[12px] font-semibold uppercase tracking-[0.2em] text-[#756f66]">Latest releases</span>
                  <Link to={`/product/${product.slug}/releases`} className="inline-flex items-center gap-1 text-[12.5px] text-[#827b71] transition-colors hover:text-white">View all <ArrowRight className="h-3.5 w-3.5" /></Link>
                </div>
                <ReleaseFeed releases={releases} slug={product.slug} limit={3} />
              </div>
            )}
          </div>
        </section>
      </main>

      <Footer />

      {/* Accent switcher — hidden until Shift+T. Reveal: colors rise from the bottom,
       * right→left staggered (scale + fade). Dismiss: all slide out to the right together. */}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex items-end gap-2.5">
        {ACCENTS.map((a, i) => {
          const anim = themeOpen
            ? `accRise 440ms cubic-bezier(0.22,1,0.36,1) ${(ACCENTS.length - 1 - i) * 85}ms both`
            : openedOnce.current
              ? 'accSlideOut 300ms cubic-bezier(0.4,0,1,1) both'
              : undefined;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => setAccent(a.id)}
              aria-label={`${a.id} accent`}
              className={`h-6 w-6 rounded-full border opacity-0 ${accent === a.id ? 'border-white/80 ring-2 ring-white/30 ring-offset-2 ring-offset-[#060606]' : 'border-white/25 hover:brightness-125'} ${themeOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
              style={{ background: `rgb(${a.rgb})`, animation: anim }}
            />
          );
        })}
      </div>
    </div>
  );
};

function Cell({ v, primary }: { v: boolean | string; primary?: boolean }) {
  if (v === true) return <Check className={`h-4 w-4 ${primary ? 'text-[#e8e3db]' : 'text-[#807970]'}`} />;
  if (v === false) return <Minus className="h-4 w-4 text-[#4f4a44]" />;
  return <span className={`text-right text-[12px] ${primary ? 'text-[#cdc7be]' : 'text-[#827b71]'}`}>{v}</span>;
}

export default ProductLanding;
