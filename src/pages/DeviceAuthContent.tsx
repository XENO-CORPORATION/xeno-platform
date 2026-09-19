import React, { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { DeviceCodeForm, formatUserCode, userCodeOf, type DeviceCodeStatus } from '@xenosystem/components/auth';
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
  } | null>(null);
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
    setCode(v);
    setAuthorization(null);
    if (status !== 'idle') setStatus('idle');
  };

  const verify = async () => {
    if (status === 'verifying') return;
    if (!userCodeOf(code)) { setStatus('Enter the full 8-character code.'); return; }
    if (!authed) { setStatus('Your session expired — please reload.'); return; }
    setStatus('verifying');
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
      if (protocol === 'oidc' && r.ok && !authorization && d.client_id && d.client_name) {
        setAuthorization({
          client_id: d.client_id,
          client_name: d.client_name,
          scope: typeof d.scope === 'string' ? d.scope.split(/\s+/).filter(Boolean) : [],
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
      setStatus('Network error — please try again.');
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
          <DeviceCodeForm
            app={{ name: displayName }}
            code={code}
            onChange={onCodeChange}
            onSubmit={() => { void verify(); }}
            status={formStatus}
            labels={{
              hint: authorization ? 'Confirm the registered client and requested access.' : 'Enter the code shown on your device.',
              submit: authorization ? `Approve ${authorization.client_name}` : 'Continue',
              busy: 'Checking…',
            }}
            after={authorization && status !== 'connected' ? (
              <div>
                <p>
                  Approve only if you started <span>{authorization.client_name}</span> on your device.
                </p>
                <div>
                  {authorization.scope.map((scope) => (
                    <span key={scope}>{scope}</span>
                  ))}
                </div>
              </div>
            ) : undefined}
          />
        </div>
      </div>
    </>
  );
};

export default DeviceAuthContent;
