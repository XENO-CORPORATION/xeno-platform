import React, { useState, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { CredentialForm, SocialSignIn, EmailDisclosure } from '@xenosystem/components/auth';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import AuthMark from '../components/auth/AuthMark';
import { useAuth } from '../contexts/AuthContext';
import { getAuthApp } from '../lib/authApps';
import {
  authClientId,
  authPath,
  authReturnUrl,
  locationReturnPath,
  type AuthMode,
} from '../lib/authRouting.js';
import { stashReturnUrl, consumeReturnUrl } from '../lib/onboardingHandoff.js';

const AuthContent: React.FC<{ mode?: AuthMode }> = ({ mode = 'signin' }) => {
  const [showEmailForm, setShowEmailForm] = useState(false);

  const [activeTab, setActiveTab] = useState<AuthMode>(mode);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isVisible, setIsVisible] = useState(false);

  /* These MUST stay below the useState block above.
   *
   * They were originally written at the top of the component, reading
   * `password` and `activeTab` about ten lines BEFORE those states are
   * declared. `const` is hoisted but not initialised, so that is a temporal
   * dead zone error -- ReferenceError: Cannot access 'password' before
   * initialization -- thrown on EVERY render of the sign-in page.
   *
   * It survived because the only "typecheck" available in this worktree was
   * `npx tsc` resolving to a squatter package that prints a banner and exits
   * 0, and vite strips types without checking them. The build stayed green
   * over a page that could not render.
   */
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
  const [tabTransition, setTabTransition] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { login, register, user } = useAuth();
  const returnUrl = authReturnUrl(location.search);
  const clientId = authClientId(location.search);
  const fallbackAuthApp = getAuthApp(clientId ?? undefined);
  const [registeredClientName, setRegisteredClientName] = useState<string | null>(null);
  const authApp = registeredClientName
    ? { displayName: registeredClientName, productPath: fallbackAuthApp?.productPath }
    : fallbackAuthApp;

  // Unified-auth CLI/Hub browser-session mode: /auth/cli?session=… hands the
  // signed-in user back to the local app by completing the cli-auth session.
  const cliSession = new URLSearchParams(location.search).get('session');
  const [cliStatus, setCliStatus] = useState('');
  const finalizeCli = async () => {
    if (!cliSession || !user || cliStatus === 'authorizing') return;
    setCliStatus('authorizing');
    try {
      const r = await fetch('/api/auth/cli/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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

  useEffect(() => {
    setActiveTab(mode);
  }, [mode]);

  useEffect(() => {
    const canonical = authPath(mode, location.search);
    if (`${location.pathname}${location.search}` !== canonical) {
      navigate(canonical, { replace: true, state: location.state });
    }
  }, [location.pathname, location.search, location.state, mode, navigate]);

  // The registered OIDC client is the source of truth for the consent label.
  // Static presentation is only a loading/legacy fallback, never authority.
  useEffect(() => {
    setRegisteredClientName(null);
    if (!clientId) return;
    const controller = new AbortController();
    fetch(`/api/oauth2/client_info?client_id=${encodeURIComponent(clientId)}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => {
        if (data?.client_id === clientId && typeof data?.name === 'string') {
          setRegisteredClientName(data.name);
        }
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') setRegisteredClientName(null);
      });
    return () => controller.abort();
  }, [clientId]);

  // Already signed in (or auth just landed via social ?token, which AuthContext
  // stores) with a CLI session waiting → auto-complete (first-party). Depends on
  // `user` so it re-fires once the social/restored session resolves, not just on
  // mount (finalizeCli is idempotent via its 'authorizing' guard).
  useEffect(() => {
    if (cliSession && user) finalizeCli();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Smooth tab transition
  const handleTabChange = (tab: 'signin' | 'signup') => {
    if (tab === activeTab) return;
    setTabTransition(true);
    setTimeout(() => {
      setActiveTab(tab);
      navigate(authPath(tab, location.search), { state: location.state });
      setTimeout(() => setTabTransition(false), 50);
    }, 150);
  };

  const validateEmail = (email: string): boolean => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  };

  const submit = () => handleSubmit();
  const startSocial = (provider: 'google' | 'github' | 'x') => {
    const socialReturnUrl = returnUrl
      || (cliSession ? location.pathname + location.search : null)
      || locationReturnPath((location.state as any)?.from, '/overview');
    // the API's slug for X is still `twitter`
    const slug = provider === 'x' ? 'twitter' : provider;
    window.location.href = `/api/auth/${slug}?returnUrl=${encodeURIComponent(socialReturnUrl)}`;
  };
  const handleSubmit = async () => {
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
        // A NEW account always activates first. Jumping to returnUrl here
        // used to consume the OIDC grant, then the activation interceptor
        // dumped them on /auth/activate with nothing to resume.
        if (activeTab === 'signup') {
          if (returnUrl) stashReturnUrl(returnUrl);
          navigate('/auth/activate', { replace: true });
          return;
        }
        if (returnUrl) {
          consumeReturnUrl();
          window.location.href = returnUrl;
          return;
        }
        const from = locationReturnPath((location.state as any)?.from, '/overview');
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
      {/* ── The form is @xenosystem/components/auth (0.3.0) — ONE design for the origin page and every product's door.
          Improve it in xeno-components (seen in xeno-workshop, every state, behind the screenshot gate); this page owns
          only the logic: routing, the cli-auth session, activation, the registered client name. Layout classes here are
          page layout, not chrome. ── */}
      <div className="flex-1 min-h-0 flex flex-col justify-center px-6 pb-6 lg:px-12 xl:px-20 pt-6">
        <div
          className={`w-full max-w-[400px] mx-auto transition-all duration-700 ease-out ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
        >
          {cliStatus && (
            <p className="mb-6 text-sm text-white/60" role="status">
              {cliStatus === 'authorizing' ? 'Authorizing — returning you to the app…' : cliStatus}
            </p>
          )}
          <CredentialForm
            mode={activeTab}
            onModeChange={handleTabChange}
            values={{ name, email, password }}
            onChange={(v) => { setName(v.name); setEmail(v.email); setPassword(v.password); }}
            errors={{ email: emailError || undefined, password: passwordError || undefined }}
            submitting={isSubmitting}
            onSubmit={submit}
            open={showEmailForm}
            id="email-auth-form"
            title={activeTab === 'signin' ? 'Welcome back' : 'Get started'}
            body={
              authApp ? (
                /* A CONSENT signal: which client you are authorising, BEFORE you type a credential. */
                <>
                  You are signing into{' '}
                  {authApp.productPath ? (
                    <a href={authApp.productPath} target="_blank" rel="noopener noreferrer" className="text-white underline underline-offset-2">
                      {authApp.displayName}
                    </a>
                  ) : (
                    <span className="text-white">{authApp.displayName}</span>
                  )}
                </>
              ) : activeTab === 'signin' ? 'Enter your credentials to access your account' : 'Create your account and start creating'
            }
            before={
              <>
                <SocialSignIn onSelect={startSocial} disabled={isSubmitting} />
                <EmailDisclosure open={showEmailForm} onToggle={() => setShowEmailForm((v) => !v)} controls="email-auth-form" />
              </>
            }
            passwordRules={activeTab === 'signup' ? passwordRules : undefined}
            passwordAside={activeTab === 'signin' ? <Link to="/forgot-password">Forgot?</Link> : undefined}
            after={
              <>
                By continuing, you agree to our{' '}
                <Link to="/terms" className="text-white/50 hover:text-white transition-colors duration-300 underline underline-offset-2">Terms</Link>{' '}
                and{' '}
                <Link to="/privacy" className="text-white/50 hover:text-white transition-colors duration-300 underline underline-offset-2">Privacy Policy</Link>
              </>
            }
          />
        </div>
      </div>
    </>
  );
};

export default AuthContent;
