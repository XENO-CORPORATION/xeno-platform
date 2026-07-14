import React, { useState, useEffect } from 'react';
import { ArrowLeft, KeyRound, Mail, User, Eye, EyeOff, Github, ArrowRight } from 'lucide-react';
import { Link, useNavigate, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getAuthApp } from '../lib/authApps';

/** Same-origin path guard for returnUrl (open-redirect protection). */
function safeReturnUrl(raw: string | null): string | null {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : null;
}

const AuthContent = () => {
  const { app: appSlug } = useParams();
  const authApp = getAuthApp(appSlug);
  const [activeTab, setActiveTab] = useState<'signin' | 'signup'>('signin');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const [tabTransition, setTabTransition] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { login, register, user } = useAuth();

  // Unified-auth CLI/Hub browser-session mode: /auth/cli?session=… hands the
  // signed-in user back to the local app by completing the cli-auth session.
  const cliSession = new URLSearchParams(location.search).get('session');
  const [cliStatus, setCliStatus] = useState('');
  const finalizeCli = async () => {
    const tok = localStorage.getItem('xenoos_auth_token');
    if (!cliSession || !tok || cliStatus === 'authorizing') return;
    setCliStatus('authorizing');
    try {
      const r = await fetch('/api/auth/cli/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
        body: JSON.stringify({ session_id: cliSession }),
      });
      const d = await r.json();
      if (r.ok && d.redirect_uri) { window.location.href = d.redirect_uri; return; }
      setCliStatus((d && d.error) || 'Authorization failed — please try again.');
    } catch {
      setCliStatus('Network error — please try again.');
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // Already signed in (or auth just landed via social ?token, which AuthContext
  // stores) with a CLI session waiting → auto-complete (first-party). Depends on
  // `user` so it re-fires once the social/restored session resolves, not just on
  // mount (finalizeCli is idempotent via its 'authorizing' guard).
  useEffect(() => {
    if (cliSession && (user || localStorage.getItem('xenoos_auth_token'))) finalizeCli();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Smooth tab transition
  const handleTabChange = (tab: 'signin' | 'signup') => {
    if (tab === activeTab) return;
    setTabTransition(true);
    setTimeout(() => {
      setActiveTab(tab);
      setTimeout(() => setTabTransition(false), 50);
    }, 150);
  };

  const validateEmail = (email: string): boolean => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setEmailError('');
    setPasswordError('');
    let isValid = true;

    if (!validateEmail(email)) {
      setEmailError('Please enter a valid email address');
      isValid = false;
    }
    if (password.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      isValid = false;
    }

    if (activeTab === 'signup' && !name.trim()) {
      setEmailError('Please enter your full name');
      isValid = false;
    }

    if (!isValid) return;

    setIsSubmitting(true);

    try {
      let result;

      if (activeTab === 'signin') {
        result = await login(email, password);
      } else {
        result = await register({
          username: email.split('@')[0],
          email,
          password,
          display_name: name
        });
      }

      if (result.success) {
        // CLI/Hub browser-session: complete the cli-auth session → app callback.
        if (cliSession) { finalizeCli(); return; }
        // Unified-auth finalize: if we arrived with a returnUrl (the OIDC
        // /api/oauth2/authorize page, or a cli-auth handoff), send the user
        // straight back there instead of the dashboard — a full-page load so
        // the backend authorize route continues the grant.
        const returnUrl = safeReturnUrl(new URLSearchParams(location.search).get('returnUrl'));
        if (returnUrl) {
          window.location.href = returnUrl;
          return;
        }
        const from = (location.state as any)?.from?.pathname || '/overview';
        navigate(from, { replace: true });
      } else {
        if (activeTab === 'signin') {
          setPasswordError(result.error || 'Login failed');
        } else {
          setEmailError(result.error || 'Registration failed');
        }
      }
    } catch (error) {
      console.error('Authentication error:', error);
      setEmailError('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      {/* Header with staggered animation */}
      <header
        className={`flex items-center justify-between p-6 lg:px-12 xl:px-20 lg:pt-12 xl:pt-16 transition-all duration-500 ease-out ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
        }`}
        style={{ transitionDelay: '0.1s' }}
      >
        <Link to="/" className="lg:hidden flex items-center gap-2 group">
          <img src="/logo.svg" alt="Xeno" className="w-8 h-8 invert transition-transform duration-300 group-hover:scale-105" />
          <span className="text-lg font-semibold transition-opacity duration-300 group-hover:opacity-80">Xeno</span>
        </Link>

        <div className="hidden lg:block" />

        <Link
          to="/"
          className="flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 transition-all duration-300 hover:gap-2"
        >
          <ArrowLeft size={14} className="transition-transform duration-300 group-hover:-translate-x-1" />
          <span>Back to home</span>
        </Link>
      </header>

      <div className="flex-1 flex flex-col px-6 pb-12 lg:px-12 xl:px-20 pt-20 lg:pt-20 xl:pt-28">
        <div
          className={`w-full max-w-[400px] mx-auto transition-all duration-700 ease-out ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
          style={{ transitionDelay: '0.15s' }}
        >
          {/* CLI/Hub session finalize status */}
          {cliStatus && (
            <div className="mb-4 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-sm text-white/70">
              {cliStatus === 'authorizing' ? 'Authorizing — returning you to the app…' : cliStatus}
            </div>
          )}

          {/* Per-app authorize banner (unified /auth/:app surface) */}
          {authApp && (
            <div className="mb-6 flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
              <span
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-sm font-bold"
                style={{ backgroundColor: `${authApp.accent}22`, color: authApp.accent }}
              >
                {authApp.displayName.replace(/^XENO\s+/, '').charAt(0)}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-tight">Authorize {authApp.displayName}</div>
                <div className="truncate text-xs text-white/40">{authApp.tagline}</div>
              </div>
            </div>
          )}

          {/* Welcome Text with animation */}
          <div
            className={`mb-8 transition-all duration-500 ease-out ${
              tabTransition ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'
            }`}
          >
            <h2 className="text-3xl font-bold tracking-tight mb-2">
              {activeTab === 'signin' ? 'Welcome back' : 'Get started'}
            </h2>
            <p className="text-white/40">
              {activeTab === 'signin'
                ? 'Enter your credentials to access your account'
                : 'Create your account and start creating'}
            </p>
          </div>

          {/* Tabs with smooth indicator */}
          <div
            className={`flex gap-1 p-1 mb-8 rounded-xl bg-white/[0.04] border border-white/[0.06] transition-all duration-500 ease-out ${
              isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
            }`}
            style={{ transitionDelay: '0.2s' }}
          >
            <button
              className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all duration-300 ease-out ${
                activeTab === 'signin'
                  ? 'bg-white text-black shadow-lg scale-[1.02]'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/[0.02]'
              }`}
              onClick={() => handleTabChange('signin')}
            >
              Sign In
            </button>
            <button
              className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all duration-300 ease-out ${
                activeTab === 'signup'
                  ? 'bg-white text-black shadow-lg scale-[1.02]'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/[0.02]'
              }`}
              onClick={() => handleTabChange('signup')}
            >
              Sign Up
            </button>
          </div>

          {/* Social Buttons with stagger */}
          <div
            className={`grid grid-cols-3 gap-3 mb-6 transition-all duration-500 ease-out ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
            style={{ transitionDelay: '0.25s' }}
          >
            {[
              { icon: 'google', delay: '0.3s', provider: 'google' },
              { icon: 'github', delay: '0.35s', provider: 'github' },
              { icon: 'twitter', delay: '0.4s', provider: 'twitter' }
            ].map((social, index) => (
              <button
                key={social.icon}
                type="button"
                onClick={() => {
                  // Redirect to OAuth endpoint — carry the unified-auth returnUrl
                  // (OIDC authorize / cli handoff) through social sign-in too.
                  const returnUrl = safeReturnUrl(new URLSearchParams(location.search).get('returnUrl'))
                    || (cliSession ? location.pathname + location.search : null)
                    || (location.state as any)?.from?.pathname || '/overview';
                  window.location.href = `/api/auth/${social.provider}?returnUrl=${encodeURIComponent(returnUrl)}`;
                }}
                className={`flex items-center justify-center py-3 rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.08] hover:border-white/[0.15] hover:scale-105 active:scale-95 transition-all duration-300 ease-out group ${
                  isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                }`}
                style={{ transitionDelay: social.delay }}
              >
                {index === 0 && (
                  <svg className="w-5 h-5 opacity-70 group-hover:opacity-100 transition-all duration-300 group-hover:scale-110" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
                    <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z" />
                    <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z" />
                    <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z" />
                    <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z" />
                  </svg>
                )}
                {index === 1 && <Github className="w-5 h-5 text-white/70 group-hover:text-white transition-all duration-300 group-hover:scale-110" />}
                {index === 2 && (
                  <svg className="w-5 h-5 text-white/70 group-hover:text-white transition-all duration-300 group-hover:scale-110" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                )}
              </button>
            ))}
          </div>

          {/* Divider */}
          <div
            className={`relative my-6 transition-all duration-500 ease-out ${
              isVisible ? 'opacity-100' : 'opacity-0'
            }`}
            style={{ transitionDelay: '0.45s' }}
          >
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/[0.08]" />
            </div>
            <div className="relative flex justify-center">
              <span className="px-4 text-xs text-white/30 bg-[#0a0a0c] uppercase tracking-wider">
                or continue with email
              </span>
            </div>
          </div>

          {/* Form with animated fields */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Full Name - with smooth transition */}
            <div className={`transition-all duration-400 ease-out overflow-hidden ${
              activeTab === 'signup' ? 'max-h-24 opacity-100' : 'max-h-0 opacity-0'
            }`}>
              <div className="pb-4">
                <label className="block text-sm font-medium text-white/60 mb-2">
                  Full Name
                </label>
                <div className="relative group">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none transition-all duration-300 group-focus-within:text-white/50">
                    <User size={18} className="text-white/30 transition-colors duration-300" />
                  </div>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full pl-11 pr-4 py-3.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-white/20 focus:bg-white/[0.06] transition-all duration-300 hover:border-white/15"
                    placeholder="John Doe"
                  />
                </div>
              </div>
            </div>

            {/* Email Field */}
            <div
              className={`transition-all duration-500 ease-out ${
                isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              }`}
              style={{ transitionDelay: '0.5s' }}
            >
              <label className="block text-sm font-medium text-white/60 mb-2">
                Email
              </label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Mail size={18} className="text-white/30 transition-colors duration-300 group-focus-within:text-white/50" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className={`w-full pl-11 pr-4 py-3.5 bg-white/[0.04] border ${
                    emailError ? 'border-red-500/50 focus:border-red-500/70' : 'border-white/[0.08] focus:border-white/20'
                  } rounded-xl text-white placeholder-white/30 focus:outline-none focus:bg-white/[0.06] transition-all duration-300 hover:border-white/15`}
                  placeholder="you@example.com"
                />
              </div>
              <div className={`overflow-hidden transition-all duration-300 ease-out ${emailError ? 'max-h-8 opacity-100 mt-2' : 'max-h-0 opacity-0'}`}>
                <p className="text-sm text-red-400">{emailError}</p>
              </div>
            </div>

            {/* Password Field */}
            <div
              className={`transition-all duration-500 ease-out ${
                isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              }`}
              style={{ transitionDelay: '0.55s' }}
            >
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-white/60">
                  Password
                </label>
                {activeTab === 'signin' && (
                  <Link
                    to="/forgot-password"
                    className="text-sm text-white/40 hover:text-white transition-colors duration-300"
                  >
                    Forgot?
                  </Link>
                )}
              </div>
              <div className="relative group">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <KeyRound size={18} className="text-white/30 transition-colors duration-300 group-focus-within:text-white/50" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className={`w-full pl-11 pr-12 py-3.5 bg-white/[0.04] border ${
                    passwordError ? 'border-red-500/50 focus:border-red-500/70' : 'border-white/[0.08] focus:border-white/20'
                  } rounded-xl text-white placeholder-white/30 focus:outline-none focus:bg-white/[0.06] transition-all duration-300 hover:border-white/15`}
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-4 flex items-center"
                >
                  <div className="transition-all duration-300 hover:scale-110">
                    {showPassword ? (
                      <EyeOff size={18} className="text-white/30 hover:text-white/60 transition-colors duration-300" />
                    ) : (
                      <Eye size={18} className="text-white/30 hover:text-white/60 transition-colors duration-300" />
                    )}
                  </div>
                </button>
              </div>
              <div className={`overflow-hidden transition-all duration-300 ease-out ${passwordError ? 'max-h-8 opacity-100 mt-2' : 'max-h-0 opacity-0'}`}>
                <p className="text-sm text-red-400">{passwordError}</p>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className={`group w-full mt-6 py-4 bg-white text-black text-sm font-semibold rounded-xl flex items-center justify-center gap-0 transition-all duration-300 ease-out hover:bg-white/90 hover:shadow-lg hover:shadow-white/10 active:scale-[0.98] overflow-hidden ${
                isSubmitting ? 'opacity-50 cursor-not-allowed' : ''
              } ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
              style={{ transitionDelay: '0.6s' }}
            >
              {isSubmitting ? (
                <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
              ) : (
                <>
                  <span className="transition-transform duration-300 group-hover:-translate-x-1">{activeTab === 'signin' ? 'Sign In' : 'Create Account'}</span>
                  <ArrowRight
                    size={16}
                    strokeWidth={2.5}
                    className="opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-2 transition-all duration-300 ease-out"
                  />
                </>
              )}
            </button>
          </form>

          {/* Terms */}
          <p
            className={`text-center text-xs text-white/30 mt-8 leading-relaxed transition-all duration-500 ease-out ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
            style={{ transitionDelay: '0.65s' }}
          >
            By continuing, you agree to our{' '}
            <Link to="/terms" className="text-white/50 hover:text-white transition-colors duration-300 underline underline-offset-2">
              Terms
            </Link>{' '}
            and{' '}
            <Link to="/privacy" className="text-white/50 hover:text-white transition-colors duration-300 underline underline-offset-2">
              Privacy Policy
            </Link>
          </p>
        </div>
      </div>
    </>
  );
};

export default AuthContent;
