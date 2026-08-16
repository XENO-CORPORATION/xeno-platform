import React, { useState, useEffect } from 'react';
import { ArrowLeft, KeyRound, Mail, User, Eye, EyeOff, Github, ArrowRight, ChevronDown, Check, X } from 'lucide-react';
import { Link, useNavigate, useLocation, useParams } from 'react-router-dom';
import AuthMark from '../components/auth/AuthMark';
import { useAuth } from '../contexts/AuthContext';
import { getAuthApp } from '../lib/authApps';

/** Same-origin path guard for returnUrl (open-redirect protection). */
function safeReturnUrl(raw: string | null): string | null {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : null;
}

const AuthContent = () => {
  const { app: appSlug } = useParams();
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  /**
   * Password rules, evaluated live.
   *
   * Shown only while the field is focused OR partly filled — a list of things
   * you have failed, displayed before you have typed anything, is a telling-off
   * for a crime not yet committed. It appears when it becomes relevant and
   * stays while there is progress to report.
   *
   * `letters` counts LENGTH, matching the copy ("Minimum 8 letters"). If the
   * label and the predicate disagree the list is worse than useless — it says
   * you failed a rule you passed.
   */
  const passwordRules = [
    { label: 'Minimum 8 letters', met: password.length >= 8 },
    { label: 'At least one number', met: /\d/.test(password) },
    { label: 'At least one special character', met: /[^A-Za-z0-9]/.test(password) },
  ];
  const showPasswordRules = activeTab === 'signup' && (passwordFocused || password.length > 0);
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
        // A NEW account goes to activation, not into the workspace. It would
        // get there anyway — the first gated call 403s and the interceptor
        // redirects — but arriving at a half-working workspace and being
        // bounced out of it reads as a fault. Send them to the step that is
        // actually next.
        if (activeTab === 'signup') {
          navigate('/auth/activate', { replace: true });
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
        className={`flex items-center justify-between gap-4 px-4 py-3 sm:px-5 sm:py-4 transition-all duration-500 ease-out ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
        }`}
        style={{ transitionDelay: '0.1s' }}
      >


        <Link
          to="/"
          className="flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 transition-all duration-300 hover:gap-2"
        >
          <ArrowLeft size={14} className="transition-transform duration-300 group-hover:-translate-x-1" />
          <span>Back to home</span>
        </Link>

        <AuthMark />

      </header>

      {/* justify-center: the block sits in the MIDDLE of the viewport rather
          than starting under the header. min-h-0 so it can still shrink and
          scroll on a short window instead of being clipped by the shell's
          overflow-hidden. */}
      <div className="flex-1 min-h-0 flex flex-col justify-center px-6 pb-6 lg:px-12 xl:px-20 pt-6">
        <div
          className={`w-full max-w-[400px] mx-auto transition-all duration-700 ease-out ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
          style={{ transitionDelay: '0.15s' }}
        >
          {/* CLI/Hub session finalize status */}
          {cliStatus && (
            <div className="mb-4 rounded-[4px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-sm text-white/70">
              {cliStatus === 'authorizing' ? 'Authorizing — returning you to the app…' : cliStatus}
            </div>
          )}

          {/* Welcome Text with animation */}
          <div
            className={`mb-8 transition-all duration-500 ease-out ${
              tabTransition ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'
            }`}
          >
            <h2 className="text-3xl font-bold tracking-tight mb-2 text-center">
              {activeTab === 'signin' ? 'Welcome back' : 'Get started'}
            </h2>
            {/*
              "You are signing into ___" REPLACES the generic subtitle rather
              than adding a line, and sits here rather than in a corner or under
              the legal text, because it is a CONSENT signal: you must know what
              you are authorising BEFORE you type credentials, not after you
              have pressed the button. Under the terms line it would be the last
              thing read, below the submit — which is the wrong order for the
              one fact that protects against authorising the wrong client.

              It also costs nothing: "Enter your credentials to access your
              account" is filler, and the app name is real information.

              Monochrome — DESIGN_SYSTEM.md §2 is white-alpha only, and the
              registry's per-app accent is retired hue.
            */}
            <p className="text-white/40 text-center">
              {authApp ? (
                <>
                  You are signing into{' '}
                  {authApp.productPath ? (
                    <a
                      href={authApp.productPath}
                      // New tab: navigating away mid-flow would discard the
                      // sign-in the person came here to finish.
                      target="_blank"
                      rel="noopener noreferrer"
                      // Same weight as the sentence around it, no underline —
                      // the app name is part of the line, not a call to action.
                      // Hover lifts the colour only; the cursor already says it
                      // is clickable, and a rule under it would make a consent
                      // sentence read like a form field.
                      className="text-white/40 hover:text-white transition-colors duration-300"
                    >
                      {authApp.displayName}
                    </a>
                  ) : (
                    <span>{authApp.displayName}</span>
                  )}
                </>
              ) : activeTab === 'signin'
                ? 'Enter your credentials to access your account'
                : 'Create your account and start creating'}
            </p>
          </div>

          {/* Tabs with smooth indicator */}
          <div
            className={`flex gap-1 p-1 mb-8 rounded-[6px] bg-white/[0.04] border border-white/[0.06] transition-all duration-500 ease-out ${
              isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
            }`}
            style={{ transitionDelay: '0.2s' }}
          >
            <button
              className={`flex-1 py-2.5 text-sm font-medium rounded-[4px] transition-all duration-300 ease-out ${
                activeTab === 'signin'
                  ? 'bg-white text-black shadow-lg scale-[1.02]'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/[0.02]'
              }`}
              onClick={() => handleTabChange('signin')}
            >
              Sign In
            </button>
            <button
              className={`flex-1 py-2.5 text-sm font-medium rounded-[4px] transition-all duration-300 ease-out ${
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
                className={`flex items-center justify-center py-3 rounded-[6px] border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.08] hover:border-white/[0.15] hover:scale-105 active:scale-95 transition-all duration-300 ease-out group ${
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

          {/*
            The divider is now a DISCLOSURE.

            Email/password starts collapsed because it is the minority path —
            most people here use a provider — and a form that is open before it
            is wanted is four fields of visual weight above the button almost
            everyone actually presses. xAI does the same thing with "Login with
            email"; ElevenLabs keeps its form open, but it only offers three
            providers and no tabs, so it has room this page does not.

            It stays a real button with aria-expanded rather than a styled span,
            so it is reachable by keyboard and announced as what it is.
          */}
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
              <button
                type="button"
                onClick={() => setShowEmailForm((v) => !v)}
                aria-expanded={showEmailForm}
                aria-controls="email-auth-form"
                className="group flex items-center gap-1.5 px-4 text-xs uppercase tracking-wider bg-[#000000] text-white/30 hover:text-white/60 transition-colors duration-300 cursor-pointer"
              >
                {showEmailForm ? 'hide email sign-in' : 'or continue with email'}
                <ChevronDown
                  size={13}
                  className={`transition-transform duration-300 ${showEmailForm ? 'rotate-180' : ''}`}
                />
              </button>
            </div>
          </div>

          {/*
            grid-rows 0fr -> 1fr animates to height:auto without a magic
            max-height. A max-height guess either clips a taller state (the
            sign-up tab has an extra field) or leaves dead easing time on a
            shorter one.
          */}
          <div
            id="email-auth-form"
            className={`grid transition-all duration-500 ease-out ${
              showEmailForm ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
            }`}
          >
            <div className="overflow-hidden">
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
                    className="w-full pl-11 pr-4 py-3.5 bg-white/[0.04] border border-white/[0.08] rounded-[6px] text-white placeholder-white/30 focus:outline-none focus:border-white/20 focus:bg-white/[0.06] transition-colors duration-150 hover:border-white/15"
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
                  } rounded-[6px] text-white placeholder-white/30 focus:outline-none focus:bg-white/[0.06] transition-colors duration-150 hover:border-white/15`}
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
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                  required
                  className={`w-full pl-11 pr-12 py-3.5 bg-white/[0.04] border ${
                    passwordError ? 'border-red-500/50 focus:border-red-500/70' : 'border-white/[0.08] focus:border-white/20'
                  } rounded-[6px] text-white placeholder-white/30 focus:outline-none focus:bg-white/[0.06] transition-colors duration-150 hover:border-white/15`}
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

              {/*
                grid-rows 0fr -> 1fr so the block animates to its real height
                and the form LIFTS as it opens, rather than jumping by a
                hard-coded max-height that would clip when a rule wraps to two
                lines on a narrow screen.

                Each row carries its own transitionDelay, so they arrive one
                after another instead of as a single slab. 60ms apart is enough
                to read as sequential without feeling slow.
              */}
              <div
                className={`grid transition-all duration-300 ease-out ${
                  showPasswordRules ? 'grid-rows-[1fr] opacity-100 mt-3' : 'grid-rows-[0fr] opacity-0 mt-0'
                }`}
                aria-live="polite"
              >
                <div className="overflow-hidden space-y-1.5">
                  {passwordRules.map((rule, i) => (
                    <div
                      key={rule.label}
                      className={`flex items-center gap-2 text-[12.5px] transition-all duration-300 ease-out ${
                        showPasswordRules ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1'
                      } ${rule.met ? 'text-[#3fb26b]' : 'text-white/35'}`}
                      style={{ transitionDelay: showPasswordRules ? `${i * 60}ms` : '0ms' }}
                    >
                      {/* Semantic colour only — DESIGN_SYSTEM.md §2 permits it
                          for meaning, and "this rule is satisfied" is meaning.
                          The ICON changes too, so the state does not rely on
                          colour alone. */}
                      {rule.met ? <Check size={13} className="shrink-0" /> : <X size={13} className="shrink-0" />}
                      <span>{rule.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className={`overflow-hidden transition-all duration-300 ease-out ${passwordError ? 'max-h-8 opacity-100 mt-2' : 'max-h-0 opacity-0'}`}>
                <p className="text-sm text-red-400">{passwordError}</p>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className={`group w-full mt-6 py-4 bg-white text-black text-sm font-semibold rounded-[6px] flex items-center justify-center gap-0 transition-all duration-300 ease-out hover:bg-white/90 hover:shadow-lg hover:shadow-white/10 active:scale-[0.98] overflow-hidden ${
                isSubmitting ? 'opacity-50 cursor-not-allowed' : ''
              } ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
              style={{ transitionDelay: '0.6s' }}
            >
              {isSubmitting ? (
                <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-[3px] animate-spin" />
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
            </div>
          </div>

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
