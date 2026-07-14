import React, { useState, useEffect } from 'react';
import { ArrowLeft, KeyRound, Mail, User, Eye, EyeOff, Github, ArrowRight } from 'lucide-react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

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

  const validateEmail = (email: string): boolean => {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
  };

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
    <div className="min-h-screen bg-[#000000] text-white font-['Inter',sans-serif] overflow-hidden antialiased flex">

      {/* Left Side - Hero Section with Video */}
      <div className="hidden lg:flex lg:w-[55%] xl:w-[60%] relative overflow-hidden">
        {/* Video Background */}
        <video
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        >
          <source src="/hero-bg.mp4" type="video/mp4" />
        </video>

        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/40 to-black/80" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40" />

        {/* Content Overlay */}
        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 h-full w-full">
          {/* Top - Logo */}
          <div className="flex items-center gap-3">
            <img
              src="/logo.svg"
              alt="Xeno"
              className="w-10 h-10 rounded-xl object-contain invert"
            />
            <span className="text-2xl font-bold tracking-tight">Xeno</span>
          </div>

          {/* Center - Hero Message */}
          <div className="max-w-xl">
            <h1 className="text-4xl lg:text-5xl xl:text-6xl font-bold leading-[1.05] tracking-tight mb-6 text-white">
              Create without
              <br />
              <span className="text-white/40">
                limits.
              </span>
            </h1>
            <p className="text-base lg:text-lg text-white/50 leading-relaxed max-w-md">
              The next-generation platform for creators. Design, generate, and build with the power of AI at your fingertips.
            </p>
          </div>

          {/* Bottom - Stats/Social Proof */}
          <div className="flex items-center gap-10 lg:gap-12">
            <div>
              <div className="text-2xl lg:text-3xl font-bold text-white">50K+</div>
              <div className="text-sm text-white/40">Creators</div>
            </div>
            <div className="w-px h-8 lg:h-10 bg-white/10" />
            <div>
              <div className="text-2xl lg:text-3xl font-bold text-white">1M+</div>
              <div className="text-sm text-white/40">Creations</div>
            </div>
            <div className="w-px h-8 lg:h-10 bg-white/10" />
            <div>
              <div className="text-2xl lg:text-3xl font-bold text-white">4.9</div>
              <div className="text-sm text-white/40">Rating</div>
            </div>
          </div>
        </div>

        {/* Animated Gradient Border */}
        <div className="absolute right-0 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-white/20 to-transparent" />
      </div>

      {/* Right Side - Auth Form */}
      <div className="flex-1 flex flex-col min-h-screen bg-[#0a0a0c]">
        {/* Header - Same height alignment as left panel logo */}
        <header className="flex items-center justify-between p-6 lg:px-12 xl:px-20 lg:pt-12 xl:pt-16">
          {/* Mobile Logo */}
          <Link to="/" className="lg:hidden flex items-center gap-2">
            <img src="/logo.svg" alt="Xeno" className="w-8 h-8 invert" />
            <span className="text-lg font-semibold">Xeno</span>
          </Link>

          {/* Spacer for desktop */}
          <div className="hidden lg:block" />

          {/* Back to home - aligned top right */}
          <Link
            to="/"
            className="flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 transition-colors"
          >
            <ArrowLeft size={14} />
            <span>Back to home</span>
          </Link>
        </header>

        {/* Form Container - Fixed from top, not centered */}
        <div className="flex-1 flex flex-col px-6 pb-12 lg:px-12 xl:px-20 pt-20 lg:pt-20 xl:pt-28">
          <div
            className={`w-full max-w-[400px] mx-auto transition-all duration-700 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
          >
            {/* Welcome Text */}
            <div className="mb-8">
              <h2 className="text-3xl font-bold tracking-tight mb-2">
                {activeTab === 'signin' ? 'Welcome back' : 'Get started'}
              </h2>
              <p className="text-white/40">
                {activeTab === 'signin'
                  ? 'Enter your credentials to access your account'
                  : 'Create your account and start creating'}
              </p>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 p-1 mb-8 rounded-xl bg-white/[0.04] border border-white/[0.06]">
              <button
                className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                  activeTab === 'signin'
                    ? 'bg-white text-black shadow-lg'
                    : 'text-white/50 hover:text-white/80'
                }`}
                onClick={() => setActiveTab('signin')}
              >
                Sign In
              </button>
              <button
                className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 ${
                  activeTab === 'signup'
                    ? 'bg-white text-black shadow-lg'
                    : 'text-white/50 hover:text-white/80'
                }`}
                onClick={() => setActiveTab('signup')}
              >
                Sign Up
              </button>
            </div>

            {/* Social Buttons */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              <button className="flex items-center justify-center py-3 rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/[0.15] transition-all group">
                <svg className="w-5 h-5 opacity-70 group-hover:opacity-100 transition-opacity" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
                  <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z" />
                  <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z" />
                  <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z" />
                  <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z" />
                </svg>
              </button>
              <button className="flex items-center justify-center py-3 rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/[0.15] transition-all group">
                <Github className="w-5 h-5 text-white/70 group-hover:text-white transition-colors" />
              </button>
              <button className="flex items-center justify-center py-3 rounded-xl border border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.06] hover:border-white/[0.15] transition-all group">
                <svg className="w-5 h-5 text-white/70 group-hover:text-white transition-colors" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
              </button>
            </div>

            {/* Divider */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-white/[0.08]" />
              </div>
              <div className="relative flex justify-center">
                <span className="px-4 text-xs text-white/30 bg-[#0a0a0c] uppercase tracking-wider">
                  or continue with email
                </span>
              </div>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Full Name - with smooth transition */}
              <div className={`transition-all duration-300 ease-out overflow-hidden ${
                activeTab === 'signup' ? 'max-h-24 opacity-100' : 'max-h-0 opacity-0'
              }`}>
                <div className="pb-4">
                  <label className="block text-sm font-medium text-white/60 mb-2">
                    Full Name
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <User size={18} className="text-white/30" />
                    </div>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full pl-11 pr-4 py-3.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-white/20 focus:bg-white/[0.06] transition-all"
                      placeholder="John Doe"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-white/60 mb-2">
                  Email
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Mail size={18} className="text-white/30" />
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className={`w-full pl-11 pr-4 py-3.5 bg-white/[0.04] border ${
                      emailError ? 'border-red-500/50' : 'border-white/[0.08]'
                    } rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-white/20 focus:bg-white/[0.06] transition-all`}
                    placeholder="you@example.com"
                  />
                </div>
                {emailError && (
                  <p className="mt-2 text-sm text-red-400">{emailError}</p>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-white/60">
                    Password
                  </label>
                  {activeTab === 'signin' && (
                    <Link
                      to="/forgot-password"
                      className="text-sm text-white/40 hover:text-white transition-colors"
                    >
                      Forgot?
                    </Link>
                  )}
                </div>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <KeyRound size={18} className="text-white/30" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className={`w-full pl-11 pr-12 py-3.5 bg-white/[0.04] border ${
                      passwordError ? 'border-red-500/50' : 'border-white/[0.08]'
                    } rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-white/20 focus:bg-white/[0.06] transition-all`}
                    placeholder="Enter your password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-4 flex items-center"
                  >
                    {showPassword ? (
                      <EyeOff size={18} className="text-white/30 hover:text-white/60 transition-colors" />
                    ) : (
                      <Eye size={18} className="text-white/30 hover:text-white/60 transition-colors" />
                    )}
                  </button>
                </div>
                {passwordError && (
                  <p className="mt-2 text-sm text-red-400">{passwordError}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className={`group w-full mt-6 py-4 bg-white text-black text-sm font-semibold rounded-xl flex items-center justify-center gap-0 transition-all duration-200 hover:bg-white/90 active:scale-[0.98] overflow-hidden ${
                  isSubmitting ? 'opacity-50 cursor-not-allowed' : ''
                }`}
              >
                {isSubmitting ? (
                  <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                ) : (
                  <>
                    <span>{activeTab === 'signin' ? 'Sign In' : 'Create Account'}</span>
                    <ArrowRight
                      size={16}
                      strokeWidth={2.5}
                      className="opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-2 transition-all duration-300 ease-in-out"
                    />
                  </>
                )}
              </button>
            </form>

            {/* Terms */}
            <p className="text-center text-xs text-white/30 mt-8 leading-relaxed">
              By continuing, you agree to our{' '}
              <Link to="/terms" className="text-white/50 hover:text-white transition-colors underline underline-offset-2">
                Terms
              </Link>{' '}
              and{' '}
              <Link to="/privacy" className="text-white/50 hover:text-white transition-colors underline underline-offset-2">
                Privacy Policy
              </Link>
            </p>
          </div>
        </div>

        {/* Footer */}
        <footer className="hidden lg:flex items-center justify-between px-12 xl:px-20 py-6 border-t border-white/[0.04]">
          <p className="text-xs text-white/30">© 2026 Xeno. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <Link to="/help" className="text-xs text-white/30 hover:text-white/60 transition-colors">Help</Link>
            <Link to="/contact" className="text-xs text-white/30 hover:text-white/60 transition-colors">Contact</Link>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default Auth;
