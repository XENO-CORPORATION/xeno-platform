import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Search, Mail, CreditCard, User, Download, BookOpen, ShieldCheck,
  ChevronDown, ArrowRight, MessagesSquare, FileText,
  type LucideIcon,
} from 'lucide-react';

import Header from '../components/landing-v3/Header';
import Footer from '../components/landing-v3/Footer';
import { T, cx, Reveal, Eyebrow } from '../components/landing-v3/primitives';
import {
  SUPPORT_SECTIONS, SUPPORT_EMAIL, STATEMENT_DESCRIPTOR, STATEMENT_DESCRIPTOR_LONG,
  type SupportItem, type SupportLink,
} from '../content/support';

/*
 * The support centre.
 *
 * 🔴 ANSWER TEXT LIVES IN src/content/support.ts, NEVER HERE. That module is
 * rendered twice — by this page, and as static HTML by scripts/lib/support-page.mjs
 * for the prerender. Inline an answer in this file and the no-JavaScript copy
 * silently loses it, which is the one thing this page cannot afford: the URL is
 * handed to Stripe and to card-network partners whose rule is that placeholder
 * or under-construction sites are not supported. scripts/support-page.test.mjs
 * fails if answers appear here.
 *
 * Built from the landing-v3 design system (T / Reveal / Eyebrow + the real
 * Header and Footer) so this reads as the same product as the homepage rather
 * than a bare document. Header carries no hash anchors, so reusing it here does
 * not reproduce the dead `#pricing` link that the Forum chrome note warns about.
 */

const SECTION_ICON: Record<string, LucideIcon> = {
  charges: CreditCard,
  account: User,
  downloads: Download,
  products: BookOpen,
  privacy: ShieldCheck,
};

const isExternal = (href: string) => /^(https?:|mailto:)/.test(href);

