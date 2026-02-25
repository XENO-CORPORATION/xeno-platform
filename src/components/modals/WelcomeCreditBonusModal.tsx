import React, { useState, useEffect, useRef } from 'react';
import { X, ArrowRight, Sparkles, Check, Crown, Zap, Play, Pause } from 'lucide-react';
import { authService } from '../../services/authService';

interface WelcomeCreditBonusModalProps {
  isOpen: boolean;
  onClose: () => void;
  onClaim: () => void;
}

const MODAL_SHOWN_KEY = 'xeno_welcome_bonus_modal_shown';

// Showcase videos/content for each feature
const showcases = [
  {
    title: 'Image Generation',
    description: 'Create stunning visuals with AI',
    video: 'https://replicate.delivery/yhqm/z6OBv4LzSgLjPCxVnLpVPGgOphhiNQWLmLLHDH5ggVOXTBKJA/out.mp4',
    gradient: 'from-violet-500/20 to-fuchsia-500/20',
  },
  {
    title: 'Video Creation',
    description: 'Transform ideas into motion',
    video: 'https://replicate.delivery/yhqm/VCtNHnaNprLBynMbpLLaA6bvh6NrjWf2sT4YGVGG2wFoqjdoA/output.mp4',
    gradient: 'from-blue-500/20 to-cyan-500/20',
  },
  {
    title: 'AI Assistant',
    description: 'Your creative copilot',
    video: 'https://replicate.delivery/yhqm/IoHQEK0c1wkJo5wkD2s1wT6OGYtjbBWKwNJxbnJ8GBZiqjdoA/output.mp4',
    gradient: 'from-emerald-500/20 to-teal-500/20',
  },
];

const plans = [
  {
    name: 'Free',
    price: '0',
    credits: '1,000',
    features: ['1,000 credits', 'Basic models', 'Community support'],
    current: true,
  },
  {
    name: 'Pro',
    price: '19',
    credits: '10,000',
    features: ['10,000 credits/mo', 'Premium models', 'Priority support', 'API access'],
    popular: true,
  },
  {
    name: 'Enterprise',
    price: '99',
    credits: 'Unlimited',
    features: ['Unlimited credits', 'All models', 'Dedicated support', 'Custom integrations'],
  },
];

