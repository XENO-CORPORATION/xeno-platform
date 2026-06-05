import React from 'react';
import { Link } from 'react-router-dom';
import { Twitter, MessageCircle, Youtube, AtSign } from 'lucide-react';

const Footer: React.FC = () => {
  const footerLinks = {
    Product: [
      { label: 'Features', href: '#features' },
      { label: 'Pricing', href: '#pricing' },
      { label: 'Download', href: '/download' },
      { label: "What's New", href: '/releases/latest' },
      { label: 'Roadmap', href: '#roadmap' },
    ],
    Resources: [
      { label: 'Blog', href: '/blog' },
      { label: 'Documentation', href: '#docs' },
      { label: 'Tutorials', href: '/learn' },
      { label: 'Templates', href: '#templates' },
      { label: 'API', href: '#api' },
    ],
    Company: [
      { label: 'About Us', href: '#about' },
      { label: 'Careers', href: '#careers' },
      { label: 'Press', href: '#press' },
      { label: 'Partners', href: '#partners' },
      { label: 'Contact', href: '#contact' },
    ],
    Legal: [
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Service', href: '/terms' },
      { label: 'Refund Policy', href: '#refund' },
      { label: 'Security', href: '#security' },
      { label: 'Cookies', href: '#cookies' },
    ],
  };

  const socialLinks = [
    { icon: Twitter,        href: '#', label: 'X' },
    { icon: MessageCircle,  href: '#', label: 'Discord' },
    { icon: Youtube,        href: '#', label: 'YouTube' },
    { icon: AtSign,         href: '#', label: 'Bluesky' },
  ];

  return (
    <footer className="relative border-t border-white/[0.06] bg-[#060606]">
      <div className="mx-auto w-full px-[1vw] pb-[clamp(20px,2.4vh,36px)] pt-[clamp(40px,5vh,64px)]">
        {/* ── Top: brand + 4 link columns ─────────────────────────── */}
        <div className="grid grid-cols-2 gap-[clamp(28px,3vw,52px)] md:grid-cols-6 lg:grid-cols-6">
          {/* Brand column (spans 2) */}
          <div className="col-span-2">
            <Link to="/v3" className="mb-[clamp(14px,1.6vh,22px)] flex items-center gap-2.5">
              <img
                src="/xeno-logo.svg"
                alt=""
                className="h-6 w-6 invert"
              />
              <span className="text-[clamp(14px,1vw,16px)] font-semibold tracking-tight text-white">XENO AI</span>
            </Link>
            <p className="mb-[clamp(16px,1.8vh,24px)] max-w-[260px] text-[clamp(12px,0.85vw,13.5px)] leading-[1.55] text-[#807970]">
              The complete visual AI workspace for creative professionals.
            </p>
            <div className="flex items-center gap-2.5">
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
              <h4 className="mb-[clamp(12px,1.4vh,18px)] text-[clamp(12.5px,0.9vw,14px)] font-semibold text-white">
                {category}
              </h4>
              <ul className="space-y-[clamp(8px,1vh,14px)]">
                {links.map((link) => {
                  const cls =
                    'text-[clamp(11.5px,0.82vw,13.5px)] text-[#807970] transition-colors hover:text-white';
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

        {/* ── Bottom: copyright + status ──────────────────────────── */}
        <div className="mt-[clamp(28px,3.4vh,52px)] flex flex-col items-start justify-between gap-3 border-t border-white/[0.06] pt-[clamp(16px,1.8vh,24px)] sm:flex-row sm:items-center">
          <p className="text-[clamp(11px,0.78vw,13px)] text-[#69635b]">
            © {new Date().getFullYear()} XENO Corporation. All rights reserved.
          </p>
          <div className="flex items-center gap-2 text-[clamp(11px,0.78vw,13px)] text-[#807970]">
            <span>All systems operational</span>
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]" />
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
