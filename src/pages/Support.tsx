import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Search, Mail, CreditCard } from 'lucide-react';
import {
  SUPPORT_SECTIONS,
  SUPPORT_EMAIL,
  STATEMENT_DESCRIPTOR,
  STATEMENT_DESCRIPTOR_LONG,
} from '../content/support';

/*
 * The support centre.
 *
 * Content lives in src/content/support.ts and is rendered TWICE — here, and as
 * static HTML by scripts/prerender-products.mjs. Do not put answer text in this
 * file: a reader without JavaScript would never see it, and this is the page
 * that has to be real HTML (see the header comment in the content module).
 */

const isExternal = (href: string) => /^(https?:|mailto:)/.test(href);

const SupportLinkView: React.FC<{ href: string; label: string }> = ({ href, label }) =>
  isExternal(href) ? (
    <a
      href={href}
      className="text-sm text-white/70 underline decoration-white/20 underline-offset-4 hover:text-white hover:decoration-white/60 transition-colors"
      {...(href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
    >
      {label}
    </a>
  ) : (
    <Link
      to={href}
      className="text-sm text-white/70 underline decoration-white/20 underline-offset-4 hover:text-white hover:decoration-white/60 transition-colors"
    >
      {label}
    </Link>
  );

const Support: React.FC = () => {
  const [query, setQuery] = useState('');

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SUPPORT_SECTIONS;
    return SUPPORT_SECTIONS.map((section) => ({
      ...section,
      items: section.items.filter(
        (item) =>
          item.q.toLowerCase().includes(q) ||
          item.a.some((p) => p.toLowerCase().includes(q)),
      ),
    })).filter((section) => section.items.length > 0);
  }, [query]);

  const matchCount = sections.reduce((n, s) => n + s.items.length, 0);

  return (
    <div className="min-h-screen h-full bg-[#08080a] text-white font-['Inter',sans-serif] flex flex-col">
      <header className="border-b border-white/[0.05]">
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3 group">
            <img src="/logo.svg" alt="" className="w-8 h-8 rounded-lg object-contain invert" />
            <span className="text-lg font-semibold text-white">XENOsystem</span>
          </Link>
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors"
          >
            <ArrowLeft size={16} />
            Back to Home
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto px-6 py-12 lg:py-16 w-full">
        <h1 className="text-4xl font-bold tracking-tight mb-3">Support</h1>
        <p className="text-white/60 mb-8 max-w-2xl">
          Answers to the things people actually write in about. If you do not find it here,
          email us — a person reads it.
        </p>

        {/* The charge question first: it is the single most common reason someone
            arrives here from a bank statement, and the reason this URL is given
            to payment partners. */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 mb-10">
          <div className="flex items-start gap-3">
            <CreditCard size={18} className="mt-0.5 text-white/50 shrink-0" />
            <div>
              <h2 className="font-semibold mb-1">Looking at a charge you do not recognise?</h2>
              <p className="text-sm text-white/60 mb-3">
                Payments from us show as <span className="text-white/90 font-medium">{STATEMENT_DESCRIPTOR}</span>{' '}
                or <span className="text-white/90 font-medium">{STATEMENT_DESCRIPTOR_LONG}</span> on your
                statement. Email us the date, amount and last four digits of the card and we
                will identify it — you do not need to raise a dispute with your bank first.
              </p>
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="inline-flex items-center gap-2 text-sm font-medium text-white hover:text-white/80 transition-colors"
              >
                <Mail size={15} />
                {SUPPORT_EMAIL}
              </a>
            </div>
          </div>
        </div>

        <div className="relative mb-10">
          <Search
            size={16}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search support"
            aria-label="Search support"
            className="w-full rounded-lg bg-white/[0.04] border border-white/10 pl-11 pr-4 py-3 text-sm text-white placeholder:text-white/30 outline-none ring-0 focus:border-white/25 focus:bg-white/[0.06] transition-colors"
          />
        </div>

        {query.trim() && (
          <p className="text-sm text-white/40 -mt-6 mb-8">
            {matchCount === 0
              ? 'Nothing matched. Try fewer words, or email us.'
              : `${matchCount} ${matchCount === 1 ? 'answer' : 'answers'}`}
          </p>
        )}

        <div className="space-y-12">
          {sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-24">
              <h2 className="text-2xl font-semibold tracking-tight mb-1">{section.title}</h2>
              <p className="text-sm text-white/45 mb-6">{section.blurb}</p>
              <div className="space-y-6">
                {section.items.map((item) => (
                  <div
                    key={item.q}
                    className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-5"
                  >
                    <h3 className="font-semibold mb-2">{item.q}</h3>
                    {item.a.map((para, i) => (
                      <p key={i} className="text-sm text-white/60 leading-relaxed mb-2 last:mb-0">
                        {para}
                      </p>
                    ))}
                    {item.links && item.links.length > 0 && (
                      <div className="flex flex-wrap gap-x-5 gap-y-2 mt-3">
                        {item.links.map((l) => (
                          <SupportLinkView key={l.href + l.label} href={l.href} label={l.label} />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <section className="mt-16 pt-8 border-t border-white/[0.07]">
          <h2 className="text-2xl font-semibold tracking-tight mb-2">Still stuck?</h2>
          <p className="text-sm text-white/60 mb-4 max-w-2xl">
            Email{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-white underline decoration-white/25 underline-offset-4 hover:decoration-white/60">
              {SUPPORT_EMAIL}
            </a>
            . Include the email address on your account, and for anything about a payment, the
            date and amount — it lets us answer on the first reply instead of the third.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link to="/forum" className="text-white/70 underline decoration-white/20 underline-offset-4 hover:text-white">Forum</Link>
            <Link to="/docs" className="text-white/70 underline decoration-white/20 underline-offset-4 hover:text-white">Documentation</Link>
            <Link to="/terms" className="text-white/70 underline decoration-white/20 underline-offset-4 hover:text-white">Terms</Link>
            <Link to="/privacy" className="text-white/70 underline decoration-white/20 underline-offset-4 hover:text-white">Privacy</Link>
            <Link to="/withdrawal" className="text-white/70 underline decoration-white/20 underline-offset-4 hover:text-white">Right of withdrawal</Link>
            <Link to="/impressum" className="text-white/70 underline decoration-white/20 underline-offset-4 hover:text-white">Impressum</Link>
          </div>
        </section>
      </main>
    </div>
  );
};

export default Support;
