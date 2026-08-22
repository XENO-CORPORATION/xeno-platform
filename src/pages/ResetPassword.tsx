import React, { useState, useEffect } from 'react';
import { ArrowLeft, ArrowRight, KeyRound, Eye, EyeOff, CheckCircle2, AlertCircle } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import AuthMark from '../components/auth/AuthMark';

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [isVisible, setIsVisible] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
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

  const Header = (
    <header
      className={`flex items-center justify-between gap-4 px-4 py-3 sm:px-5 sm:py-4 transition-all duration-500 ease-out ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
      }`}
      style={{ transitionDelay: '0.1s' }}
    >
      <div className="hidden lg:block" />
      <Link
        to="/auth"
        className="flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 transition-all duration-300 hover:gap-2"
      >
        <ArrowLeft size={14} className="transition-transform duration-300" />
        <span>Back to sign in</span>
      </Link>
      <AuthMark />
    </header>
  );

  // Missing token — the link is malformed / incomplete.
  if (!token) {
    return (
      <>
        {Header}
        <div className="flex-1 min-h-0 flex flex-col justify-center px-6 pb-6 lg:px-12 xl:px-20 pt-6">
          <div className="w-full max-w-[400px] mx-auto animate-fadeSlideUp">
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-[6px] bg-red-500/[0.08] border border-red-500/20">
              <AlertCircle size={26} className="text-red-400" />
            </div>
            <h2 className="text-3xl font-bold tracking-tight mb-2 text-center">Invalid reset link</h2>
            <p className="text-white/40 leading-relaxed">
              This password reset link is missing or malformed. Request a fresh one and we&rsquo;ll email you a new link.
            </p>
            <Link
              to="/forgot-password"
              className="group mt-8 w-full py-4 bg-white text-black text-sm font-semibold rounded-[6px] flex items-center justify-center gap-0 transition-all duration-300 ease-out hover:bg-white/90 hover:shadow-lg hover:shadow-white/10 active:scale-[0.98] overflow-hidden"
            >
              <span className="transition-transform duration-300 group-hover:-translate-x-1">Request a new link</span>
              <ArrowRight size={16} strokeWidth={2.5} className="opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-2 transition-all duration-300 ease-out" />
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {Header}
      <div className="flex-1 min-h-0 flex flex-col justify-center px-6 pb-6 lg:px-12 xl:px-20 pt-6">
        <div
          className={`w-full max-w-[400px] mx-auto transition-all duration-700 ease-out ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
          style={{ transitionDelay: '0.15s' }}
        >
          {done ? (
            /* Success */
            <div className="animate-fadeSlideUp">
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-[6px] bg-emerald-500/[0.08] border border-emerald-500/20">
                <CheckCircle2 size={26} className="text-emerald-400" />
              </div>
              <h2 className="text-3xl font-bold tracking-tight mb-2 text-center">Password reset</h2>
              <p className="text-white/40 leading-relaxed">
                Your password has been updated. You can now sign in with your new password.
              </p>
              <Link
                to="/auth"
                className="group mt-8 w-full py-4 bg-white text-black text-sm font-semibold rounded-[6px] flex items-center justify-center gap-0 transition-all duration-300 ease-out hover:bg-white/90 hover:shadow-lg hover:shadow-white/10 active:scale-[0.98] overflow-hidden"
              >
                <span className="transition-transform duration-300 group-hover:-translate-x-1">Sign in</span>
                <ArrowRight size={16} strokeWidth={2.5} className="opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-2 transition-all duration-300 ease-out" />
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-8">
                <h2 className="text-3xl font-bold tracking-tight mb-2 text-center">Set a new password</h2>
                <p className="text-white/40">Choose a strong password you don&rsquo;t use anywhere else.</p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* New password */}
                <div>
                  <label className="block text-sm font-medium text-white/60 mb-2">New password</label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <KeyRound size={18} className="text-white/30 transition-colors duration-300 group-focus-within:text-white/50" />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoFocus
                      className="w-full pl-11 pr-12 py-3.5 bg-white/[0.04] border border-white/[0.08] rounded-[6px] text-white placeholder-white/30 focus:outline-none focus:border-white/20 focus:bg-white/[0.06] transition-all duration-300 hover:border-white/15"
                      placeholder="At least 6 characters"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-4 flex items-center"
                    >
                      <div className="transition-all duration-300 hover:scale-110">
                        {showPassword ? (
                          <EyeOff size={18} className="text-white/30 hover:text-white/60 transition-colors duration-300" />
                        ) : (
                          <Eye size={18} className="text-white/30 hover:text-white/60 transition-colors duration-300" />
                        )}
                      </div>
                    </button>
                  </div>
                </div>

                {/* Confirm password */}
                <div>
                  <label className="block text-sm font-medium text-white/60 mb-2">Confirm password</label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <KeyRound size={18} className="text-white/30 transition-colors duration-300 group-focus-within:text-white/50" />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      required
                      className={`w-full pl-11 pr-4 py-3.5 bg-white/[0.04] border ${
                        error ? 'border-red-500/50 focus:border-red-500/70' : 'border-white/[0.08] focus:border-white/20'
                      } rounded-[6px] text-white placeholder-white/30 focus:outline-none focus:bg-white/[0.06] transition-all duration-300 hover:border-white/15`}
                      placeholder="Re-enter your password"
                    />
                  </div>
                  <div className={`overflow-hidden transition-all duration-300 ease-out ${error ? 'max-h-8 opacity-100 mt-2' : 'max-h-0 opacity-0'}`}>
                    <p className="text-sm text-red-400">{error}</p>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`group w-full mt-2 py-4 bg-white text-black text-sm font-semibold rounded-[6px] flex items-center justify-center gap-0 transition-all duration-300 ease-out hover:bg-white/90 hover:shadow-lg hover:shadow-white/10 active:scale-[0.98] overflow-hidden ${
                    isSubmitting ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  {isSubmitting ? (
                    <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-[3px] animate-spin" />
                  ) : (
                    <>
                      <span className="transition-transform duration-300 group-hover:-translate-x-1">Reset password</span>
                      <ArrowRight size={16} strokeWidth={2.5} className="opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-2 transition-all duration-300 ease-out" />
                    </>
                  )}
                </button>
              </form>

              {/* Expired/invalid-token escape hatch (also shown on server-side errors) */}
              <p className="text-center text-sm text-white/30 mt-8">
                Link expired?{' '}
                <Link to="/forgot-password" className="text-white/50 hover:text-white transition-colors underline underline-offset-2">
                  Request a new one
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default ResetPassword;
