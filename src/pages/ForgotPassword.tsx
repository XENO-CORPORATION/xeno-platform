import React, { useState, useEffect } from 'react';
import { ArrowLeft, ArrowRight, Mail, MailCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

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

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
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
          to="/auth"
          className="flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 transition-all duration-300 hover:gap-2"
        >
          <ArrowLeft size={14} className="transition-transform duration-300" />
          <span>Back to sign in</span>
        </Link>
      </header>

      <div className="flex-1 flex flex-col px-6 pb-12 lg:px-12 xl:px-20 pt-20 lg:pt-20 xl:pt-28">
        <div
          className={`w-full max-w-[400px] mx-auto transition-all duration-700 ease-out ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
          style={{ transitionDelay: '0.15s' }}
        >
          {submitted ? (
            /* Generic confirmation — identical whether or not the account exists */
            <div className="animate-fadeSlideUp">
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.06] border border-white/[0.08]">
                <MailCheck size={26} className="text-white/80" />
              </div>
              <h2 className="text-3xl font-bold tracking-tight mb-2">Check your email</h2>
              <p className="text-white/40 leading-relaxed">
                If an account exists for <span className="text-white/70">{email}</span>, we&rsquo;ve sent a
                password reset link. Follow it to choose a new password.
              </p>
              <p className="text-sm text-white/30 mt-4 leading-relaxed">
                Didn&rsquo;t get it? Check your spam folder, or{' '}
                <button
                  type="button"
                  onClick={() => setSubmitted(false)}
                  className="text-white/50 hover:text-white transition-colors underline underline-offset-2"
                >
                  try another email
                </button>
                .
              </p>

              <Link
                to="/auth"
                className="group mt-8 w-full py-4 bg-white text-black text-sm font-semibold rounded-xl flex items-center justify-center gap-0 transition-all duration-300 ease-out hover:bg-white/90 hover:shadow-lg hover:shadow-white/10 active:scale-[0.98] overflow-hidden"
              >
                <span className="transition-transform duration-300 group-hover:-translate-x-1">Back to sign in</span>
                <ArrowRight
                  size={16}
                  strokeWidth={2.5}
                  className="opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-2 transition-all duration-300 ease-out"
                />
              </Link>
            </div>
          ) : (
            <>
              {/* Heading */}
              <div className="mb-8">
                <h2 className="text-3xl font-bold tracking-tight mb-2">Forgot password?</h2>
                <p className="text-white/40">
                  Enter the email associated with your account and we&rsquo;ll send you a link to reset your password.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-white/60 mb-2">Email</label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <Mail size={18} className="text-white/30 transition-colors duration-300 group-focus-within:text-white/50" />
                    </div>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoFocus
                      className={`w-full pl-11 pr-4 py-3.5 bg-white/[0.04] border ${
                        emailError ? 'border-red-500/50 focus:border-red-500/70' : 'border-white/[0.08] focus:border-white/20'
                      } rounded-xl text-white placeholder-white/30 focus:outline-none focus:bg-white/[0.06] transition-all duration-300 hover:border-white/15`}
                      placeholder="you@example.com"
                    />
                  </div>
                  <div className={`overflow-hidden transition-all duration-300 ease-out ${emailError ? 'max-h-8 opacity-100 mt-2' : 'max-h-0 opacity-0'}`}>
                    <p className="text-sm text-red-400">{emailError}</p>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`group w-full mt-2 py-4 bg-white text-black text-sm font-semibold rounded-xl flex items-center justify-center gap-0 transition-all duration-300 ease-out hover:bg-white/90 hover:shadow-lg hover:shadow-white/10 active:scale-[0.98] overflow-hidden ${
                    isSubmitting ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  {isSubmitting ? (
                    <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  ) : (
                    <>
                      <span className="transition-transform duration-300 group-hover:-translate-x-1">Send reset link</span>
                      <ArrowRight
                        size={16}
                        strokeWidth={2.5}
                        className="opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-2 transition-all duration-300 ease-out"
                      />
                    </>
                  )}
                </button>
              </form>

              <p className="text-center text-sm text-white/30 mt-8">
                Remembered it?{' '}
                <Link to="/auth" className="text-white/50 hover:text-white transition-colors underline underline-offset-2">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default ForgotPassword;
