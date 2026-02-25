import React, { useState, useEffect } from 'react';
import { ArrowLeft, Mail, User, MessageSquare, Send, CheckCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

const ContactContent = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitTransition, setSubmitTransition] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsSubmitting(true);

    // Simulate submission
    await new Promise(resolve => setTimeout(resolve, 1000));

    setSubmitTransition(true);
    setTimeout(() => {
      setSubmitted(true);
      setIsSubmitting(false);
      setTimeout(() => setSubmitTransition(false), 100);
    }, 300);
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
          {/* Header */}
          <div
            className={`mb-8 transition-all duration-500 ease-out ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
            style={{ transitionDelay: '0.2s' }}
          >
            <h2 className="text-3xl font-bold tracking-tight mb-2">Contact us</h2>
            <p className="text-white/40">
              Send us a message and we'll get back to you soon
            </p>
          </div>

          {/* Success State or Form */}
          <div className={`transition-all duration-500 ease-out ${submitTransition ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}`}>
            {submitted ? (
              <div
                className={`text-center py-12 transition-all duration-700 ease-out ${
                  isVisible && !submitTransition ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
                }`}
              >
                <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-white/10 flex items-center justify-center animate-bounce-subtle">
                  <CheckCircle size={32} className="text-green-400" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Message sent!</h3>
                <p className="text-white/40 mb-6">We'll get back to you within 24 hours.</p>
                <Link
                  to="/"
                  className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white transition-all duration-300 hover:gap-3 group"
                >
                  <ArrowLeft size={14} className="transition-transform duration-300 group-hover:-translate-x-1" />
                  Back to home
                </Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Name Field */}
                <div
                  className={`transition-all duration-500 ease-out ${
                    isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                  }`}
                  style={{ transitionDelay: '0.25s' }}
                >
                  <label className="block text-sm font-medium text-white/60 mb-2">
                    Name
                  </label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <User size={18} className="text-white/30 transition-colors duration-300 group-focus-within:text-white/50" />
                    </div>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      className="w-full pl-11 pr-4 py-3.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-white/20 focus:bg-white/[0.06] transition-all duration-300 hover:border-white/15"
                      placeholder="Your name"
                    />
                  </div>
                </div>

                {/* Email Field */}
                <div
                  className={`transition-all duration-500 ease-out ${
                    isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                  }`}
                  style={{ transitionDelay: '0.3s' }}
                >
                  <label className="block text-sm font-medium text-white/60 mb-2">
                    Email
                  </label>
                  <div className="relative group">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <Mail size={18} className="text-white/30 transition-colors duration-300 group-focus-within:text-white/50" />
                    </div>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      className="w-full pl-11 pr-4 py-3.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-white/20 focus:bg-white/[0.06] transition-all duration-300 hover:border-white/15"
                      placeholder="you@example.com"
                    />
                  </div>
                </div>

                {/* Message Field */}
                <div
                  className={`transition-all duration-500 ease-out ${
                    isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                  }`}
                  style={{ transitionDelay: '0.35s' }}
                >
                  <label className="block text-sm font-medium text-white/60 mb-2">
                    Message
                  </label>
                  <div className="relative group">
                    <div className="absolute top-3.5 left-0 pl-4 flex items-start pointer-events-none">
                      <MessageSquare size={18} className="text-white/30 transition-colors duration-300 group-focus-within:text-white/50" />
                    </div>
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      required
                      rows={4}
                      className="w-full pl-11 pr-4 py-3.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white placeholder-white/30 focus:outline-none focus:border-white/20 focus:bg-white/[0.06] transition-all duration-300 hover:border-white/15 resize-none"
                      placeholder="How can we help?"
                    />
                  </div>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`group w-full mt-6 py-4 bg-white text-black text-sm font-semibold rounded-xl flex items-center justify-center gap-0 transition-all duration-300 ease-out hover:bg-white/90 hover:shadow-lg hover:shadow-white/10 active:scale-[0.98] overflow-hidden ${
                    isSubmitting ? 'opacity-70 cursor-not-allowed' : ''
                  } ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}
                  style={{ transitionDelay: '0.4s' }}
                >
                  {isSubmitting ? (
                    <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  ) : (
                    <>
                      <span className="transition-transform duration-300 group-hover:-translate-x-1">Send Message</span>
                      <Send
                        size={16}
                        className="opacity-0 -ml-4 group-hover:opacity-100 group-hover:ml-2 transition-all duration-300 ease-out"
                      />
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Subtle animation styles */}
      <style>{`
        @keyframes bounce-subtle {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-5px);
          }
        }
        .animate-bounce-subtle {
          animation: bounce-subtle 2s ease-in-out infinite;
        }
      `}</style>
    </>
  );
};

export default ContactContent;
