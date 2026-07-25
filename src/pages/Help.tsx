import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, ChevronDown, MessageCircle, Send, X } from 'lucide-react';
import { Link } from 'react-router-dom';

const faqs = [
  {
    question: 'What is Xeno?',
    answer: 'Xeno is an AI-powered creative platform that helps you design, generate, and build with cutting-edge AI tools. From image generation to code assistance, Xeno provides everything creators need.'
  },
  {
    question: 'How do I get started?',
    answer: 'Simply create an account, and you\'ll have access to all our AI tools. Start with the overview dashboard to explore available features and begin creating.'
  },
  {
    question: 'Is my data secure?',
    answer: 'Yes, we take security seriously. All data is encrypted in transit and at rest. We never share your personal information or creations with third parties.'
  },
  {
    question: 'What AI models do you use?',
    answer: 'We integrate with leading AI providers including state-of-the-art image generation, language models, and specialized creative AI tools to give you the best results.'
  },
  {
    question: 'How do I cancel my subscription?',
    answer: 'You can cancel anytime from your account settings. Your access will continue until the end of your billing period.'
  }
];

const Help = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [messages, setMessages] = useState<Array<{role: 'user' | 'agent', text: string}>>([
    { role: 'agent', text: 'Hi! I\'m here to help. What can I assist you with today?' }
  ]);
  const [inputValue, setInputValue] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = () => {
    if (!inputValue.trim()) return;

    setMessages(prev => [...prev, { role: 'user', text: inputValue }]);
    setInputValue('');

    // Simulate agent response
    setTimeout(() => {
      setMessages(prev => [...prev, {
        role: 'agent',
        text: 'Thanks for your message! A support agent will review this and get back to you shortly. In the meantime, check out our FAQ above for quick answers.'
      }]);
    }, 1000);
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
              How can we
              <br />
              <span className="text-white/40">
                help?
              </span>
            </h1>
            <p className="text-base lg:text-lg text-white/50 leading-relaxed max-w-md">
              Find answers to common questions or chat with our support team for personalized assistance.
            </p>
          </div>

          <div className="flex items-center gap-10 lg:gap-12">
            <div>
              <div className="text-2xl lg:text-3xl font-bold text-white">5+</div>
              <div className="text-sm text-white/40">FAQ Topics</div>
            </div>
            <div className="w-px h-8 lg:h-10 bg-white/10" />
            <div>
              <div className="text-2xl lg:text-3xl font-bold text-white">Live</div>
              <div className="text-sm text-white/40">Chat Support</div>
            </div>
          </div>
        </div>

        <div className="absolute right-0 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-white/20 to-transparent" />
      </div>

      {/* Right Side - Help Content */}
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

        <div className="flex-1 flex flex-col px-6 pb-12 lg:px-12 xl:px-20 pt-12 lg:pt-12 xl:pt-16 overflow-y-auto">
          <div
            className={`w-full max-w-[450px] mx-auto transition-all duration-700 ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
          >
            <div className="mb-8">
              <h2 className="text-3xl font-bold tracking-tight mb-2">Help Center</h2>
              <p className="text-white/40">
                Frequently asked questions and support
              </p>
            </div>

            {/* FAQ Accordion */}
            <div className="space-y-2 mb-8">
              {faqs.map((faq, index) => (
                <div
                  key={index}
                  className="border border-white/[0.08] rounded-xl overflow-hidden"
                >
                  <button
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                    className="w-full flex items-center justify-between p-4 text-left hover:bg-white/[0.02] transition-colors"
                  >
                    <span className="text-sm font-medium text-white/80">{faq.question}</span>
                    <ChevronDown
                      size={18}
                      className={`text-white/40 transition-transform duration-300 ${
                        openFaq === index ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  <div
                    className={`overflow-hidden transition-all duration-300 ease-in-out ${
                      openFaq === index ? 'max-h-48' : 'max-h-0'
                    }`}
                  >
                    <p className="px-4 pb-4 text-sm text-white/50 leading-relaxed">
                      {faq.answer}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Chat Support Button */}
            <button
              onClick={() => setChatOpen(true)}
              className="w-full flex items-center justify-center gap-2 py-4 bg-white/[0.04] border border-white/[0.08] rounded-xl text-sm font-medium text-white/70 hover:bg-white/[0.08] hover:text-white transition-all"
            >
              <MessageCircle size={18} />
              <span>Chat with Support</span>
            </button>
          </div>
        </div>

        <footer className="hidden lg:flex items-center justify-between px-12 xl:px-20 py-6 border-t border-white/[0.04]">
          <p className="text-xs text-white/30">© 2026 Xeno. All rights reserved.</p>
          <div className="flex items-center gap-6">
            <Link to="/contact" className="text-xs text-white/30 hover:text-white/60 transition-colors">Contact</Link>
            <Link to="/auth" className="text-xs text-white/30 hover:text-white/60 transition-colors">Sign In</Link>
          </div>
        </footer>
      </div>

      {/* Chat Modal */}
      {chatOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div
            className={`w-full max-w-md bg-[#0a0a0c] border border-white/[0.08] rounded-2xl overflow-hidden shadow-2xl transition-all duration-300 ${
              chatOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
            }`}
          >
            {/* Chat Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/[0.08]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
                  <MessageCircle size={16} className="text-white/60" />
                </div>
                <div>
                  <p className="text-sm font-medium">Support Chat</p>
                  <p className="text-xs text-white/40">We typically reply instantly</p>
                </div>
              </div>
              <button
                onClick={() => setChatOpen(false)}
                className="p-2 hover:bg-white/[0.06] rounded-lg transition-colors"
              >
                <X size={18} className="text-white/40" />
              </button>
            </div>

            {/* Chat Messages */}
            <div className="h-80 overflow-y-auto p-4 space-y-4">
              {messages.map((msg, index) => (
                <div
                  key={index}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${
                      msg.role === 'user'
                        ? 'bg-white text-black rounded-br-md'
                        : 'bg-white/[0.06] text-white/80 rounded-bl-md'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {/* Chat Input */}
            <div className="p-4 border-t border-white/[0.08]">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                  placeholder="Type your message..."
                  className="flex-1 px-4 py-3 bg-white/[0.04] border border-white/[0.08] rounded-xl text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/20 transition-all"
                />
                <button
                  onClick={sendMessage}
                  className="p-3 bg-white text-black rounded-xl hover:bg-white/90 transition-colors"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Help;
