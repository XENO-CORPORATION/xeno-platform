import React, { useState, FormEvent, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useSiteGate } from '../../contexts/SiteGateContext';

const SiteGate: React.FC = () => {
  const { unlock } = useSiteGate();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const success = unlock(password);

    if (!success) {
      setError(true);
      setShake(true);

      // Clear password and reset states
      setTimeout(() => {
        setPassword('');
        setError(false);
        setShake(false);
      }, 820);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-hidden bg-[#08080a] font-['Inter',sans-serif]">
      {/* Background with vignette */}
      <div className="absolute inset-0">
        {/* Subtle gradient orbs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-white/[0.02] rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-white/[0.015] rounded-full blur-3xl" />

        {/* Vignette effect */}
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse 60% 60% at 50% 50%, transparent 0%, #08080a 100%)',
          }}
        />
      </div>

      {/* Password gate card */}
      <div
        className={`relative z-10 w-full max-w-md px-4 transition-all duration-1000 ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}
      >
        <form onSubmit={handleSubmit} className={`transition-transform ${shake ? 'animate-shake' : ''}`}>
          {/* Badge */}
          <div className="flex justify-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.04] border border-white/[0.08]">
              <div className="w-1.5 h-1.5 rounded-full bg-white/30" />
              <span className="text-sm text-white/70 font-medium">
                Protected Access
              </span>
            </div>
          </div>

          {/* Title */}
          <h1 className="text-center font-semibold tracking-[-0.03em] text-white leading-[1.1] mb-3 text-4xl">
            Xeno Studio
          </h1>
          <p className="text-center text-white/45 leading-[1.6] mb-10 text-base">
            Enter password to continue
          </p>

          {/* Password input */}
          <div className="relative mb-6">
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className={`w-full bg-white/[0.04] border ${error ? 'border-red-400/30' : 'border-white/[0.08]'} rounded-xl px-4 py-4 text-white/90 text-base placeholder:text-white/30 outline-none focus:border-white/20 focus:bg-white/[0.06] transition-all`}
                autoFocus
              />

              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
              >
                {showPassword ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>

            {error && (
              <p className="text-red-400/70 text-sm mt-3 ml-1">
                Incorrect password
              </p>
            )}
          </div>

          {/* Submit button */}
          <button
            type="submit"
            className="w-full bg-white text-[#08080a] hover:bg-white/90 font-medium py-4 rounded-xl transition-all text-base"
          >
            Continue
          </button>

          {/* Footer text */}
          <p className="text-center text-white/30 text-sm mt-8">
            The AI-native creative studio
          </p>
        </form>
      </div>

      {/* Shake animation CSS */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-10px); }
          20%, 40%, 60%, 80% { transform: translateX(10px); }
        }
        .animate-shake {
          animation: shake 0.82s cubic-bezier(.36,.07,.19,.97) both;
        }
      `}</style>
    </div>
  );
};

// Public routes that bypass the site gate (no password required)
const PUBLIC_ROUTES = ['/privacy', '/terms'];

export const SiteGateWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isUnlocked } = useSiteGate();
  const location = useLocation();

  // Check if current path is a public route that should bypass the gate
  const isPublicRoute = PUBLIC_ROUTES.some(route =>
    location.pathname === route || location.pathname.startsWith(route + '/')
  );

  // Allow access if unlocked OR if it's a public route
  return (isUnlocked || isPublicRoute) ? <>{children}</> : <SiteGate />;
};

export default SiteGate;
