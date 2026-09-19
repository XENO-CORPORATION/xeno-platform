import React, { useState, useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { PasswordResetForm } from '@xenosystem/components/auth';
import AuthMark from '../components/auth/AuthMark';

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [isVisible, setIsVisible] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const submit = async () => {
    if (isSubmitting) return;
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json().catch(() => ({}));

      if (response.ok && data.success) {
        setDone(true);
      } else {
        setError(data.error || 'This reset link is invalid or has expired.');
      }
    } catch (err) {
      console.error('Reset-password error:', err);
      setError('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const phase = !token ? 'invalid' : done ? 'done' : isSubmitting ? 'submitting' : 'idle';

  return (
    <>
      <header
        className={`flex items-center justify-between gap-4 px-4 py-3 sm:px-5 sm:py-4 transition-all duration-500 ease-out ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
        }`}
        style={{ transitionDelay: '0.1s' }}
      >
        <div className="hidden lg:block" />
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
            mode="reset"
            values={{ email: '', password, confirm }}
            onChange={(v) => { setPassword(v.password); setConfirm(v.confirm); }}
            onSubmit={() => { void submit(); }}
            phase={phase}
            errors={{ form: error || undefined }}
            after={
              !token ? (
                <Link to="/forgot-password">Request a new link</Link>
              ) : done ? (
                <Link to="/login">Sign in</Link>
              ) : (
                <>
                  Link expired? <Link to="/forgot-password">Request a new one</Link>
                </>
              )
            }
          />
        </div>
      </div>
    </>
  );
};

export default ResetPassword;
