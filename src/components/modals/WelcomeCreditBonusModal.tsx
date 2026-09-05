import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { ArrowRight, Check, Folder, MessageSquare, Search, Sparkles, WandSparkles } from '../../lib/icons';
import {
  ONBOARDING_DONE_KEY,
  ONBOARDING_WELCOME_DONE_KEY,
  isAllowedOnboardingNext,
  isExternalOnboardingNext,
} from '../../lib/onboardingHandoff.js';
import { authService } from '../../services/authService';
import './welcome-credit-bonus.css';

const quickStarts = [
  { title: 'Ask XENO', description: 'Start a grounded conversation with your workspace in context.', path: '/overview/chat/llm', icon: MessageSquare },
  { title: 'Create an image', description: 'Move from a prompt to an editable visual workspace.', path: '/overview/generation/image', icon: WandSparkles },
  { title: 'Open projects', description: 'Continue persisted work owned by your active workspace.', path: '/overview/projects', icon: Folder },
];

type CreditState = 'checking' | 'granting' | 'ready' | 'unavailable';

const WelcomeCreditBonusModal: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, refreshUser } = useAuth();
  const startedRef = useRef(false);
  const [creditState, setCreditState] = useState<CreditState>('checking');
  const [credits, setCredits] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const isPreview = import.meta.env.DEV && params.get('preview') === '1';
  const requestedNext = params.get('next');
  const destination = isAllowedOnboardingNext(requestedNext) && !isExternalOnboardingNext(requestedNext)
    ? requestedNext
    : '/overview';
  const firstName = user?.display_name?.trim().split(/\s+/)[0] || user?.username || '';

  const provisionWelcome = async () => {
    setCreditState('granting');
    setError(null);
    const result = await authService.claimBonusCredits();
    if (!result.success) {
      setCreditState('unavailable');
      setError(result.error || 'Your welcome credits could not be confirmed. You can retry without losing your place.');
      return;
    }
    setCredits(result.credits ?? null);
    setCreditState('ready');
    await refreshUser();
    window.dispatchEvent(new CustomEvent('xeno:credits-updated'));
  };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (isPreview) {
      setCredits(user?.credits ?? 1000);
      setCreditState('ready');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/auth/onboarding');
        const data = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok || data?.degraded) {
          setCreditState('unavailable');
          setError('Your account is ready, but welcome-credit status is temporarily unavailable.');
          return;
        }
        if (!data?.done) {
          navigate('/onboarding', { replace: true });
          return;
        }
        sessionStorage.setItem(ONBOARDING_DONE_KEY, '1');
        if (data?.welcomeAcknowledged) {
          sessionStorage.setItem(ONBOARDING_WELCOME_DONE_KEY, '1');
          navigate(destination, { replace: true });
          return;
        }
        await provisionWelcome();
      } catch {
        if (!cancelled) {
          setCreditState('unavailable');
          setError('Your account is ready, but welcome-credit status is temporarily unavailable.');
        }
      }
    })();
    return () => { cancelled = true; };
    // Entry transaction: run once. The server endpoint is also idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const continueTo = async (path: string) => {
    if (!isPreview) {
      try {
        const response = await fetch('/api/auth/onboarding/welcome/acknowledge', { method: 'POST' });
        if (response.ok) sessionStorage.setItem(ONBOARDING_WELCOME_DONE_KEY, '1');
      } catch {
        // A non-essential progress write must never trap the user.
      }
    }
    navigate(path, { replace: true });
  };

  const ready = creditState === 'ready';

  return (
    <main className="xeno-welcome" aria-labelledby="xeno-welcome-title" aria-describedby="xeno-welcome-description">
      <div className="xeno-welcome-main">
        <section className="xeno-welcome-intro">
        <span className="xeno-welcome-eyebrow">Your XENO workspace is ready</span>
        <h1 id="xeno-welcome-title">Welcome{firstName ? `, ${firstName}` : ''}.</h1>
        <p id="xeno-welcome-description">
          One account connects your projects, products, agents, and usage. Choose a real place to begin; you can reach everything else from the workspace.
        </p>

        <div className="xeno-welcome-launch-shell" aria-label="Choose where to begin">
          <div className="xeno-welcome-command" aria-label="Command palette shortcut">
            <Search size={17} />
            <div><strong>Find anything from one place</strong><span>Pages, projects, settings, and actions</span></div>
            <kbd>Ctrl K</kbd>
          </div>

          <div className="xeno-welcome-starts">
            {quickStarts.map((item) => {
              const Icon = item.icon;
              return (
                <button key={item.path} type="button" onClick={() => void continueTo(item.path)}>
                  <span className="xeno-welcome-start-icon"><Icon size={18} /></span>
                  <span><strong>{item.title}</strong><small>{item.description}</small></span>
                  <ArrowRight size={16} />
                </button>
              );
            })}
          </div>
        </div>
        </section>

        <aside className="xeno-welcome-access" aria-label="Welcome credit status">
        <div className="xeno-welcome-access-shell">
          <div className="xeno-welcome-access-copy">
            <span className="xeno-welcome-eyebrow">Included with your account</span>
            <h2>{ready ? 'Your welcome credits are ready' : 'Preparing your welcome credits'}</h2>
            <p>{ready
              ? 'The confirmed balance below comes from your account ledger and is available to metered XENO cloud capabilities.'
              : 'We automatically add the one-time welcome grant after onboarding. No card or checkout is required.'}</p>
          </div>

          <div className={`xeno-welcome-balance ${ready ? 'is-claimed' : ''}`} aria-live="polite">
            <div>
              <Sparkles size={18} />
              <span>Account balance</span>
              {ready && <span className="xeno-welcome-claimed"><Check size={12} /> Confirmed</span>}
            </div>
            <strong>{ready ? (credits ?? 1000).toLocaleString() : '—'}</strong>
            <small>{creditState === 'granting' || creditState === 'checking' ? 'confirming with your account ledger…' : 'usage credits'}</small>
          </div>

          {error && <p className="xeno-welcome-error" role="alert">{error}</p>}

          <dl className="xeno-welcome-facts">
            <div><dt>Account</dt><dd>No card is required for the welcome grant</dd></div>
            <div><dt>Balance</dt><dd>Read from the canonical account ledger</dd></div>
            <div><dt>Control</dt><dd>You choose when paid usage or a plan begins</dd></div>
          </dl>

          <div className="xeno-welcome-primary-actions">
            {creditState === 'unavailable' && (
              <button type="button" onClick={() => void provisionWelcome()}>Retry credit confirmation</button>
            )}
            <button type="button" className="is-primary" onClick={() => void continueTo(destination)}>
              Enter workspace <ArrowRight size={16} />
            </button>
          </div>
        </div>
        </aside>
      </div>
    </main>
  );
};

export default WelcomeCreditBonusModal;
