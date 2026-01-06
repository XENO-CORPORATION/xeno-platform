import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X, ArrowRight } from 'lucide-react';

interface HeaderProps {
  onGetStarted: () => void;
}

const Header: React.FC<HeaderProps> = ({ onGetStarted }) => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navItems = [
    { label: 'Features', href: '#features' },
    { label: 'Use Cases', href: '#use-cases' },
    { label: 'Pricing', href: '#pricing' },
    { label: 'Docs', href: '#docs' },
  ];

  return (
    <>
      {/* Floating Island Header */}
      <header className="fixed top-0 left-0 right-0 z-50 flex justify-center px-4 pt-4">
        <div
          className={`
            relative flex items-center justify-between gap-2
            px-3 py-2.5
            rounded-2xl
            border border-white/[0.08]
            transition-all duration-500 ease-out
            ${isScrolled 
              ? 'bg-white/[0.03] backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.05)]' 
              : 'bg-white/[0.02] backdrop-blur-xl shadow-[0_4px_24px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.03)]'
            }
          `}
          style={{
            width: 'min(95vw, 900px)',
          }}
        >
          {/* Glass reflection effect */}
          <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
            <div 
              className="absolute inset-0 opacity-[0.03]"
              style={{
                background: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 50%, transparent 100%)',
              }}
            />
          </div>

          {/* Logo */}
          <Link to="/" className="relative flex items-center gap-2.5 pl-1 group">
            <img 
              src="/logo.svg" 
              alt="Xeno" 
              className="w-8 h-8 rounded-lg object-contain transition-transform group-hover:scale-105 invert"
            />
            <span className="text-[15px] font-semibold text-white tracking-tight">Xeno</span>
          </Link>

          {/* Desktop Navigation - Center */}
          <nav className="hidden md:flex items-center gap-1 mx-4">
            {navItems.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="relative px-3.5 py-2 text-[13px] text-white/50 hover:text-white transition-colors font-medium rounded-lg hover:bg-white/[0.04]"
              >
                {item.label}
              </a>
            ))}
          </nav>

          {/* Desktop CTAs */}
          <div className="hidden md:flex items-center gap-2 pr-1">
            <button
              onClick={onGetStarted}
              className="px-3.5 py-2 text-[13px] text-white/50 hover:text-white transition-colors font-medium rounded-lg hover:bg-white/[0.04]"
            >
              Sign In
            </button>
            <button
              onClick={onGetStarted}
              className="group flex items-center gap-1.5 px-4 py-2 bg-white text-[#08080a] text-[13px] font-semibold rounded-xl hover:bg-white/90 transition-all hover:shadow-[0_0_20px_rgba(255,255,255,0.15)]"
            >
              Get Started
              <ArrowRight size={13} strokeWidth={2.5} className="group-hover:translate-x-0.5 transition-transform" />
            </button>
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden p-2 text-white/70 hover:text-white transition-colors rounded-lg hover:bg-white/[0.04]"
          >
            {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>

      {/* Mobile Menu */}
      <div
        className={`fixed inset-0 z-40 transition-all duration-300 md:hidden ${
          isMobileMenuOpen ? 'opacity-100 visible' : 'opacity-0 invisible pointer-events-none'
        }`}
      >
        {/* Backdrop */}
        <div 
          className="absolute inset-0 bg-[#08080a]/90 backdrop-blur-xl"
          onClick={() => setIsMobileMenuOpen(false)}
        />
        
        {/* Menu Content */}
        <div className="relative flex flex-col h-full pt-24 px-6 pb-8">
          <nav className="flex-1 flex flex-col gap-1">
            {navItems.map((item, i) => (
              <a
                key={item.label}
                href={item.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className={`py-4 text-xl font-medium text-white/60 hover:text-white transition-all border-b border-white/[0.05] ${
                  isMobileMenuOpen ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'
                }`}
                style={{ transitionDelay: `${i * 50}ms` }}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="space-y-3 mt-auto">
            <button
              onClick={() => {
                setIsMobileMenuOpen(false);
                onGetStarted();
              }}
              className="w-full py-3.5 text-white/60 font-medium border border-white/[0.08] rounded-xl hover:bg-white/[0.03] transition-colors"
            >
              Sign In
            </button>
            <button
              onClick={() => {
                setIsMobileMenuOpen(false);
                onGetStarted();
              }}
              className="w-full py-3.5 bg-white text-[#08080a] font-semibold rounded-xl flex items-center justify-center gap-2 hover:bg-white/90 transition-colors"
            >
              Get Started
              <ArrowRight size={16} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default Header;