const WelcomeCreditBonusModal: React.FC<WelcomeCreditBonusModalProps> = ({
  isOpen,
  onClose,
  onClaim,
}) => {
  const [isClaiming, setIsClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [activeShowcase, setActiveShowcase] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);

  useEffect(() => {
    if (isOpen) {
      const alreadyShown = sessionStorage.getItem(MODAL_SHOWN_KEY);
      if (alreadyShown) {
        onClose();
        return;
      }
      sessionStorage.setItem(MODAL_SHOWN_KEY, 'true');
      setShouldRender(true);
      const timer = setTimeout(() => setIsVisible(true), 50);
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
      const timer = setTimeout(() => setShouldRender(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen, onClose]);

  // Auto-cycle through showcases
  useEffect(() => {
    if (!isVisible) return;
    const interval = setInterval(() => {
      setActiveShowcase((prev) => (prev + 1) % showcases.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [isVisible]);

  if (!shouldRender) return null;

  const handleClaim = async () => {
    setIsClaiming(true);
    setError(null);

    try {
      const result = await authService.claimBonusCredits();
      if (result.success) {
        setClaimed(true);
        onClaim();
        setTimeout(() => handleClose(), 2000);
      } else {
        setError(result.error || 'Failed to claim credits');
      }
    } catch (error) {
      setError('Network error. Please try again.');
    } finally {
      setIsClaiming(false);
    }
  };

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(() => onClose(), 200);
  };

  const togglePlayPause = () => {
    const video = videoRefs.current[activeShowcase];
    if (video) {
      if (isPlaying) {
        video.pause();
      } else {
        video.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center font-['Inter',sans-serif] p-4 md:p-8">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-black/80 backdrop-blur-md transition-opacity duration-500 ${
          isVisible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={handleClose}
      />

      {/* Modal Container */}
      <div
        className={`relative w-full max-w-[1200px] h-[90vh] transition-all duration-500 ease-out ${
          isVisible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-8'
        }`}
      >
        <div className="absolute inset-0 rounded-2xl bg-[#0a0a0c] border border-white/[0.08] overflow-hidden flex">

          {/* Left Panel - Showcases */}
          <div className="hidden md:flex flex-col flex-1 bg-[#08080a] border-r border-white/[0.06] relative overflow-hidden">

            {/* Video Background */}
            <div className="absolute inset-0">
              {showcases.map((showcase, index) => (
                <div
                  key={index}
                  className={`absolute inset-0 transition-opacity duration-700 ${
                    activeShowcase === index ? 'opacity-100' : 'opacity-0'
                  }`}
                >
                  <video
                    ref={(el) => (videoRefs.current[index] = el)}
                    src={showcase.video}
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                  />
                  {/* Gradient Overlay */}
                  <div className={`absolute inset-0 bg-gradient-to-br ${showcase.gradient} mix-blend-overlay`} />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#08080a] via-[#08080a]/60 to-transparent" />
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent to-[#08080a]/80" />
                </div>
              ))}
            </div>

            {/* Content Overlay */}
            <div className="relative z-10 flex flex-col h-full p-8">
              {/* Logo */}
              <div
                className={`flex items-center gap-2 mb-auto transition-all duration-500 ${
                  isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
                }`}
                style={{ transitionDelay: '0.1s' }}
              >
                <img src="/logo.svg" alt="Xeno" className="w-8 h-8 invert" />
                <span className="text-lg font-semibold text-white">Xeno</span>
              </div>

              {/* Showcase Info */}
              <div className="mt-auto">
                {/* Play/Pause Button */}
                <button
                  onClick={togglePlayPause}
                  className={`mb-6 p-3 rounded-full bg-white/10 hover:bg-white/20 border border-white/10 backdrop-blur-sm transition-all duration-300 ${
                    isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                  }`}
                  style={{ transitionDelay: '0.2s' }}
                >
                  {isPlaying ? <Pause size={20} className="text-white" /> : <Play size={20} className="text-white" />}
                </button>

                {/* Active Showcase Title */}
                <div
                  className={`transition-all duration-500 ${
                    isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                  }`}
                  style={{ transitionDelay: '0.25s' }}
                >
                  <h3 className="text-2xl font-bold text-white mb-2">
                    {showcases[activeShowcase].title}
                  </h3>
                  <p className="text-white/50 text-sm mb-6">
                    {showcases[activeShowcase].description}
                  </p>
                </div>

                {/* Showcase Indicators */}
                <div
                  className={`flex gap-2 transition-all duration-500 ${
                    isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                  }`}
                  style={{ transitionDelay: '0.3s' }}
                >
                  {showcases.map((showcase, index) => (
                    <button
                      key={index}
                      onClick={() => setActiveShowcase(index)}
                      className={`group flex items-center gap-3 px-4 py-3 rounded-xl border transition-all duration-300 ${
                        activeShowcase === index
                          ? 'bg-white/10 border-white/20'
                          : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.05] hover:border-white/10'
                      }`}
                    >
                      <div
                        className={`w-1.5 h-1.5 rounded-full transition-all duration-300 ${
                          activeShowcase === index ? 'bg-white' : 'bg-white/30'
                        }`}
                      />
                      <span
                        className={`text-xs font-medium transition-colors duration-300 ${
                          activeShowcase === index ? 'text-white' : 'text-white/40'
                        }`}
                      >
                        {showcase.title}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Right Panel - Claim & Plans */}
          <div className="flex-1 md:max-w-[440px] flex flex-col relative">

            {/* Close Button */}
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 z-10 p-2 text-white/30 hover:text-white/60 hover:bg-white/[0.04] rounded-lg transition-all duration-300"
            >
              <X size={18} />
            </button>

            <div className="flex-1 p-8 flex flex-col justify-center">

              {/* Header */}
              <div
                className={`mb-6 transition-all duration-500 ${
                  isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                }`}
                style={{ transitionDelay: '0.15s' }}
              >
                <h2 className="text-2xl font-bold tracking-tight text-white mb-2">
                  {claimed ? 'You\'re all set!' : 'Welcome to Xeno'}
                </h2>
                <p className="text-white/40 text-sm">
                  {claimed
                    ? 'Your credits are ready. Start creating!'
                    : 'Claim your free credits to get started'
                  }
                </p>
              </div>

              {/* Free Credits Card */}
              <div
                className={`mb-6 transition-all duration-500 ${
                  isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                }`}
                style={{ transitionDelay: '0.2s' }}
              >
                <div className={`p-6 rounded-xl border transition-all duration-500 ${
                  claimed
                    ? 'bg-emerald-500/10 border-emerald-500/20'
                    : 'bg-white/[0.02] border-white/[0.08]'
                }`}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Sparkles className={`w-5 h-5 ${claimed ? 'text-emerald-400' : 'text-white/50'}`} />
                      <span className="text-sm font-medium text-white">Free Credits</span>
                    </div>
                    {claimed && (
                      <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500/20">
                        <Check size={12} className="text-emerald-400" />
                        <span className="text-xs text-emerald-400 font-medium">Claimed</span>
                      </div>
                    )}
                  </div>
                  <div className="text-4xl font-bold text-white tracking-tight mb-1">
                    1,000
                  </div>
                  <p className="text-white/30 text-xs">
                    Credits to explore all features
                  </p>
                </div>
              </div>

              {/* Error */}
              {error && (
                <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <p className="text-red-400 text-sm text-center">{error}</p>
                </div>
              )}

              {/* Claim Button */}
              {!claimed && (
                <button
                  onClick={handleClaim}
                  disabled={isClaiming}
                  className={`w-full py-4 bg-white text-black text-sm font-semibold rounded-xl flex items-center justify-center gap-2 transition-all duration-300 hover:bg-white/90 hover:shadow-lg hover:shadow-white/10 active:scale-[0.98] disabled:opacity-50 mb-6 ${
                    isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                  }`}
                  style={{ transitionDelay: '0.25s' }}
                >
                  {isClaiming ? (
                    <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                  ) : (
                    <>
                      Claim Free Credits
                      <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>
              )}

              {/* Divider */}
              <div
                className={`relative my-4 transition-all duration-500 ${
                  isVisible ? 'opacity-100' : 'opacity-0'
                }`}
                style={{ transitionDelay: '0.3s' }}
              >
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-white/[0.06]" />
                </div>
                <div className="relative flex justify-center">
                  <span className="px-3 text-[10px] text-white/20 bg-[#0a0a0c] uppercase tracking-wider">
                    or upgrade for more
                  </span>
                </div>
              </div>

              {/* Plans */}
              <div
                className={`space-y-3 flex-1 transition-all duration-500 ${
                  isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
                }`}
                style={{ transitionDelay: '0.35s' }}
              >
                {plans.slice(1).map((plan) => (
                  <div
                    key={plan.name}
                    className={`group p-4 rounded-xl border transition-all duration-300 cursor-pointer hover:border-white/20 ${
                      plan.popular
                        ? 'bg-white/[0.03] border-white/[0.12]'
                        : 'bg-white/[0.01] border-white/[0.06]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {plan.popular ? (
                          <Zap size={14} className="text-yellow-400" />
                        ) : (
                          <Crown size={14} className="text-purple-400" />
                        )}
                        <span className="text-sm font-semibold text-white">{plan.name}</span>
                        {plan.popular && (
                          <span className="px-2 py-0.5 text-[10px] font-medium bg-yellow-400/10 text-yellow-400 rounded-full">
                            Popular
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="text-lg font-bold text-white">${plan.price}</span>
                        <span className="text-white/30 text-xs">/mo</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {plan.features.slice(0, 2).map((feature) => (
                        <span
                          key={feature}
                          className="text-[11px] text-white/40 px-2 py-1 bg-white/[0.03] rounded-md"
                        >
                          {feature}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer */}
              <p
                className={`text-center text-white/20 text-[11px] mt-6 transition-all duration-500 ${
                  isVisible ? 'opacity-100' : 'opacity-0'
                }`}
                style={{ transitionDelay: '0.4s' }}
              >
                No credit card required · Cancel anytime
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WelcomeCreditBonusModal;
