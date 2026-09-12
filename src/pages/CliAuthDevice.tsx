/**
 * CLI Auth — Device Code Flow
 * Handles /cli-auth/device — user enters the XXXX-XXXX code shown by the CLI.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

type Phase = 'idle' | 'verifying' | 'success' | 'error';

const CliAuthDevice: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();

  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      navigate('/auth', { state: { from: { pathname: '/cli-auth/device' } }, replace: true });
    }
  }, [isAuthenticated, isLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPhase('verifying');
    setErrorMessage('');

    try {
      const token = localStorage.getItem('xenoos_auth_token');
      if (!token) {
        navigate('/auth', { state: { from: { pathname: '/cli-auth/device' } }, replace: true });
        return;
      }

      const res = await fetch('/api/auth/cli/device-code/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ user_code: code.trim().toUpperCase() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorMessage(data?.error || `request failed (${res.status})`);
        setPhase('error');
        return;
      }

      setPhase('success');
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
            <span className="text-sm text-white/70 font-medium">Device Activation</span>
          </div>
        </div>

        <h1 className="text-center font-semibold tracking-[-0.03em] text-white leading-[1.1] mb-3 text-3xl">
          Enter your code
        </h1>
        <p className="text-center text-white/45 leading-[1.6] mb-8 text-base">
          Type the code shown by the XENO CLI.
        </p>

        {phase !== 'success' ? (
          <form onSubmit={handleSubmit}>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="XXXX-XXXX"
              maxLength={9}
              autoFocus
              className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-4 py-4 text-center text-white/90 text-xl tracking-[0.3em] uppercase placeholder:text-white/30 outline-none focus:border-white/20 focus:bg-white/[0.06] transition-all mb-6"
            />

            <button
              type="submit"
              disabled={phase === 'verifying' || code.trim().length < 8}
              className="w-full bg-white text-[#08080a] hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed font-medium py-4 rounded-xl transition-all text-base"
            >
              {phase === 'verifying' ? 'Verifying...' : 'Authorize'}
            </button>

            {phase === 'error' && (
              <p className="text-center text-red-400/80 mt-6 text-sm">
                {errorMessage === 'invalid_code'
                  ? 'That code is not valid.'
                  : errorMessage === 'expired'
                    ? 'That code has expired. Run the CLI command again.'
                    : errorMessage === 'already_used'
                      ? 'That code has already been used.'
                      : `Error: ${errorMessage}`}
              </p>
            )}
          </form>
        ) : (
          <p className="text-center text-emerald-400 mt-6">
            Device authorized. You can return to the CLI now.
          </p>
        )}
      </div>
    </div>
  );
};

export default CliAuthDevice;
