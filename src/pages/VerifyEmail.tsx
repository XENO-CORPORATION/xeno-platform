import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { VerifyEmailNotice, type VerifyEmailStatus } from '@xenosystem/components/auth';
import AuthMark from '../components/auth/AuthMark';
import { getAccessToken } from '../lib/authSession';

const VerifyEmail = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [status, setStatus] = useState<VerifyEmailStatus>('pending');
  const [message, setMessage] = useState('');

  // Resend flow (only available when a JWT is present in storage)
  const hasToken = typeof window !== 'undefined' && !!getAccessToken();
  const [resending, setResending] = useState(false);
  const [resend, setResend] = useState<{ ok: boolean; message: string } | undefined>(undefined);

  // Guard so the verify request fires exactly once (React 18 StrictMode in dev
  // double-invokes effects; the token is single-use so we must not POST twice).
  const verifiedRef = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (verifiedRef.current) return;
    verifiedRef.current = true;

    const token = new URLSearchParams(window.location.search).get('token') || '';
    if (!token) {
      setStatus('failed');
      setMessage('This verification link is missing or malformed.');
      return;
    }

    (async () => {
      try {
        const response = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await response.json().catch(() => ({}));

        if (response.ok && data.success) {
          setStatus('verified');
          setMessage(data.message || 'Your email address has been verified.');
        } else {
          setStatus('failed');
          setMessage(data.error || 'This verification link is invalid or has expired.');
        }
      } catch (err) {
        console.error('Verify-email error:', err);
        setStatus('failed');
        setMessage('Network error. Please try again.');
      }
    })();
  }, []);

  const handleResend = async () => {
    const jwt = getAccessToken();
    if (!jwt || resending) return;
    setResending(true);
    setResend(undefined);
    try {
      const response = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
        },
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.success) {
        setResend({ ok: true, message: data.message || 'A new verification email is on its way.' });
      } else {
        setResend({ ok: false, message: data.error || 'Could not resend the verification email.' });
      }
    } catch (err) {
      console.error('Resend-verification error:', err);
      setResend({ ok: false, message: 'Network error. Please try again.' });
    } finally {
      setResending(false);
    }
  };

  return (
    <>
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
          <ArrowLeft size={14} className="transition-transform duration-300" />
          <span>Back to home</span>
        </Link>
        <AuthMark />
      </header>

      <div className="flex-1 min-h-0 flex flex-col justify-center px-6 pb-6 lg:px-12 xl:px-20 pt-6">
        <div
          className={`w-full max-w-[400px] mx-auto transition-all duration-700 ease-out ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
          style={{ transitionDelay: '0.15s' }}
        >
          <VerifyEmailNotice
            status={status}
            message={message || undefined}
            onResend={status === 'failed' && hasToken ? () => { void handleResend(); } : undefined}
            resending={resending}
            resend={resend}
            after={
              status === 'verified' ? (
                <Link to="/overview">Go to dashboard</Link>
              ) : status === 'failed' && !hasToken ? (
                <Link to="/login">Sign in</Link>
              ) : undefined
            }
          />
        </div>
      </div>
    </>
  );
};

export default VerifyEmail;
