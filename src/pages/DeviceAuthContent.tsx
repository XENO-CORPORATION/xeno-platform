import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { DeviceApproval, DeviceCodeForm, formatUserCode, userCodeOf, type DeviceApprovalStatus, type DeviceCodeStatus } from '@xenosystem/components/auth';
import AuthMark from '../components/auth/AuthMark';
import { ArrowLeft } from 'lucide-react';
import { getAuthApp } from '../lib/authApps';
import { authPath } from '../lib/authRouting.js';
import { useAuth } from '../contexts/AuthContext';

/* ──────────────────────────────────────────────────────────────────────
 * /device is the RFC 8628 verification URI (/activate is its old alias).
 * /auth/:app/device remains a compatibility surface for the pre-OIDC CLI
 * device-code implementation.
 *
 * Two steps, both from `@xenosystem/components/auth`: DeviceCodeForm (the
 * code), then DeviceApproval (what is being let in: app, account, the code to
 * match, where and when the device asked, permissions — RFC 8628 §5.4). This
 * page owns the session redirect and the inspect/approve/deny (or legacy
 * verify) calls.
 * ────────────────────────────────────────────────────────────────────── */
/* What each scope lets the device do, in the words a person approving it needs. An unknown scope is
 * shown as its id rather than guessed at: describing access we did not define would be a false claim. */
const SCOPE_WORDS: Record<string, string> = {
  openid: 'Confirm who you are',
  profile: 'See your name',
  email: 'See your e-mail address',
  'inference:run': 'Run AI models on your account',
  'ledger:read': 'See your credit balance',
  'ledger:spend': 'Spend credits on what you approve',
  'projects:read': 'Read your projects',
  'projects:write': 'Create and change your projects',
  'tasks:read': 'Read your tasks',
  'tasks:write': 'Create and change your tasks',
  offline_access: 'Stay signed in until you sign out',
  // XENO workspace agent surface (approved 2026-10-20): what a workspace app may do, as on the consent screen
  'storage:read': 'See your files and folders',
  'storage:write': 'Make folders and upload files to your Storage',
  'share:create': 'Share a folder by a link that needs sign-in — never a public link',
  'library:read': 'See your Library', 'library:write': 'Add to your Library',
  'chat:read': 'Read your chats', 'chat:write': 'Write in your chats',
  'agents:read': 'See your agents and teams', 'agents:write': 'Change your agents and teams, and start or stop their runs',
  'wallet:read': 'See your credits and budgets', 'wallet:spend': 'Spend your credits — large spends ask you again',
  'workspace:read': 'See your workspaces and members', 'workspace:admin': 'Change workspace settings and members',
  'places:read': 'See your Places', 'places:write': 'Change Place layouts',
  'marketplace:read': 'See the Marketplace', 'marketplace:write': 'Change your Marketplace listings',
  'forum:read': 'Read the Forum', 'forum:write': 'Post in the Forum as your agent',
};

export function describeScopes(scopes: string[]): string[] {
  return scopes.map((scope) => SCOPE_WORDS[scope] ?? scope);
}

/** "Germany" for "DE"; the code itself when the runtime has no name for it. */
function countryName(code: string | null | undefined): string | undefined {
  if (!code) return undefined;
  try { return new Intl.DisplayNames(undefined, { type: 'region' }).of(code) ?? code; } catch { return code; }
}

/** "just now", "3 minutes ago" — the age of the request, from the provider's clock. */
function startedAgo(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes)) return undefined;
  return minutes < 1 ? 'just now' : minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
}

interface Inspected {
  client_name: string;
  scope: string[];
  unverified: boolean;
  request_country: string | null;
  viewer_country: string | null;
  requested_at: string | null;
}

