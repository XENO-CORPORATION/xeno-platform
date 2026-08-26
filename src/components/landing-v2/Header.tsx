import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ChevronDown, Menu, X } from 'lucide-react';

interface HeaderProps {
  onGetStarted: () => void;
  visible?: boolean;
}

const navItems = [
  { label: 'Product', href: '#product', hasMenu: true },
  { label: 'Solutions', href: '#solutions', hasMenu: true },
  { label: 'Resources', href: '#resources', hasMenu: true },
  { label: 'Docs', href: '/learn' },
  { label: 'Enterprise', href: '#enterprise' },
  { label: 'Pricing', href: '#pricing' },
];

const Header: React.FC<HeaderProps> = ({ onGetStarted, visible = true }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
          visible ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0 pointer-events-none'
        }`}
      >
        <div className="mx-auto flex h-[78px] w-full max-w-[1920px] items-center justify-between px-7 sm:px-10 lg:px-[4.7vw]">
          <Link to="/v2" className="group flex items-center gap-4" aria-label="XENO AI home">
            <img
              src="/xeno-logo.svg"
              alt=""
              className="h-9 w-9 object-contain invert drop-shadow-[0_0_14px_rgba(255,255,255,0.26)] transition-transform duration-300 group-hover:scale-105"
            />
            <span className="text-[22px] font-medium uppercase tracking-[0.36em] text-white/90">XENO AI</span>
          </Link>

          <nav className="hidden items-center gap-[2.25vw] lg:flex">
            {navItems.map((item) => {
              const className = 'group inline-flex items-center gap-1.5 text-[15px] font-medium text-white/50 transition-colors hover:text-white/90';
              const content = (
                <>
                  <span>{item.label}</span>
                  {item.hasMenu && <ChevronDown className="h-3.5 w-3.5 opacity-70 transition-transform group-hover:translate-y-0.5" />}
                </>
              );

              return item.href.startsWith('/') ? (
                <Link key={item.label} to={item.href} className={className}>
                  {content}
                </Link>
              ) : (
                <a key={item.label} href={item.href} className={className}>
                  {content}
                </a>
              );
            })}
          </nav>

          <div className="hidden items-center gap-7 lg:flex">
            <button
              type="button"
              onClick={onGetStarted}
              className="text-[15px] font-medium text-white/60 transition-colors hover:text-white"
            >
              Sign in
            </button>
            <Link
              to="/signup"
              className="group inline-flex h-[54px] items-center gap-4 rounded-[10px] border border-white/45 bg-[#1a1029]/20 px-7 text-[15px] font-semibold text-[#b98cff] shadow-[0_0_34px_rgba(130,76,255,0.12),inset_0_0_22px_rgba(174,130,255,0.06)] transition-all duration-300 hover:border-[#caa8ff]/75 hover:text-white hover:shadow-[0_0_44px_rgba(158,111,255,0.22),inset_0_0_24px_rgba(174,130,255,0.10)]"
            >
              Launch XENO
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setIsMobileMenuOpen((open) => !open)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-[10px] border border-white/10 bg-black/25 text-white/75 backdrop-blur-xl lg:hidden"
            aria-label="Toggle navigation"
          >
            {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </header>

      <div
        className={`fixed inset-0 z-40 bg-[#050506]/95 backdrop-blur-2xl transition-all duration-300 lg:hidden ${
          isMobileMenuOpen ? 'visible opacity-100' : 'invisible opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex h-full flex-col px-7 pb-8 pt-24">
          <nav className="flex flex-1 flex-col">
            {navItems.map((item) => {
              const className = 'flex items-center justify-between border-b border-white/[0.07] py-5 text-xl font-medium text-white/70';
              const content = (
                <>
                  <span>{item.label}</span>
                  {item.hasMenu && <ChevronDown className="h-4 w-4 text-white/35" />}
                </>
              );

              return item.href.startsWith('/') ? (
                <Link key={item.label} to={item.href} onClick={() => setIsMobileMenuOpen(false)} className={className}>
                  {content}
                </Link>
              ) : (
                <a key={item.label} href={item.href} onClick={() => setIsMobileMenuOpen(false)} className={className}>
                  {content}
                </a>
              );
            })}
          </nav>

          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => {
                setIsMobileMenuOpen(false);
                onGetStarted();
              }}
              className="h-12 rounded-[10px] border border-white/10 text-sm font-semibold text-white/60"
            >
              Sign in
            </button>
            <Link
              to="/signup"
              onClick={() => setIsMobileMenuOpen(false)}
              className="flex h-12 items-center justify-center gap-2 rounded-[10px] border border-[#a87cff]/50 bg-[#1a1029]/30 text-sm font-semibold text-[#bd92ff]"
            >
              Launch XENO <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </>
  );
};

export default Header;