const AnswerLink: React.FC<{ link: SupportLink }> = ({ link }) => {
  const className =
    'inline-flex items-center gap-1.5 text-[clamp(12px,0.84vw,13.5px)] font-medium text-[#cfc8bf] transition-colors hover:text-white';
  const inner = (
    <>
      {link.label}
      <ArrowRight className="h-3 w-3 opacity-60" strokeWidth={2} />
    </>
  );
  return isExternal(link.href) ? (
    <a
      href={link.href}
      className={className}
      {...(link.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {inner}
    </a>
  ) : (
    <Link to={link.href} className={className}>{inner}</Link>
  );
};

/* One question. Collapsed by default so a section scans as a list of questions —
 * the way somebody actually looks for their own problem — and expands in place. */
const Answer: React.FC<{ item: SupportItem; open: boolean; onToggle: () => void }> = ({
  item, open, onToggle,
}) => (
  <div
    className={cx(
      'overflow-hidden rounded-[14px] border transition-colors duration-200',
      open ? 'border-white/[0.14] bg-[#141414]' : 'border-white/[0.06] bg-[#101010] hover:border-white/[0.12]',
    )}
  >
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center justify-between gap-4 px-[clamp(16px,1.5vw,24px)] py-[clamp(14px,1.5vh,18px)] text-left"
    >
      <span className="text-[clamp(13.5px,0.95vw,15.5px)] font-medium leading-snug text-[#ece7df]">
        {item.q}
      </span>
      <ChevronDown
        className={cx('h-4 w-4 shrink-0 transition-transform duration-300', open && 'rotate-180')}
        style={{ color: T.label }}
        strokeWidth={2}
      />
    </button>
    <div
      className={cx(
        'grid transition-all duration-300 ease-[cubic-bezier(0.22,0.7,0.2,1)]',
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      )}
    >
      <div className="overflow-hidden">
        <div className="px-[clamp(16px,1.5vw,24px)] pb-[clamp(16px,1.8vh,22px)]">
          {item.a.map((para, i) => (
            <p
              key={i}
              className="mb-2.5 text-[clamp(12.5px,0.88vw,14.5px)] leading-[1.65] last:mb-0"
              style={{ color: T.body }}
            >
              {para}
            </p>
          ))}
          {item.links?.length ? (
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
              {item.links.map((l) => <AnswerLink key={l.href + l.label} link={l} />)}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  </div>
);

const Support: React.FC = () => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const q = query.trim().toLowerCase();

  const sections = useMemo(() => {
    if (!q) return SUPPORT_SECTIONS;
    return SUPPORT_SECTIONS
      .map((s) => ({
        ...s,
        items: s.items.filter(
          (it) => it.q.toLowerCase().includes(q) || it.a.some((p) => p.toLowerCase().includes(q)),
        ),
      }))
      .filter((s) => s.items.length > 0);
  }, [q]);

  const matches = sections.reduce((n, s) => n + s.items.length, 0);
  // While searching every match is expanded: hiding the answer behind a second
  // click is exactly the wrong behaviour for someone who just told us what they want.
  const isOpen = (key: string) => (q ? true : !!open[key]);

  return (
    <div className="flex min-h-screen flex-col bg-[#060606] text-white font-['Inter',sans-serif] overflow-x-clip antialiased">
      <Header onGetStarted={() => navigate('/login')} visible />

      <main className="flex-1">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="page-gutter pt-[clamp(96px,14vh,170px)] pb-[clamp(36px,5vh,64px)]">
          <div className="mx-auto max-w-[760px] text-center">
            <Reveal className="mb-[clamp(14px,1.8vh,22px)] flex justify-center">
              <Eyebrow>Support</Eyebrow>
            </Reveal>
            <Reveal delay={60}>
              <h1 className="text-[clamp(2.1rem,3.4vw,3.8rem)] font-semibold leading-[1.06] tracking-[-0.015em] text-[#ece7df]">
                How can we help?
              </h1>
            </Reveal>
            <Reveal delay={120}>
              <p
                className="mx-auto mt-[clamp(14px,2vh,24px)] max-w-[560px] text-[clamp(13px,1vw,16px)] leading-[1.6]"
                style={{ color: T.body }}
              >
                Answers to what people actually write in about. If it is not here, a person reads
                every message.
              </p>
            </Reveal>

            <Reveal delay={180}>
              <div className="relative mx-auto mt-[clamp(26px,3.6vh,44px)] max-w-[520px]">
                <Search
                  className="pointer-events-none absolute left-[18px] top-1/2 h-[17px] w-[17px] -translate-y-1/2"
                  style={{ color: T.label }}
                  strokeWidth={1.8}
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search — try “charge”, “cancel”, “install”"
                  aria-label="Search support"
                  /* No focus ring on text inputs: the global :focus-visible outline
                     sits outside the field and reads as a stray stroke. Border + fill
                     carry the focus state instead. */
                  className="w-full rounded-[12px] border border-white/[0.08] bg-[#121212] py-[14px] pl-[48px] pr-4 text-[14px] text-[#ece7df] outline-none ring-0 transition-colors placeholder:text-[#69635b] focus:border-white/25 focus:bg-[#161616]"
                />
              </div>
            </Reveal>
          </div>
        </section>

        {/* ── The charge question. First, because someone staring at a bank
             statement is the single most common arrival — and the reason this
             URL is given to payment partners at all. ─────────────────────── */}
        <section className="page-gutter pb-[clamp(44px,6vh,80px)]">
          <Reveal>
            <div className="relative mx-auto overflow-hidden rounded-[20px] border border-white/[0.05] bg-[#101010] px-[clamp(24px,2.6vw,56px)] py-[clamp(30px,4vh,52px)]">
              <div className="pointer-events-none absolute -left-24 -top-24 h-64 w-64 rounded-[4px] bg-[radial-gradient(circle,rgba(255,255,255,0.10),transparent_70%)]" />
              <div className="relative grid grid-cols-1 items-center gap-[clamp(26px,3vw,56px)] lg:grid-cols-[1fr_minmax(280px,42%)]">
                <div>
                  <Eyebrow>On your statement</Eyebrow>
                  <h2 className="mt-[clamp(12px,1.6vh,20px)] text-[clamp(1.5rem,2.2vw,2.4rem)] font-semibold leading-[1.12] tracking-[-0.01em] text-[#ece7df]">
                    Do you not recognise a charge?
                  </h2>
                  <p
                    className="mt-[clamp(12px,1.6vh,18px)] max-w-[460px] text-[clamp(12.5px,0.9vw,15px)] leading-[1.65]"
                    style={{ color: T.body }}
                  >
                    Send us the date, the amount and the last four digits of the card. We will tell
                    you exactly what it was — and if it is not yours, we refund it. You do not need
                    to raise a dispute with your bank first.
                  </p>
                  <a
                    href={`mailto:${SUPPORT_EMAIL}`}
                    className="mt-[clamp(18px,2.4vh,26px)] inline-flex items-center gap-2 rounded-[10px] border border-white/[0.14] bg-white/[0.04] px-5 py-3 text-[13.5px] font-medium text-[#ece7df] transition-colors hover:border-white/30 hover:bg-white/[0.08]"
                  >
                    <Mail className="h-4 w-4" strokeWidth={1.8} />
                    {SUPPORT_EMAIL}
                  </a>
                </div>

                {/* A statement line, drawn the way a bank draws it. Recognising your
                    own charge should take a glance, not a paragraph. */}
                <div className="rounded-[14px] border border-white/[0.07] bg-[#0b0b0b] p-[clamp(16px,1.6vw,22px)]">
                  <div className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.22em]" style={{ color: T.label }}>
                    Looks like this
                  </div>
                  <div className="flex items-baseline justify-between gap-4 border-b border-white/[0.06] pb-3">
                    <span className="font-mono text-[clamp(12px,0.95vw,14.5px)] tracking-tight text-[#ece7df]">
                      {STATEMENT_DESCRIPTOR}*{STATEMENT_DESCRIPTOR_LONG}
                    </span>
                    <span className="font-mono text-[12.5px]" style={{ color: T.faint }}>−€12.00</span>
                  </div>
                  <p className="mt-3 text-[11.5px] leading-[1.6]" style={{ color: T.dim }}>
                    Card statements shorten and uppercase merchant names, so it may appear as{' '}
                    <span className="text-[#bdb6ac]">{STATEMENT_DESCRIPTOR}</span> alone.
                  </p>
                </div>
              </div>
            </div>
          </Reveal>
        </section>

        {/* ── Category jump grid ───────────────────────────────────────── */}
        {!q && (
          <section className="page-gutter pb-[clamp(48px,7vh,90px)]">
            <div className="grid grid-cols-1 gap-[clamp(12px,1.2vw,18px)] sm:grid-cols-2 lg:grid-cols-3">
              {SUPPORT_SECTIONS.map((s, i) => {
                const Icon = SECTION_ICON[s.id] ?? BookOpen;
                return (
                  <Reveal key={s.id} delay={i * 70}>
                    <a
                      href={`#${s.id}`}
                      className="group flex h-full flex-col rounded-[16px] border border-white/[0.06] bg-[#101010] p-[clamp(18px,1.6vw,26px)] transition-colors hover:border-white/[0.14] hover:bg-[#141414]"
                    >
                      <span className="grid h-[42px] w-[42px] place-items-center rounded-[11px] border border-white/[0.07] bg-white/[0.04] text-[#cfc8bf]">
                        <Icon className="h-[19px] w-[19px]" strokeWidth={1.7} />
                      </span>
                      <span className="mt-4 text-[clamp(14px,1vw,16px)] font-semibold text-[#ece7df]">
                        {s.title}
                      </span>
                      <span className="mt-1.5 text-[clamp(12px,0.85vw,13.5px)] leading-[1.6]" style={{ color: T.body }}>
                        {s.blurb}
                      </span>
                      <span
                        className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] transition-colors group-hover:text-[#cfc8bf]"
                        style={{ color: T.dim }}
                      >
                        {s.items.length} {s.items.length === 1 ? 'answer' : 'answers'}
                      </span>
                    </a>
                  </Reveal>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Answers ──────────────────────────────────────────────────── */}
        <section className="page-gutter pb-[clamp(60px,9vh,120px)]">
          {q && (
            <p className="mb-8 text-[13px]" style={{ color: T.body }}>
              {matches === 0
                ? 'Nothing matched. Try fewer words — or email us and we will answer it.'
                : `${matches} ${matches === 1 ? 'answer' : 'answers'} for “${query.trim()}”`}
            </p>
          )}

          <div className="flex flex-col gap-[clamp(44px,6vh,84px)]">
            {sections.map((section) => {
              const Icon = SECTION_ICON[section.id] ?? BookOpen;
              return (
                <section key={section.id} id={section.id} className="scroll-mt-[90px]">
                  <Reveal className="mb-[clamp(18px,2.4vh,28px)]">
                    <div className="flex items-center gap-3">
                      <span className="grid h-[34px] w-[34px] place-items-center rounded-[9px] border border-white/[0.07] bg-white/[0.03] text-[#cfc8bf]">
                        <Icon className="h-4 w-4" strokeWidth={1.7} />
                      </span>
                      <h2 className="text-[clamp(1.15rem,1.5vw,1.65rem)] font-semibold tracking-[-0.01em] text-[#ece7df]">
                        {section.title}
                      </h2>
                    </div>
                  </Reveal>
                  <div className="flex flex-col gap-2.5">
                    {section.items.map((item, i) => {
                      const key = `${section.id}:${item.q}`;
                      return (
                        <Reveal key={key} delay={Math.min(i * 45, 140)}>
                          <Answer
                            item={item}
                            open={isOpen(key)}
                            onToggle={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}
                          />
                        </Reveal>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </section>

        {/* ── Still stuck ──────────────────────────────────────────────── */}
        <section className="page-gutter border-t border-white/[0.06] py-[clamp(60px,9vh,120px)]">
          <Reveal>
            <div className="mx-auto max-w-[720px] text-center">
              <Eyebrow className="justify-center">Still stuck</Eyebrow>
              <h2 className="mt-[clamp(12px,1.6vh,20px)] text-[clamp(1.5rem,2.2vw,2.4rem)] font-semibold leading-[1.12] tracking-[-0.01em] text-[#ece7df]">
                Write to us
              </h2>
              <p
                className="mx-auto mt-[clamp(12px,1.8vh,20px)] max-w-[520px] text-[clamp(12.5px,0.9vw,15px)] leading-[1.65]"
                style={{ color: T.body }}
              >
                Include the email address on your account — and for anything about a payment, the
                date and the amount. It lets us answer on the first reply instead of the third.
              </p>
              <div className="mt-[clamp(22px,3vh,34px)] flex flex-wrap items-center justify-center gap-3">
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="inline-flex items-center gap-2 rounded-[10px] border border-white/20 bg-white/[0.06] px-6 py-3 text-[13.5px] font-medium text-[#ece7df] transition-colors hover:border-white/35 hover:bg-white/[0.10]"
                >
                  <Mail className="h-4 w-4" strokeWidth={1.8} />
                  {SUPPORT_EMAIL}
                </a>
                <Link
                  to="/forum"
                  className="inline-flex items-center gap-2 rounded-[10px] border border-white/[0.08] px-6 py-3 text-[13.5px] font-medium transition-colors hover:border-white/20 hover:text-white"
                  style={{ color: T.light }}
                >
                  <MessagesSquare className="h-4 w-4" strokeWidth={1.8} />
                  Ask the forum
                </Link>
                <Link
                  to="/docs"
                  className="inline-flex items-center gap-2 rounded-[10px] border border-white/[0.08] px-6 py-3 text-[13.5px] font-medium transition-colors hover:border-white/20 hover:text-white"
                  style={{ color: T.light }}
                >
                  <FileText className="h-4 w-4" strokeWidth={1.8} />
                  Documentation
                </Link>
              </div>
              <div className="mt-[clamp(26px,3.4vh,40px)] flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[12px]">
                {[
                  ['Terms', '/terms'],
                  ['Privacy', '/privacy'],
                  ['Right of withdrawal', '/withdrawal'],
                  ['Impressum', '/impressum'],
                ].map(([label, href]) => (
                  <Link key={href} to={href} className="transition-colors hover:text-[#cfc8bf]" style={{ color: T.dim }}>
                    {label}
                  </Link>
                ))}
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default Support;
