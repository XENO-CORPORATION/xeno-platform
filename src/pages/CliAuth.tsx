/**
 * CLI Auth — Browser Flow
 * Handles /cli-auth?session=XXX redirects from the xeno-agent-cli.
 *
 * Flow:
 *   1. Read session_id from ?session= query param
 *   2. If not authenticated → redirect to /auth, then come back here
 *   3. If authenticated → show "Authorize" confirmation
 *   4. On confirm → POST /api/auth/cli/complete with session_id
 *   5. On success → window.location to the returned redirect_uri (CLI local callback)
 */

import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

type Phase = 'loading' | 'confirm' | 'completing' | 'success' | 'error';

const CliAuth: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading } = useAuth();

  const sessionId = searchParams.get('session') || '';

  const [phase, setPhase] = useState<Phase>('loading');
  const [errorMessage, setErrorMessage] = useState<string>('');

  useEffect(() => {
    if (isLoading) return;

    if (!sessionId) {
      setErrorMessage('Missing session id.');
      setPhase('error');
      return;
    }

    if (!isAuthenticated) {
      const here = `/cli-auth?session=${encodeURIComponent(sessionId)}`;
      navigate('/auth', { state: { from: { pathname: here } }, replace: true });
      return;
    }

    setPhase('confirm');
  }, [isAuthenticated, isLoading, sessionId, navigate]);

  const handleAuthorize = async () => {
    setPhase('completing');
    setErrorMessage('');

    try {
      const token = localStorage.getItem('xenoos_auth_token');
      if (!token) {
        navigate('/auth', { state: { from: { pathname: `/cli-auth?session=${sessionId}` } }, replace: true });
        return;
      }

      const res = await fetch('/api/auth/cli/complete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ session_id: sessionId }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const err = data?.error || `request failed (${res.status})`;
        setErrorMessage(err);
        setPhase('error');
        return;
      }

      const data = await res.json();
      if (data?.status !== 'ok' || typeof data?.redirect_uri !== 'string') {
        setErrorMessage('unexpected response from server');
        setPhase('error');
        return;
      }

      setPhase('success');
      window.location.href = data.redirect_uri;
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : 'network error');
      setPhase('error');
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#08080a] text-white font-['Inter',sans-serif] px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/[0.04] border border-white/[0.08]">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span className="text-sm text-white/70 font-medium">CLI Authorization</span>
          </div>
        </div>

        <h1 className="text-center font-semibold tracking-[-0.03em] text-white leading-[1.1] mb-3 text-3xl">
          Authorize XENO CLI
        </h1>

        {phase === 'loading' && (
          <p className="text-center text-white/50 mt-6">Loading...</p>
        )}

        {phase === 'confirm' && (
          <>
            <p className="text-center text-white/45 leading-[1.6] mb-8 text-base">
              The XENO command-line tool is requesting access to your account.
              {user?.email && (
                <>
                  <br />
                  Signed in as <span className="text-white/80">{user.email}</span>.
                </>
              )}
            </p>
            <button
              onClick={handleAuthorize}
              className="w-full bg-white text-[#08080a] hover:bg-white/90 font-medium py-4 rounded-xl transition-all text-base"
            >
              Authorize
            </button>
            <p className="text-center text-white/30 text-xs mt-6">
              You can revoke access at any time from your account settings.
            </p>
          </>
        )}

        {phase === 'completing' && (
          <p className="text-center text-white/50 mt-6">Authorizing...</p>
        )}

        {phase === 'success' && (
          <p className="text-center text-emerald-400 mt-6">
            Authorized. Returning to CLI...
          </p>
        )}

        {phase === 'error' && (
          <>
            <p className="text-center text-red-400/80 mt-6">
              Could not authorize: {errorMessage}
            </p>
            <button
              onClick={() => navigate('/')}
              className="block mx-auto mt-6 text-white/50 hover:text-white/80 text-sm underline"
            >
              Back to home
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default CliAuth;
