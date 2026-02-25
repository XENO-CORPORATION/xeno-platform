import React, { useEffect, useState, useRef } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';

const heroContent: Record<string, { title: string; subtitle: string; description: string }> = {
  '/auth': {
    title: 'Create without',
    subtitle: 'limits.',
    description: 'The next-generation platform for creators. Design, generate, and build with the power of AI at your fingertips.'
  },
  '/help': {
    title: 'How can we',
    subtitle: 'help?',
    description: 'Find answers to common questions or chat with our support team for personalized assistance.'
  },
  '/contact': {
    title: 'Get in',
    subtitle: 'touch.',
    description: "Have a question or feedback? We'd love to hear from you. Our team typically responds within 24 hours."
  }
};

const statsContent: Record<string, Array<{ value: string; label: string }>> = {
  '/auth': [
    { value: '50K+', label: 'Creators' },
    { value: '1M+', label: 'Creations' },
    { value: '4.9', label: 'Rating' }
  ],
  '/help': [
    { value: '5+', label: 'FAQ Topics' },
    { value: 'Live', label: 'Chat Support' }
  ],
  '/contact': [
    { value: '<24h', label: 'Response' },
    { value: '24/7', label: 'Support' }
  ]
};

const AuthLayout = () => {
  const location = useLocation();
  const path = location.pathname;
  const prevPathRef = useRef(path);

  const [displayedHero, setDisplayedHero] = useState(heroContent[path] || heroContent['/auth']);
  const [displayedStats, setDisplayedStats] = useState(statsContent[path] || statsContent['/auth']);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Animate hero/stats when route changes
  useEffect(() => {
    // Skip if same path
    if (prevPathRef.current === path) return;
    prevPathRef.current = path;

    const newHero = heroContent[path] || heroContent['/auth'];
    const newStats = statsContent[path] || statsContent['/auth'];

    setIsTransitioning(true);

    // Fade out, then update content, then fade in
    const fadeOutTimer = setTimeout(() => {
      setDisplayedHero(newHero);
      setDisplayedStats(newStats);

      // Fade back in after content updates
      requestAnimationFrame(() => {
        setIsTransitioning(false);
      });
    }, 300);

    return () => {
      clearTimeout(fadeOutTimer);
    };
  }, [path]);

  return (
    <div className="min-h-screen bg-[#000000] text-white font-['Inter',sans-serif] overflow-hidden antialiased flex">

      {/* Left Side - Hero Section with Video (STATIC - video never re-renders) */}
      <div className="hidden lg:flex lg:w-[55%] xl:w-[60%] relative overflow-hidden">
        <video
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        >
          <source src="/hero-bg.mp4" type="video/mp4" />
        </video>

        <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/40 to-black/80" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40" />

        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 h-full w-full">
          {/* Logo - Always static */}
          <Link
            to="/"
            className="flex items-center gap-3 group"
          >
            <img
              src="/logo.svg"
              alt="Xeno"
              className="w-10 h-10 rounded-xl object-contain invert transition-transform duration-300 ease-out group-hover:scale-105"
            />
            <span className="text-2xl font-bold tracking-tight transition-opacity duration-300 group-hover:opacity-80">Xeno</span>
          </Link>

          {/* Hero Text - Animated on route change */}
          <div
            className={`max-w-xl transition-all duration-500 ease-out ${
              isTransitioning
                ? 'opacity-0 translate-y-4'
                : 'opacity-100 translate-y-0'
            }`}
          >
            <h1 className="text-4xl lg:text-5xl xl:text-6xl font-bold leading-[1.05] tracking-tight mb-6 text-white">
              {displayedHero.title}
              <br />
              <span className="text-white/40">
                {displayedHero.subtitle}
              </span>
            </h1>
            <p className="text-base lg:text-lg text-white/50 leading-relaxed max-w-md">
              {displayedHero.description}
            </p>
          </div>

          {/* Stats - Animated on route change */}
          <div
            className={`flex items-center gap-10 lg:gap-12 transition-all duration-500 ease-out delay-100 ${
              isTransitioning
                ? 'opacity-0 translate-y-4'
                : 'opacity-100 translate-y-0'
            }`}
          >
            {displayedStats.map((stat, index) => (
              <React.Fragment key={`${stat.label}-${index}`}>
                {index > 0 && (
                  <div className="w-px h-8 lg:h-10 bg-white/10 transition-opacity duration-300" />
                )}
                <div className="transition-all duration-300 ease-out hover:translate-y-[-2px]">
                  <div className="text-2xl lg:text-3xl font-bold text-white">{stat.value}</div>
                  <div className="text-sm text-white/40">{stat.label}</div>
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Animated gradient border */}
        <div className="absolute right-0 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-white/20 to-transparent" />
      </div>

      {/* Right Side - Dynamic Content (no key-based remount, content handles its own animation) */}
      <div className="flex-1 flex flex-col min-h-screen bg-[#0a0a0c] relative overflow-hidden">
        {/* Scrollable content area */}
        <div className="flex-1 flex flex-col overflow-y-auto">
          <Outlet />
        </div>

        {/* Static Footer - doesn't re-animate on route change */}
        <footer className="hidden lg:flex items-center justify-between px-12 xl:px-20 py-6 border-t border-white/[0.04] bg-[#0a0a0c]">
          <p className="text-xs text-white/30">© 2026 Xeno. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <Link
              to="/help"
              className={`text-xs transition-all duration-300 hover:translate-x-0.5 ${
                path === '/help' ? 'text-white/60' : 'text-white/30 hover:text-white/60'
              }`}
            >
              Help
            </Link>
            <Link
              to="/contact"
              className={`text-xs transition-all duration-300 hover:translate-x-0.5 ${
                path === '/contact' ? 'text-white/60' : 'text-white/30 hover:text-white/60'
              }`}
            >
              Contact
            </Link>
            <Link
              to="/auth"
              className={`text-xs transition-all duration-300 hover:translate-x-0.5 ${
                path === '/auth' ? 'text-white/60' : 'text-white/30 hover:text-white/60'
              }`}
            >
              Sign In
            </Link>
          </div>
        </footer>
      </div>

      {/* Global animation styles */}
      <style>{`
        @keyframes fadeSlideIn {
          0% {
            opacity: 0;
            transform: translateX(20px);
          }
          100% {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes fadeSlideUp {
          0% {
            opacity: 0;
            transform: translateY(20px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes fadeIn {
          0% {
            opacity: 0;
          }
          100% {
            opacity: 1;
          }
        }

        .animate-fadeSlideIn {
          animation: fadeSlideIn 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }

        .animate-fadeSlideUp {
          animation: fadeSlideUp 0.6s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }

        .animate-fadeIn {
          animation: fadeIn 0.4s ease-out forwards;
        }

        /* Staggered children animation */
        .stagger-children > * {
          opacity: 0;
          animation: fadeSlideUp 0.5s cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }

        .stagger-children > *:nth-child(1) { animation-delay: 0.05s; }
        .stagger-children > *:nth-child(2) { animation-delay: 0.1s; }
        .stagger-children > *:nth-child(3) { animation-delay: 0.15s; }
        .stagger-children > *:nth-child(4) { animation-delay: 0.2s; }
        .stagger-children > *:nth-child(5) { animation-delay: 0.25s; }
        .stagger-children > *:nth-child(6) { animation-delay: 0.3s; }
        .stagger-children > *:nth-child(7) { animation-delay: 0.35s; }
        .stagger-children > *:nth-child(8) { animation-delay: 0.4s; }
      `}</style>
    </div>
  );
};

export default AuthLayout;
