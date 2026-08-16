import React, { useState, useEffect } from 'react';
import { ArrowLeft, ChevronDown, Send } from 'lucide-react';
import { Link } from 'react-router-dom';
import AuthMark from '../components/auth/AuthMark';

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

const HelpContent = () => {
  const [isVisible, setIsVisible] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [chatMode, setChatMode] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // Track when container is fully collapsed
  useEffect(() => {
    if (chatMode) {
      setIsCollapsed(false);
    } else {
      // Wait for container to collapse before showing content
      const timer = setTimeout(() => setIsCollapsed(true), 300);
      return () => clearTimeout(timer);
    }
  }, [chatMode]);

  const toggleChat = () => {
    setChatMode(!chatMode);
  };

  return (
    <>
      {/* Header */}
      <header
        className={`flex items-center justify-between gap-4 px-4 py-3 sm:px-5 sm:py-4 transition-all duration-500 ease-out ${
          isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
        }`}
        style={{ transitionDelay: '0.1s' }}
      >


        <Link
          to="/"
          className="flex items-center gap-1.5 text-sm text-white/40 hover:text-white/70 transition-all duration-300 hover:gap-2"
        >
          <ArrowLeft size={14} className="transition-transform duration-300" />
          <span>Back to home</span>
        </Link>
        <AuthMark />
      </header>

      <div className="flex-1 flex flex-col px-6 pb-12 lg:px-12 xl:px-20 pt-12 lg:pt-12 xl:pt-16 overflow-hidden">
        <div
          className={`w-full max-w-[450px] mx-auto flex flex-col flex-1 transition-all duration-700 ease-out ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
          }`}
          style={{ transitionDelay: '0.15s' }}
        >
          {/* Page Header */}
          <div
            className={`mb-8 transition-all duration-500 ease-out ${
              isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
            }`}
            style={{ transitionDelay: '0.2s' }}
          >
            <h2 className="text-3xl font-bold tracking-tight mb-2">Help Center</h2>
            <p className="text-white/40">Frequently asked questions and support</p>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 flex flex-col min-h-0">

            {/* First FAQ Item - container stays, content fades, expands when chatMode */}
            <div
              className={`border border-white/[0.08] rounded-[6px] overflow-hidden transition-all duration-300 ease-out ${
                isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              } ${chatMode ? 'flex-1' : ''}`}
              style={{ transitionDelay: '0.25s', minHeight: '56px' }}
            >
              {/* FAQ content - fades out when chatMode, fades in only after collapse */}
              <div
                className={`p-4 transition-opacity duration-300 ease-out ${
                  chatMode || !isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'
                }`}
              >
                <button
                  onClick={() => !chatMode && setOpenFaq(openFaq === 0 ? null : 0)}
                  className={`w-full flex items-center justify-between text-left transition-all duration-300 group ${
                    chatMode ? 'cursor-default pointer-events-none' : ''
                  }`}
                >
                  <span className="text-sm font-medium text-white/80 transition-colors duration-300 group-hover:text-white">
                    {faqs[0].question}
                  </span>
                  <ChevronDown
                    size={18}
                    className={`text-white/40 transition-all duration-300 ease-out ${
                      openFaq === 0 ? 'rotate-180 text-white/60' : 'group-hover:text-white/60'
                    }`}
                  />
                </button>
                <div
                  className={`overflow-hidden transition-all duration-400 ease-out ${
                    openFaq === 0 && !chatMode ? 'max-h-48 opacity-100 mt-4' : 'max-h-0 opacity-0'
                  }`}
                >
                  <p className="text-sm text-white/50 leading-relaxed">
                    {faqs[0].answer}
                  </p>
                </div>
              </div>
            </div>

            {/* Other FAQ Items (2-5) - hide when chatMode, show only after collapse */}
            <div
              className={`space-y-2 mt-2 transition-all duration-300 ease-out overflow-hidden ${
                chatMode || !isCollapsed ? 'opacity-0 max-h-0' : 'opacity-100 max-h-[1000px]'
              }`}
            >
              {faqs.slice(1).map((faq, idx) => {
                const index = idx + 1;
                return (
                  <div
                    key={index}
                    className={`border border-white/[0.08] rounded-[6px] overflow-hidden transition-all duration-500 ease-out hover:border-white/[0.12] ${
                      isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                    }`}
                    style={{ transitionDelay: `${0.25 + index * 0.05}s` }}
                  >
                    <button
                      onClick={() => setOpenFaq(openFaq === index ? null : index)}
                      className="w-full flex items-center justify-between p-4 text-left hover:bg-white/[0.02] transition-all duration-300 group"
                    >
                      <span className="text-sm font-medium text-white/80 transition-colors duration-300 group-hover:text-white">
                        {faq.question}
                      </span>
                      <ChevronDown
                        size={18}
                        className={`text-white/40 transition-all duration-300 ease-out ${
                          openFaq === index ? 'rotate-180 text-white/60' : 'group-hover:text-white/60'
                        }`}
                      />
                    </button>
                    <div
                      className={`overflow-hidden transition-all duration-400 ease-out ${
                        openFaq === index ? 'max-h-48 opacity-100' : 'max-h-0 opacity-0'
                      }`}
                    >
                      <p className="px-4 pb-4 text-sm text-white/50 leading-relaxed">
                        {faq.answer}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Chat with Support Button - under FAQs normally, bottom when chatMode */}
            <div
              className={`pt-4 transition-all duration-300 ease-out ${
                isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
              } ${chatMode || !isCollapsed ? 'mt-auto' : ''}`}
              style={{ transitionDelay: '0.55s' }}
            >
              <button
                onClick={toggleChat}
                className="w-full flex items-center justify-center gap-2 py-4 bg-white/[0.04] border border-white/[0.08] rounded-[6px] text-sm font-medium text-white/70 hover:text-white hover:bg-white/[0.08] hover:border-white/[0.12] transition-all duration-300 ease-out group"
              >
                <Send size={18} className="transition-transform duration-300 group-hover:scale-110 group-hover:rotate-[-15deg]" />
                <span>{chatMode ? 'Back to FAQ' : 'Chat with Support'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default HelpContent;
