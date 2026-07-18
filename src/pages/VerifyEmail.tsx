import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, AlertCircle, MailCheck, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';

type Status = 'pending' | 'success' | 'error';

const VerifyEmail = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [status, setStatus] = useState<Status>('pending');
  const [message, setMessage] = useState('');

  // Resend flow (only available when a JWT is present in storage)
  const hasToken = typeof window !== 'undefined' && !!localStorage.getItem('xenoos_auth_token');
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');

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
      setStatus('error');
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
          setStatus('success');
          setMessage(data.message || 'Your email address has been verified.');
        } else {
          setStatus('error');
          setMessage(data.error || 'This verification link is invalid or has expired.');
        }
      } catch (err) {
        console.error('Verify-email error:', err);
        setStatus('error');
        setMessage('Network error. Please try again.');
      }
    })();
  }, []);

  const handleResend = async () => {
    const jwt = localStorage.getItem('xenoos_auth_token');
    if (!jwt || resending) return;
    setResending(true);
    setResendMessage('');
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
        setResendMessage(data.message || 'A new verification email is on its way.');
      } else {
        setResendMessage(data.error || 'Could not resend the verification email.');
      }
    } catch (err) {
      console.error('Resend-verification error:', err);
      setResendMessage('Network error. Please try again.');
    } finally {
      setResending(false);
    }
  };

  return (
    <>
      {/* Header */}
      <header
        className={`flex items-center justify-between p-6 lg:px-12 xl:px-20 lg:pt-12 xl:pt-16 transition-all duration-500 ease-out ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
        }`}
        style={{ transitionDelay: '0.1s' }}
      >
        <Link to="/" className="lg:hidden flex items-center gap-2 group">
          <img src="/logo.svg" alt="Xeno" className="w-8 h-8 invert transition-transform duration-300 group-hover:scale-105" />
          <span className="text-lg font-semibold transition-opacity duration-300 group-hover:opacity-80">Xeno</span>
        </Link>
        <div className="hidden lg:block" />
        <Link
          to="/"
          className="flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 transition-all duration-300 hover:gap-2"
        >
          <ArrowLeft size={14} className="transition-transform duration-300" />
          <span>Back to home</span>
        </Link>
      </header>

      <div className="flex-1 flex flex-col px-6 pb-12 lg:px-12 xl:px-20 pt-20 lg:pt-20 xl:pt-28">
        <div
          className={`w-full max-w-[400px] mx-auto transition-all duration-700 ease-out ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
          style={{ transitionDelay: '0.15s' }}
        >
          {status === 'pending' && (
            <div>
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.06] border border-white/[0.08]">
                <div className="w-6 h-6 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
              </div>
              <h2 className="text-3xl font-bold tracking-tight mb-2">Verifying your email</h2>
              <p className="text-white/40 leading-relaxed">Hang tight while we confirm your verification link&hellip;</p>
            </div>
          )}

          {status === 'success' && (
            <div className="animate-fadeSlideUp">
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/[0.08] border border-emerald-500/20">
                <CheckCircle2 size={26} className="text-emerald-400" />
              </div>
              <h2 className="text-3xl font-bold tracking-tight mb-2">Email verified</h2>
              <p className="text-white/40 leading-relaxed">{message}</p>
              <Link
                to="/overview"
                className="group mt-8 w-full py-4 bg-white text-black text-sm font-semibold rounded-xl flex items-center justify-center gap-0 transition-all duration-300 ease-out hover:bg-white/90 hover:shadow-lg hover:shadow-white/10 active:scale-[0.98] overflow-hidden"
              >
                <span className="transition-transform duration-300 group-hover:-translate-x-1">Go to dashboard</span>
                <ArrowRight size={16} strokeWidth={2.5} className="opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-2 transition-all duration-300 ease-out" />
              </Link>
            </div>
          )}

          {status === 'error' && (
            <div className="animate-fadeSlideUp">
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/[0.08] border border-red-500/20">
                <AlertCircle size={26} className="text-red-400" />
              </div>
              <h2 className="text-3xl font-bold tracking-tight mb-2">Verification failed</h2>
              <p className="text-white/40 leading-relaxed">{message}</p>

              {hasToken ? (
                <>
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resending}
                    className={`group mt-8 w-full py-4 bg-white text-black text-sm font-semibold rounded-xl flex items-center justify-center gap-2 transition-all duration-300 ease-out hover:bg-white/90 hover:shadow-lg hover:shadow-white/10 active:scale-[0.98] overflow-hidden ${
                      resending ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  >
                    {resending ? (
                      <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    ) : (
                      <>
                        <RefreshCw size={16} strokeWidth={2.5} className="transition-transform duration-500 group-hover:rotate-180" />
                        <span>Resend verification email</span>
                      </>
                    )}
                  </button>
                  <div className={`overflow-hidden transition-all duration-300 ease-out ${resendMessage ? 'max-h-16 opacity-100 mt-3' : 'max-h-0 opacity-0'}`}>
                    <p className="flex items-center gap-2 text-sm text-white/60">
                      <MailCheck size={15} className="text-white/40 shrink-0" />
                      {resendMessage}
                    </p>
                  </div>
                </>
              ) : (
                <Link
                  to="/auth"
                  className="group mt-8 w-full py-4 bg-white text-black text-sm font-semibold rounded-xl flex items-center justify-center gap-0 transition-all duration-300 ease-out hover:bg-white/90 hover:shadow-lg hover:shadow-white/10 active:scale-[0.98] overflow-hidden"
                >
                  <span className="transition-transform duration-300 group-hover:-translate-x-1">Sign in</span>
                  <ArrowRight size={16} strokeWidth={2.5} className="opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-2 transition-all duration-300 ease-out" />
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default VerifyEmail;
