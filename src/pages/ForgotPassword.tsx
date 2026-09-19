import React, { useState, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PasswordResetForm } from '@xenosystem/components/auth';
import AuthMark from '../components/auth/AuthMark';

const ForgotPassword = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const validateEmail = (value: string): boolean => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(value);
  };

  const submit = async () => {
    if (isSubmitting) return;
    setEmailError('');

    if (!validateEmail(email)) {
      setEmailError('Please enter a valid email address');
      return;
    }

    setIsSubmitting(true);

    try {
      // Fire the request. The backend ALWAYS responds { success: true } and never
      // reveals whether the account exists — so we show the same generic
      // confirmation regardless of the response body/status.
      await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      setSubmitted(true);
    } catch (error) {
      // Only a true network failure (request never completed) surfaces an error —
      // this leaks nothing about account existence and lets the user retry.
      console.error('Forgot-password error:', error);
      setEmailError('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
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
          to="/login"
          className="flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 transition-all duration-300 hover:gap-2"
        >
          <ArrowLeft size={14} className="transition-transform duration-300" />
          <span>Back to sign in</span>
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
          <PasswordResetForm
            mode="request"
            values={{ email, password: '', confirm: '' }}
            onChange={(v) => setEmail(v.email)}
            onSubmit={() => { void submit(); }}
            phase={submitted ? 'sent' : isSubmitting ? 'submitting' : 'idle'}
            errors={{ email: emailError || undefined }}
            onRetry={() => { setSubmitted(false); setEmailError(''); }}
            after={
              submitted ? (
                <Link to="/login">Back to sign in</Link>
              ) : (
                <>
                  Remembered it? <Link to="/login">Sign in</Link>
                </>
              )
            }
          />
        </div>
      </div>
    </>
  );
};

export default ForgotPassword;
