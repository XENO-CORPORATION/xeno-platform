import React from 'react';
import { Link } from 'react-router-dom';
import { Twitter, MessageCircle, Youtube, AtSign, ArrowRight } from 'lucide-react';

// Every link resolves to a real page (no dead "#" anchors).
const footerLinks: Record<string, { label: string; href: string }[]> = {
  Product: [
    { label: 'Features', href: '/features' },
    { label: 'Pricing', href: '/pricing' },
    { label: 'Download', href: '/product/hub/download' },
    { label: "What's new", href: '/product/hub/releases' },
    { label: 'Roadmap', href: '/roadmap' },
  ],
  Resources: [
    { label: 'Documentation', href: '/docs' },
    { label: 'Tutorials', href: '/learn' },
    { label: 'Templates', href: '/templates' },
    { label: 'API', href: '/api-reference' },
    { label: 'Blog', href: '/blog' },
    // Forum enters via the footer only. It takes a top-level nav slot when
    // there is a reason to click it, not before (SPEC D12).
    { label: 'Forum', href: '/forum' },
  ],
  Company: [
    { label: 'About', href: '/about' },
    { label: 'Careers', href: '/careers' },
    { label: 'Press', href: '/press' },
    { label: 'Partners', href: '/partners' },
    { label: 'Contact', href: '/contact' },
  ],
  Legal: [
    { label: 'Impressum', href: '/impressum' },
    { label: 'Privacy', href: '/privacy' },
    { label: 'Terms', href: '/terms' },
    { label: 'Security', href: '/security' },
    { label: 'Refunds', href: '/refunds' },
    { label: 'Cookies', href: '/cookies' },
  ],
};

const socialLinks = [
  { icon: Twitter, href: '#', label: 'X' },
  { icon: MessageCircle, href: '#', label: 'Discord' },
  { icon: Youtube, href: '#', label: 'YouTube' },
  { icon: AtSign, href: '#', label: 'Bluesky' },
];

const Footer: React.FC = () => {
  return (
    <footer className="relative border-t border-white/[0.08] bg-[#060606]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.18),transparent)]" />

      <div className="page-gutter mx-auto w-full pb-[clamp(16px,2vh,26px)] pt-[clamp(28px,3.4vh,48px)]">
        {/* ── Top: brand + link columns ─────────────────────────── */}
        <div className="grid grid-cols-2 gap-x-[clamp(24px,2.6vw,52px)] gap-y-[clamp(20px,2.6vh,30px)] md:grid-cols-6">
          {/* Brand */}
          <div className="col-span-2 md:col-span-2">
            <Link to="/" className="mb-[clamp(14px,1.6vh,20px)] flex items-center gap-2.5">
              <img src="/xeno-logo.svg" alt="" className="h-6 w-6 invert" />
              <span className="text-[clamp(14px,1vw,16px)] font-semibold tracking-tight text-white">XENO AI</span>
            </Link>
            <p className="mb-[clamp(16px,1.8vh,22px)] max-w-[280px] text-[clamp(12px,0.85vw,13.5px)] leading-[1.55] text-[#807970]">
              The complete AI workspace for creation, code, media, workflows and intelligent agents.
            </p>

            {/* Newsletter */}
            <form
              onSubmit={(e) => e.preventDefault()}
              className="flex max-w-[300px] items-center gap-1.5 rounded-[9px] border border-white/[0.10] bg-white/[0.02] py-1 pl-3 pr-1 transition-colors focus-within:border-white/25"
            >
              <input
                type="email"
                placeholder="Get product updates"
                aria-label="Email address"
                className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[#e6e1d9] placeholder:text-[#69635b] outline-none"
              />
              <button
                type="submit"
                aria-label="Subscribe"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-white/10 text-[#cdc7be] transition-colors hover:bg-white/15 hover:text-white"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>

            <div className="mt-[clamp(18px,2vh,26px)] flex items-center gap-2.5">
              {socialLinks.map((s) => {
                const Icon = s.icon;
                return (
                  <a
                    key={s.label}
                    href={s.href}
                    aria-label={s.label}
                    className="grid h-8 w-8 place-items-center rounded-md border border-white/[0.08] bg-white/[0.02] text-[#807970] transition-colors hover:border-white/20 hover:text-white"
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </a>
                );
              })}
            </div>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h4 className="mb-[clamp(12px,1.4vh,18px)] text-[clamp(11px,0.78vw,12.5px)] font-semibold uppercase tracking-[0.16em] text-[#6f685f]">
                {category}
              </h4>
              <ul className="space-y-[clamp(6px,0.8vh,10px)]">
                {links.map((link) => {
                  const cls = 'text-[clamp(11.5px,0.82vw,13.5px)] text-[#948d83] transition-colors hover:text-white';
                  return (
                    <li key={link.label}>
                      {link.href.startsWith('/') ? (
                        <Link to={link.href} className={cls}>{link.label}</Link>
                      ) : (
                        <a href={link.href} className={cls}>{link.label}</a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        {/* ── Bottom bar ──────────────────────────────────────────── */}
        <div className="mt-[clamp(22px,2.6vh,34px)] flex flex-col items-start justify-between gap-3 border-t border-white/[0.06] pt-[clamp(14px,1.6vh,20px)] sm:flex-row sm:items-center">
          <p className="text-[clamp(11px,0.78vw,13px)] text-[#69635b]">
            © {new Date().getFullYear()} XENO Corporation. All rights reserved.
          </p>
          <div className="flex items-center gap-2 text-[clamp(11px,0.78vw,13px)] text-[#807970]">
            <span className="h-2 w-2 rounded-[2px] bg-emerald-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]" />
            <span>All systems operational</span>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
