import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';

const AuthLayout = () => {
  const location = useLocation();
  const path = location.pathname;

  return (
    /* ── VIEWPORT-LOCKED ──────────────────────────────────────────────────
       h-[100dvh], NOT h-screen. `vh` on mobile is measured against the
       viewport WITHOUT browser chrome, so the address bar overlaps the bottom
       of the page — which on an auth screen is exactly where the submit button
       and the legal line live. `dvh` tracks the chrome as it hides and shows.
       h-screen is kept as the fallback for engines without dvh.

       overflow-hidden on the SHELL so the page itself never scrolls; the
       content region below scrolls INSIDE itself when it has to. That
       distinction matters because /help and /contact live in this layout and
       are genuinely long — locking the whole thing would truncate them. */
    <div className="h-screen h-[100dvh] overflow-hidden bg-[#000000] text-white font-['Inter',sans-serif] antialiased flex flex-col">

      {/* ── CENTRED, NO HERO PANEL ────────────────────────────────────────────
          Was a 55/60% split with an autoplaying /hero-bg.mp4 and a stats strip.

            1. 3.2 MB of video loaded before anyone typed a character, on the
               screens whose entire job is one action.
            2. The stats read "50K+ Creators · 1M+ Creations · 4.9 Rating"
               against 7 real accounts. Removing the panel removes the claim;
               keeping it meant inventing an honest version of a number that
               had none.
            3. DESIGN_SYSTEM.md is monochromatic, dense and undecorated. A
               full-bleed marketing video with counters is another product's
               language.

          🔴 THIS LAYOUT DELIBERATELY IMPOSES NO COLUMN AND NO HEADING.
          Every page inside it already centres its own content
          (`max-w-[400px] mx-auto`) and already renders its own heading — the
          hero copy was the SECOND heading on every screen, and a width here
          would fight the padding each page brings for the old right-hand pane.
          Give them the viewport; they were already built to centre in it.

          The per-route hero COPY is gone rather than relocated: each page's own
          heading is the more specific of the two ("Verifying your email" beats
          "Verify your email."). heroContent, statsContent, the transition state
          and the effect that drove them are DELETED, not left behind — dead
          config outlives the person who knows it is dead. */}

      {/* min-h-0 is what actually lets this shrink below its content. Without
          it a flex child refuses to, the inner scrollbar never appears, and the
          shell's overflow-hidden silently clips instead. */}
      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
        <div className="flex-1 flex flex-col justify-center">
          <Outlet />
        </div>
      </div>

      <footer className="shrink-0 flex items-center justify-center gap-6 px-6 py-5 border-t border-white/[0.04]">
        <p className="text-xs text-white/25">© 2026 Xeno</p>
        {[['/help', 'Help'], ['/contact', 'Contact'], ['/login', 'Sign In']].map(([to, label]) => (
          <Link
            key={to}
            to={to}
            className={`text-xs transition-colors duration-300 ${
              path === to ? 'text-white/60' : 'text-white/30 hover:text-white/60'
            }`}
          >
            {label}
          </Link>
        ))}
      </footer>

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
