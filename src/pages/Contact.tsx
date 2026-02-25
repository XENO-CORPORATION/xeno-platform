import React, { useState, useEffect } from 'react';
import { ArrowLeft, Mail, User, MessageSquare, Send } from 'lucide-react';
import { Link } from 'react-router-dom';

const Contact = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    // Simulate submission
    await new Promise(resolve => setTimeout(resolve, 1000));

    setSubmitted(true);
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-[#000000] text-white font-['Inter',sans-serif] overflow-hidden antialiased flex">

      {/* Left Side - Hero Section with Video */}
      <div className="hidden lg:flex lg:w-[55%] xl:w-[60%] relative overflow-hidden">
        <video
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        >
          <source src="/hero-bg.mp4" type="video/mp4" />
        </video>

        <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-black/40 to-black/80" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40" />

        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 h-full w-full">
          <div className="flex items-center gap-3">
            <img
              src="/logo.svg"
              alt="Xeno"
              className="w-10 h-10 rounded-xl object-contain invert"
            />
            <span className="text-2xl font-bold tracking-tight">Xeno</span>
          </div>

          <div className="max-w-xl">
            <h1 className="text-4xl lg:text-5xl xl:text-6xl font-bold leading-[1.05] tracking-tight mb-6 text-white">
              Get in
              <br />
              <span className="text-white/40">
                touch.
              </span>
            </h1>
            <p className="text-base lg:text-lg text-white/50 leading-relaxed max-w-md">
              Have a question or feedback? We'd love to hear from you. Our team typically responds within 24 hours.
            </p>
          </div>

          <div className="flex items-center gap-10 lg:gap-12">
            <div>
              <div className="text-2xl lg:text-3xl font-bold text-white">&lt;24h</div>
              <div className="text-sm text-white/40">Response</div>
            </div>
            <div className="w-px h-8 lg:h-10 bg-white/10" />
            <div>
              <div className="text-2xl lg:text-3xl font-bold text-white">24/7</div>
              <div className="text-sm text-white/40">Support</div>
            </div>
          </div>
        </div>

        <div className="absolute right-0 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-white/20 to-transparent" />
      </div>

      {/* Right Side - Contact Form */}
      <div className="flex-1 flex flex-col min-h-screen bg-[#0a0a0c]">
        <header className="flex items-center justify-between p-6 lg:px-12 xl:px-20 lg:pt-12 xl:pt-16">
          <Link to="/" className="lg:hidden flex items-center gap-2">
            <img src="/logo.svg" alt="Xeno" className="w-8 h-8 invert" />
            <span className="text-lg font-semibold">Xeno</span>
          </Link>

          <div className="hidden lg:block" />

          <Link
            to="/"
            className="flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 transition-colors"
          >
            <ArrowLeft size={14} />
            <span>Back to home</span>
          </Link>
        </header>

        <div className="flex-1 flex flex-col px-6 pb-12 lg:px-12 xl:px-20 pt-20 lg:pt-20 xl:pt-28">
          <div
            className={`w-full max-w-[400px] mx-auto transition-all duration-700 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
          >
            <div className="mb-8">
              <h2 className="text-3xl font-bold tracking-tight mb-2">Contact us</h2>
              <p className="text-white/40">
                Send us a message and we'll get back to you soon
              </p>
            </div>

            {submitted ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-white/10 flex items-center justify-center">
                  <Send size={24} className="text-white/60" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Message sent!</h3>
                <p className="text-white/40 mb-6">We'll get back to you within 24 hours.</p>
                <Link
                  to="/"
                  className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors"
                >
                  <ArrowLeft size={14} />
                  Back to home
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-white/60 mb-2">
                    Name
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <User size={18} className="text-white/30" />
                    </div>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      className="w-full pl-11 pr-4 py-3.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-white/20 focus:bg-white/[0.06] transition-all"
                      placeholder="Your name"
                    />
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
                      className="w-full pl-11 pr-4 py-3.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-white/20 focus:bg-white/[0.06] transition-all"
                      placeholder="you@example.com"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-white/60 mb-2">
                    Message
                  </label>
                  <div className="relative">
                    <div className="absolute top-3.5 left-0 pl-4 flex items-start pointer-events-none">
                      <MessageSquare size={18} className="text-white/30" />
                    </div>
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      required
                      rows={4}
                      className="w-full pl-11 pr-4 py-3.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-white/20 focus:bg-white/[0.06] transition-all resize-none"
                      placeholder="How can we help?"
                    />
                  </div>
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
                      <span>Send Message</span>
                      <Send
                        size={16}
                        className="opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-2 transition-all duration-300 ease-in-out"
                      />
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>

        <footer className="hidden lg:flex items-center justify-between px-12 xl:px-20 py-6 border-t border-white/[0.04]">
          <p className="text-xs text-white/30">© 2026 Xeno. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <Link to="/help" className="text-xs text-white/30 hover:text-white/60 transition-colors">Help</Link>
            <Link to="/auth" className="text-xs text-white/30 hover:text-white/60 transition-colors">Sign In</Link>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default Contact;
