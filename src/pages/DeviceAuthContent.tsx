import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AuthMark from '../components/auth/AuthMark';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { getAuthApp } from '../lib/authApps';

/* ──────────────────────────────────────────────────────────────────────
 * Device-code entry for the unified /auth/:app/device surface (CLI/Hub from
 * another device). Per "XENO UNIFIED AUTH - SPEC.md" Phase 2: reuses the
 * branded /auth/:app login (via returnUrl) for sign-in, then verifies the
 * one-time code against /api/auth/cli/device-code/verify. Backend unchanged.
 * ────────────────────────────────────────────────────────────────────── */
const DeviceAuthContent = () => {
  const { app: appSlug } = useParams();
  const authApp = getAuthApp(appSlug) ?? getAuthApp('cli')!;
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'verifying' | 'connected' | string>('idle');
  const [isVisible, setIsVisible] = useState(false);

  const authed = typeof window !== 'undefined' && !!localStorage.getItem('xenoos_auth_token');

  useEffect(() => {
    const t = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(t);
  }, []);

  // Not signed in → hand off to the branded login, returning here once authed.
  useEffect(() => {
    if (!authed) {
      const here = `/auth/${appSlug ?? 'cli'}/device`;
      window.location.href = `/auth/${appSlug ?? 'cli'}?returnUrl=${encodeURIComponent(here)}`;
    }
  }, [authed, appSlug]);

  // Auto-format to XXXX-XXXX as the user types.
  const onCodeChange = (v: string) => {
    const clean = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    setCode(clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean);
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    const userCode = code.replace(/[^A-Z0-9]/gi, '');
    if (userCode.length !== 8) { setStatus('Enter the full 8-character code.'); return; }
    const tok = localStorage.getItem('xenoos_auth_token');
    if (!tok) { setStatus('Your session expired — please reload.'); return; }
    setStatus('verifying');
    try {
      const r = await fetch('/api/auth/cli/device-code/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
        body: JSON.stringify({ user_code: code.toUpperCase() }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.status === 'ok') { setStatus('connected'); return; }
      setStatus(d.error === 'invalid_code' ? 'That code is invalid. Check it and try again.'
        : d.error === 'expired' ? 'That code has expired. Start again from your terminal.'
        : d.error === 'already_used' ? 'That code was already used.'
        : (d.error || 'Verification failed — please try again.'));
    } catch {
      setStatus('Network error — please try again.');
    }
  };

  if (!authed) return null; // redirecting to the branded login

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
          <div className="mb-6 flex items-center gap-3 rounded-[6px] border border-white/[0.08] bg-white/[0.03] p-3">
            {/* Monochrome: DESIGN_SYSTEM.md §2 is white-alpha only and colour is
              semantic-only. The registry's per-app accent is retired hue
              (#a760ff and friends) and must not paint product chrome. */}
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[4px] border border-white/[0.12] bg-white/[0.06] text-sm font-bold text-white/85">
              {authApp.displayName.replace(/^XENO\s+/, '').charAt(0)}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-tight">Connect {authApp.displayName}</div>
              <div className="truncate text-xs text-white/40">Enter the code shown in your terminal.</div>
            </div>
          </div>

          {status === 'connected' ? (
            <div className="rounded-[6px] border border-emerald-400/30 bg-emerald-400/[0.08] px-4 py-5 text-center">
              <div className="text-base font-semibold text-emerald-300">✓ Connected</div>
              <p className="mt-1 text-sm text-white/50">Return to your terminal — you're signed in.</p>
            </div>
          ) : (
            <form onSubmit={verify}>
              <label className="mb-2 block text-sm text-white/50">One-time code</label>
              <div className="relative">
                <KeyRound size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  value={code}
                  onChange={(e) => onCodeChange(e.target.value)}
                  placeholder="XXXX-XXXX"
                  autoFocus
                  inputMode="text"
                  className="w-full rounded-[6px] border border-white/[0.08] bg-white/[0.02] py-3 pl-10 pr-3 text-center font-mono text-lg tracking-[0.3em] text-white placeholder:tracking-normal placeholder:text-white/20 focus:border-white/30 focus:outline-none"
                />
              </div>
              {status !== 'idle' && status !== 'verifying' && (
                <p className="mt-2 text-sm text-red-400">{status}</p>
              )}
              <button type="submit" disabled={status === 'verifying'} className="mt-5 w-full rounded-[6px] bg-white py-3 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:opacity-60">
                {status === 'verifying' ? 'Connecting…' : 'Connect'}
              </button>
              <p className="mt-4 text-center text-xs text-white/30">Device codes are a common phishing target. Never share yours.</p>
            </form>
          )}
        </div>
      </div>
    </>
  );
};

export default DeviceAuthContent;
