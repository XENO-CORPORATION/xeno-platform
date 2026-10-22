import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { DeviceCodeForm, formatUserCode, userCodeOf, type DeviceCodeStatus } from '@xenosystem/components/auth';
import { Button } from '@xenosystem/elements-react';
import AuthMark from '../components/auth/AuthMark';
import { ArrowLeft } from 'lucide-react';
import { getAuthApp } from '../lib/authApps';
import { authPath } from '../lib/authRouting.js';
import { useAuth } from '../contexts/AuthContext';

/* ──────────────────────────────────────────────────────────────────────
 * /activate is the RFC 8628 verification URI. /auth/:app/device remains a
 * compatibility surface for the pre-OIDC CLI device-code implementation.
 *
 * The code field, typing rule, connected state and phishing note are
 * `@xenosystem/components/auth` DeviceCodeForm. This page owns the session
 * redirect, the inspect/approve (or legacy verify) calls, and the consent
 * copy for the registered client.
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

const DeviceAuthContent: React.FC<{ protocol?: 'oidc' | 'legacy' }> = ({ protocol = 'oidc' }) => {
  const { app: appSlug } = useParams();
  const location = useLocation();
  const legacyAuthApp = getAuthApp(appSlug) ?? getAuthApp('cli')!;
  const initialCode = new URLSearchParams(location.search).get('code') || '';
  const [code, setCode] = useState(() => formatUserCode(initialCode));
  const [status, setStatus] = useState<'idle' | 'verifying' | 'connected' | string>('idle');
  const [authorization, setAuthorization] = useState<{
    client_id: string;
    client_name: string;
    scope: string[];
    unverified?: boolean;
  } | null>(null);
  const [denied, setDenied] = useState(false);
  const requestGeneration = useRef(0);
  const [isVisible, setIsVisible] = useState(false);

  const { isAuthenticated: authed, isLoading: authLoading } = useAuth();

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

  const onCodeChange = (v: string) => {
    requestGeneration.current++;
    setDenied(false);
    setCode(v);
    setAuthorization(null);
    if (status !== 'idle') setStatus('idle');
  };

  const deny = async () => {
    if (status === 'verifying' || !authorization || !authed) return;
    setStatus('verifying');
    const generation = ++requestGeneration.current;
    try {
      const r = await fetch('/api/oauth2/device/deny', { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user_code: code.toUpperCase() }) });
      if (generation !== requestGeneration.current) return;
      if (!r.ok) throw new Error('denial failed');
      setDenied(true);
      setAuthorization(null);
      setStatus('idle');
    } catch { if (generation === requestGeneration.current) setStatus('Could not decline this request. Try again.'); }
  };

  const verify = async () => {
    if (status === 'verifying') return;
    if (!userCodeOf(code)) { setStatus('Enter the full 8-character code.'); return; }
    if (!authed) { setStatus('Your session expired — please reload.'); return; }
    setStatus('verifying');
    const generation = ++requestGeneration.current;
    try {
      const endpoint = protocol === 'oidc'
        ? (authorization ? '/api/oauth2/device/approve' : '/api/oauth2/device/inspect')
        : '/api/auth/cli/device-code/verify';
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_code: code.toUpperCase() }),
      });
      const d = await r.json().catch(() => ({}));
      if (generation !== requestGeneration.current) return;
      if (protocol === 'oidc' && r.ok && !authorization && d.client_id && d.client_name) {
        setAuthorization({
          client_id: d.client_id,
          client_name: d.client_name,
          scope: typeof d.scope === 'string' ? d.scope.split(/\s+/).filter(Boolean) : [],
          unverified: d.unverified === true,
        });
        setStatus('idle');
        return;
      }
      if (r.ok && (d.status === 'ok' || d.ok === true)) { setStatus('connected'); return; }
      setStatus(d.error === 'invalid_code' ? 'That code is invalid. Check it and try again.'
        : d.error === 'expired' ? 'That code has expired. Start again from your terminal.'
        : d.error === 'already_used' ? 'That code was already used.'
        : d.error_description === 'invalid or expired user_code' ? 'That code is invalid or expired. Start again from your device.'
        : (d.error || 'Verification failed — please try again.'));
    } catch {
      if (generation === requestGeneration.current) setStatus('Network error — please try again.');
    }
  };

  if (authLoading || !authed) return null; // checking or redirecting

  const displayName = authorization?.client_name
    || (protocol === 'legacy' ? legacyAuthApp.displayName : 'your XENO device');

  const formStatus: DeviceCodeStatus =
    status === 'idle' || status === 'verifying' || status === 'connected'
      ? status
      : { error: status };

  return (
    <>
      <header className={`flex items-center justify-between gap-4 px-4 py-3 sm:px-5 sm:py-4 transition-all duration-500 ease-out ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'}`} style={{ transitionDelay: '0.1s' }}>
        <Link to="/" className="flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 transition-all duration-300">
          <ArrowLeft size={14} /><span>Back to home</span>
        </Link>
        <AuthMark />
      </header>

      <div className="flex-1 min-h-0 flex flex-col justify-center px-6 pb-6 lg:px-12 xl:px-20 pt-6">
        <div className={`w-full max-w-[400px] mx-auto transition-all duration-700 ease-out ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`} style={{ transitionDelay: '0.15s' }}>
          {denied ? <div role="status"><h1>Sign-in declined</h1><p>No access was granted. Return to your terminal.</p></div> : <DeviceCodeForm
            app={{ name: displayName }}
            code={code}
            onChange={onCodeChange}
            onSubmit={() => { void verify(); }}
            status={formStatus}
            labels={{
              hint: authorization ? 'Confirm the registered client and requested access.' : 'Enter the code shown on your device.',
              submit: authorization ? `Approve ${authorization.client_name}` : 'Continue',
              busy: 'Checking…',
              connectedTitle: `Signed in to ${displayName}`,
              connectedBody: 'You can close this page and return to your device.',
            }}
            after={authorization && status !== 'connected' ? (
              <div className="mt-5 space-y-3 text-sm">
                <p className="text-white/60">
                  Approve only if you started <span className="text-white">{authorization.client_name}</span> on your device.
                  It will be able to:
                </p>
                <ul className="space-y-1.5 rounded-lg bg-white/[0.04] px-4 py-3 text-white/80">
                  {describeScopes(authorization.scope).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {authorization.unverified ? (
                  <p className="text-white/60">This app registered itself and has not been reviewed by XENO. It will act as its own agent of yours, never as you. Actions that cannot be undone ask you to sign in again.</p>
                ) : null}
                <p className="text-white/40">You can sign it out at any time from your account.</p>
                <Button type="button" variant="secondary" disabled={status === 'verifying'} onClick={() => { void deny(); }}>Decline sign-in</Button>
              </div>
            ) : undefined}
          />}
        </div>
      </div>
    </>
  );
};

export default DeviceAuthContent;
