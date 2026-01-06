import React, { useState, useEffect } from 'react';
import { ArrowLeft, KeyRound, Mail, User, Eye, EyeOff, Github, ArrowRight } from 'lucide-react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

// Main Auth component
const Auth = () => {
  const [activeTab, setActiveTab] = useState<'signin' | 'signup'>('signin');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { login, register } = useAuth();

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  // Email validation function
  const validateEmail = (email: string): boolean => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  };

  // Form submission handler
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setEmailError('');
    setPasswordError('');
    let isValid = true;

    if (!validateEmail(email)) {
      setEmailError('Please enter a valid email address');
      isValid = false;
    }
    if (password.length < 6) {
      setPasswordError('Password must be at least 6 characters');
      isValid = false;
    }

    if (activeTab === 'signup' && !name.trim()) {
      setEmailError('Please enter your full name');
      isValid = false;
    }

    if (!isValid) return;

    setIsSubmitting(true);

    try {
      let result;

      if (activeTab === 'signin') {
        result = await login(email, password);
      } else {
        result = await register({
          username: email.split('@')[0],
          email,
          password,
          display_name: name
        });
      }

      if (result.success) {
        const from = (location.state as any)?.from?.pathname || '/overview';
        navigate(from, { replace: true });
      } else {
        if (activeTab === 'signin') {
          setPasswordError(result.error || 'Login failed');
        } else {
          setEmailError(result.error || 'Registration failed');
        }
      }
    } catch (error) {
      console.error('Authentication error:', error);
      setEmailError('Network error. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#08080a] text-white font-['Inter',sans-serif] overflow-hidden antialiased">
      {/* Background effects */}
      <div className="fixed inset-0 pointer-events-none">
        {/* Subtle gradient orbs */}
        <div
          className="absolute top-1/4 left-1/4 w-[600px] h-[600px] rounded-full opacity-[0.03]"
          style={{
            background: 'radial-gradient(circle, rgba(255,255,255,0.15) 0%, transparent 70%)',
            transform: 'translate(-50%, -50%)',
          }}
        />
        <div
          className="absolute bottom-1/4 right-1/4 w-[500px] h-[500px] rounded-full opacity-[0.02]"
          style={{
            background: 'radial-gradient(circle, rgba(255,255,255,0.1) 0%, transparent 70%)',
            transform: 'translate(50%, 50%)',
          }}
        />
        {/* Vignette */}
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse 80% 80% at 50% 50%, transparent 0%, #08080a 100%)',
          }}
        />
      </div>

      {/* Floating header */}
      <header className="fixed top-0 left-0 right-0 z-50 flex justify-center px-4 pt-4">
        <div
          className="relative flex items-center justify-between gap-2 px-3 py-2.5 rounded-2xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-xl shadow-[0_4px_24px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.03)]"
          style={{ width: 'min(95vw, 500px)' }}
        >
          {/* Glass reflection effect */}
          <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
            <div
              className="absolute inset-0 opacity-[0.03]"
              style={{
                background: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 50%, transparent 100%)',
              }}
            />
          </div>

          {/* Logo */}
          <Link to="/" className="relative flex items-center gap-2.5 pl-1 group">
            <img
              src="/logo.svg"
              alt="Xeno"
              className="w-7 h-7 rounded-lg object-contain transition-transform group-hover:scale-105 invert"
            />
            <span className="text-[15px] font-semibold text-white tracking-tight">Xeno</span>
          </Link>

          {/* Back to home */}
          <Link
            to="/"
            className="relative flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-white/50 hover:text-white transition-colors font-medium rounded-lg hover:bg-white/[0.04]"
          >
            <ArrowLeft size={14} />
            <span className="hidden sm:inline">Back to Home</span>
          </Link>
        </div>
      </header>

      {/* Main content */}
      <div className="relative z-10 min-h-screen flex flex-col items-center justify-center px-4 py-24">
        <div
          className={`w-full max-w-[420px] transition-all duration-700 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
        >
          {/* Welcome text */}
          <div className="text-center mb-8">
            <h1
              className="font-semibold tracking-[-0.03em] text-white leading-[1.1] mb-3"
              style={{ fontSize: 'clamp(1.75rem, 4vw, 2.5rem)' }}
            >
              {activeTab === 'signin' ? 'Welcome back' : 'Create account'}
            </h1>
            <p className="text-white/40 text-[15px]">
              {activeTab === 'signin'
                ? 'Sign in to continue to your workspace'
                : 'Start building with AI-powered tools'}
            </p>
          </div>

          {/* Auth card */}
          <div
            className={`relative rounded-2xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.03)] transition-all duration-500 delay-100 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
          >
            {/* Glass reflection */}
            <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
              <div
                className="absolute inset-0 opacity-[0.02]"
                style={{
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 40%, transparent 100%)',
                }}
              />
            </div>

            <div className="relative p-6 sm:p-8">
              {/* Tabs */}
              <div className="flex gap-1 p-1 mb-6 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                <button
                  className={`flex-1 py-2.5 text-[13px] font-medium rounded-lg transition-all duration-300 ${
                    activeTab === 'signin'
                      ? 'bg-white/[0.08] text-white shadow-sm'
                      : 'text-white/40 hover:text-white/60'
                  }`}
                  onClick={() => setActiveTab('signin')}
                >
                  Sign In
                </button>
                <button
                  className={`flex-1 py-2.5 text-[13px] font-medium rounded-lg transition-all duration-300 ${
                    activeTab === 'signup'
                      ? 'bg-white/[0.08] text-white shadow-sm'
                      : 'text-white/40 hover:text-white/60'
                  }`}
                  onClick={() => setActiveTab('signup')}
                >
                  Sign Up
                </button>
              </div>

              {/* Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                {activeTab === 'signup' && (
                  <div>
                    <label className="block text-[13px] font-medium text-white/50 mb-2">
                      Full Name
                    </label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                        <User size={16} className="text-white/30" />
                      </div>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        className="w-full pl-10 pr-4 py-3 bg-white/[0.03] border border-white/[0.08] rounded-xl text-white text-[14px] placeholder-white/25 focus:outline-none focus:border-white/20 focus:bg-white/[0.05] transition-all"
                        placeholder="Enter your name"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-[13px] font-medium text-white/50 mb-2">
                    Email Address
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                      <Mail size={16} className="text-white/30" />
                    </div>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className={`w-full pl-10 pr-4 py-3 bg-white/[0.03] border ${
                        emailError ? 'border-red-500/50' : 'border-white/[0.08]'
                      } rounded-xl text-white text-[14px] placeholder-white/25 focus:outline-none focus:border-white/20 focus:bg-white/[0.05] transition-all`}
                      placeholder="you@example.com"
                    />
                  </div>
                  {emailError && (
                    <p className="mt-2 text-[12px] text-red-400">{emailError}</p>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[13px] font-medium text-white/50">
                      Password
                    </label>
                    {activeTab === 'signin' && (
                      <Link
                        to="/forgot-password"
                        className="text-[12px] text-white/40 hover:text-white/60 transition-colors"
                      >
                        Forgot password?
                      </Link>
                    )}
                  </div>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                      <KeyRound size={16} className="text-white/30" />
                    </div>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      className={`w-full pl-10 pr-12 py-3 bg-white/[0.03] border ${
                        passwordError ? 'border-red-500/50' : 'border-white/[0.08]'
                      } rounded-xl text-white text-[14px] placeholder-white/25 focus:outline-none focus:border-white/20 focus:bg-white/[0.05] transition-all`}
                      placeholder={activeTab === 'signin' ? 'Enter your password' : 'Create a password'}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center"
                    >
                      {showPassword ? (
                        <EyeOff size={16} className="text-white/30 hover:text-white/50 transition-colors" />
                      ) : (
                        <Eye size={16} className="text-white/30 hover:text-white/50 transition-colors" />
                      )}
                    </button>
                  </div>
                  {passwordError && (
                    <p className="mt-2 text-[12px] text-red-400">{passwordError}</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`group w-full mt-6 py-3 bg-white text-[#08080a] text-[14px] font-semibold rounded-xl flex items-center justify-center gap-2 transition-all hover:bg-white/90 hover:shadow-[0_0_30px_rgba(255,255,255,0.1)] ${
                    isSubmitting ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  {isSubmitting ? (
                    <div className="w-5 h-5 border-2 border-[#08080a]/30 border-t-[#08080a] rounded-full animate-spin" />
                  ) : (
                    <>
                      {activeTab === 'signin' ? 'Sign In' : 'Create Account'}
                      <ArrowRight size={16} strokeWidth={2.5} className="group-hover:translate-x-0.5 transition-transform" />
                    </>
                  )}
                </button>
              </form>

              {/* Divider */}
              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/[0.06]" />
                </div>
                <div className="relative flex justify-center">
                  <span className="px-4 text-[12px] text-white/30 bg-[#0c0c0e]">
                    Or continue with
                  </span>
                </div>
              </div>

              {/* Social buttons */}
              <div className="grid grid-cols-3 gap-3">
                <button className="flex items-center justify-center py-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.12] transition-all">
                  <svg className="w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
                    <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z" />
                    <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z" />
                    <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z" />
                    <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z" />
                  </svg>
                </button>
                <button className="flex items-center justify-center py-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.12] transition-all">
                  <Github className="w-5 h-5 text-white/70" />
                </button>
                <button className="flex items-center justify-center py-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.12] transition-all">
                  <svg className="w-5 h-5 text-white/70" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* Terms */}
          <p
            className={`text-center text-[12px] text-white/30 mt-6 transition-all duration-700 delay-200 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
          >
            By continuing, you agree to our{' '}
            <Link to="/terms" className="text-white/50 hover:text-white/70 transition-colors underline underline-offset-2">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link to="/privacy" className="text-white/50 hover:text-white/70 transition-colors underline underline-offset-2">
              Privacy Policy
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Auth;