const DeviceAuthContent: React.FC<{ protocol?: 'oidc' | 'legacy' }> = ({ protocol = 'oidc' }) => {
  const { app: appSlug } = useParams();
  const location = useLocation();
  const legacyAuthApp = getAuthApp(appSlug) ?? getAuthApp('cli')!;
  const initialCode = new URLSearchParams(location.search).get('code') || '';
  const [code, setCode] = useState(() => formatUserCode(initialCode));
  const [status, setStatus] = useState<'idle' | 'verifying' | 'connected' | string>('idle');
  const [authorization, setAuthorization] = useState<Inspected | null>(null);
  const [approval, setApproval] = useState<DeviceApprovalStatus>('review');
  const requestGeneration = useRef(0);
  const [isVisible, setIsVisible] = useState(false);

  const { isAuthenticated: authed, isLoading: authLoading, user, logout } = useAuth();
  const accountLabel = user?.email || user?.display_name || user?.username || 'your XENO account';

  useEffect(() => {
    const t = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(t);
  }, []);

  // Not signed in → hand off to the branded login, returning here once authed.
  useEffect(() => {
    if (!authLoading && !authed) {
      const here = `${location.pathname}${location.search}`;
      const clientHint = protocol === 'legacy' ? (appSlug ?? 'cli') : undefined;
      window.location.replace(authPath('signin', `?returnUrl=${encodeURIComponent(here)}`, clientHint));
    }
  }, [authed, authLoading, appSlug, location.pathname, location.search, protocol]);

  // Signing out sends the effect above to sign-in, which returns here with the code kept in the URL.
  const switchAccount = () => {
    const here = new URL(window.location.href);
    if (userCodeOf(code)) here.searchParams.set('code', code);
    window.history.replaceState(null, '', `${here.pathname}${here.search}`);
    logout();
  };

  const onCodeChange = (v: string) => {
    requestGeneration.current++;
    setCode(v);
    setAuthorization(null);
    if (status !== 'idle') setStatus('idle');
  };

  const errorText = (d: { error?: string; error_description?: string }) =>
    d.error === 'invalid_code' ? 'That code is invalid. Check it and try again.'
      : d.error === 'expired' ? 'That code has expired. Start again from your device.'
      : d.error === 'already_used' ? 'That code was already used.'
      : d.error_description === 'invalid or expired user_code' ? 'That code is invalid or expired. Start again from your device.'
      : (d.error || 'Verification failed — please try again.');

  /** Step 1: the code. OIDC only inspects it (nothing is granted yet); the legacy surface verifies directly. */
  const verify = async () => {
    if (status === 'verifying') return;
    if (!userCodeOf(code)) { setStatus('Enter the full 8-character code.'); return; }
    if (!authed) { setStatus('Your session expired — please reload.'); return; }
    setStatus('verifying');
    const generation = ++requestGeneration.current;
    try {
      const endpoint = protocol === 'oidc' ? '/api/oauth2/device/inspect' : '/api/auth/cli/device-code/verify';
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_code: code.toUpperCase() }),
      });
      const d = await r.json().catch(() => ({}));
      if (generation !== requestGeneration.current) return;
      if (protocol === 'oidc' && r.ok && d.client_id && d.client_name) {
        setAuthorization({
          client_name: d.client_name,
          scope: typeof d.scope === 'string' ? d.scope.split(/\s+/).filter(Boolean) : [],
          unverified: d.unverified === true,
          request_country: typeof d.request_country === 'string' ? d.request_country : null,
          viewer_country: typeof d.viewer_country === 'string' ? d.viewer_country : null,
          requested_at: typeof d.requested_at === 'string' ? d.requested_at : null,
        });
        setApproval('review');
        setStatus('idle');
        return;
      }
      if (r.ok && (d.status === 'ok' || d.ok === true)) { setStatus('connected'); return; }
      setStatus(errorText(d));
    } catch {
      if (generation === requestGeneration.current) setStatus('Network error — please try again.');
    }
  };

  /** Step 2: approve or decline exactly what step 1 showed. */
  const decide = async (approve: boolean) => {
    if (!authorization || approval === 'approving' || approval === 'declining') return;
    setApproval(approve ? 'approving' : 'declining');
    try {
      const r = await fetch(approve ? '/api/oauth2/device/approve' : '/api/oauth2/device/deny', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_code: code.toUpperCase() }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setApproval(approve ? 'approved' : 'declined'); return; }
      setApproval({ error: errorText(d) });
    } catch {
      setApproval({ error: 'Network error — please try again.' });
    }
  };

  if (authLoading || !authed) return null; // checking or redirecting

  const displayName = protocol === 'legacy' ? legacyAuthApp.displayName : 'your XENO device';
  const formStatus: DeviceCodeStatus =
    status === 'idle' || status === 'verifying' || status === 'connected' ? status : { error: status };
  const mismatch = !!(authorization?.request_country && authorization.viewer_country
    && authorization.request_country !== authorization.viewer_country);

  return (
    <>
      <header className={`flex items-center justify-between gap-4 px-4 py-3 sm:px-5 sm:py-4 transition-all duration-500 ease-out ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}`} style={{ transitionDelay: '0.1s' }}>
        <Link to="/" className="flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 transition-all duration-300">
          <ArrowLeft size={14} /><span>Back to home</span>
        </Link>
        <AuthMark />
      </header>

      <div className="flex-1 min-h-0 flex flex-col justify-center px-6 pb-6 lg:px-12 xl:px-20 pt-6">
        <div className={`w-full max-w-[440px] mx-auto transition-all duration-700 ease-out ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`} style={{ transitionDelay: '0.15s' }}>
          {authorization ? (
            <DeviceApproval
              app={{ name: authorization.client_name, unverified: authorization.unverified }}
              account={{ label: accountLabel }}
              code={code}
              permissions={describeScopes(authorization.scope)}
              origin={{ place: countryName(authorization.request_country), startedAgo: startedAgo(authorization.requested_at) }}
              mismatch={mismatch}
              status={approval}
              onApprove={() => { void decide(true); }}
              onDecline={() => { void decide(false); }}
              onSwitchAccount={switchAccount}
            />
          ) : (
            <DeviceCodeForm
              app={{ name: displayName }}
              code={code}
              onChange={onCodeChange}
              onSubmit={() => { void verify(); }}
              status={formStatus}
              account={{ label: accountLabel, onSwitch: switchAccount }}
              labels={{
                connect: protocol === 'legacy' ? 'Connect {app}' : 'Sign in on a device',
                hint: 'Enter the code shown on your device.',
                submit: 'Continue',
                busy: 'Checking…',
                connectedTitle: `Signed in to ${displayName}`,
                connectedBody: 'You can close this page and return to your device.',
              }}
            />
          )}
        </div>
      </div>
    </>
  );
};

export default DeviceAuthContent;
