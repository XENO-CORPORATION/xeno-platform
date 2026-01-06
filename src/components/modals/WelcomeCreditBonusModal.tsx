import React, { useState, useEffect } from 'react';
import { Gift, X, ArrowRight, Sparkles, Check } from 'lucide-react';
import { authService } from '../../services/authService';

interface WelcomeCreditBonusModalProps {
  isOpen: boolean;
  onClose: () => void;
  onClaim: () => void;
}

// Key to track if modal has been shown this session
const MODAL_SHOWN_KEY = 'xeno_welcome_bonus_modal_shown';

const WelcomeCreditBonusModal: React.FC<WelcomeCreditBonusModalProps> = ({
  isOpen,
  onClose,
  onClaim,
}) => {
  const [isClaiming, setIsClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);

  // Check if we should show the modal (only once per session)
  useEffect(() => {
    if (isOpen) {
      const alreadyShown = sessionStorage.getItem(MODAL_SHOWN_KEY);
      if (alreadyShown) {
        // Already shown this session, close immediately
        onClose();
        return;
      }
      // Mark as shown for this session
      sessionStorage.setItem(MODAL_SHOWN_KEY, 'true');
      setShouldRender(true);
      // Delay visibility for entrance animation
      const timer = setTimeout(() => setIsVisible(true), 50);
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
      const timer = setTimeout(() => setShouldRender(false), 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen, onClose]);

  if (!shouldRender) return null;

  const handleClaim = async () => {
    setIsClaiming(true);
    setError(null);

    try {
      const result = await authService.claimBonusCredits();

      if (result.success) {
        onClaim();
        handleClose();
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
    setTimeout(() => {
      onClose();
    }, 200);
  };

  const features = [
    { name: 'Image Generation', icon: '✦' },
    { name: 'Video Creation', icon: '✦' },
    { name: 'AI Chat', icon: '✦' },
    { name: 'Content Tools', icon: '✦' },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center font-['Inter',sans-serif]">
      {/* Backdrop */}
      <div
        className={`absolute inset-0 bg-[#08080a]/80 backdrop-blur-xl transition-opacity duration-300 ${
          isVisible ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={handleClose}
      />

      {/* Modal */}
      <div
        className={`relative w-full max-w-[380px] mx-4 transition-all duration-300 ${
          isVisible ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-4'
        }`}
      >
        {/* Card */}
        <div className="relative rounded-2xl border border-white/[0.08] bg-[#0c0c0e] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.8)]">
          {/* Subtle gradient overlay */}
          <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
            <div
              className="absolute inset-0 opacity-[0.03]"
              style={{
                background: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 50%)',
              }}
            />
            {/* Top glow */}
            <div
              className="absolute -top-32 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full opacity-[0.08]"
              style={{
                background: 'radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%)',
              }}
            />
          </div>

          {/* Close button */}
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 z-10 p-2 text-white/30 hover:text-white/60 hover:bg-white/[0.05] rounded-lg transition-all"
          >
            <X size={18} />
          </button>

          {/* Content */}
          <div className="relative p-8 pt-10">
            {/* Icon */}
            <div className="flex justify-center mb-6">
              <div className="relative">
                <div className="p-4 bg-white/[0.03] border border-white/[0.08] rounded-2xl">
                  <Gift className="text-white" size={28} />
                </div>
                <div className="absolute -top-1 -right-1 p-1 bg-[#0c0c0e] rounded-full">
                  <Sparkles className="text-white/60" size={12} />
                </div>
              </div>
            </div>

            {/* Title */}
            <div className="text-center mb-8">
              <h2 className="text-xl font-semibold text-white tracking-tight mb-2">
                Welcome to Xeno
              </h2>
              <p className="text-white/40 text-[14px] leading-relaxed">
                Claim your free credits to start creating with AI
              </p>
            </div>

            {/* Credits display */}
            <div className="relative mb-8">
              <div className="bg-white/[0.02] border border-white/[0.06] rounded-xl p-6">
                <div className="text-center mb-6">
                  <div className="text-4xl font-light text-white tracking-tight mb-1">
                    1,000
                  </div>
                  <div className="text-white/30 text-[11px] uppercase tracking-[0.2em] font-medium">
                    Free Credits
                  </div>
                </div>

                {/* Features grid */}
                <div className="grid grid-cols-2 gap-2">
                  {features.map((feature) => (
                    <div
                      key={feature.name}
                      className="flex items-center gap-2 px-3 py-2 bg-white/[0.02] rounded-lg"
                    >
                      <Check size={12} className="text-white/40" />
                      <span className="text-white/50 text-[12px]">{feature.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                <p className="text-red-400 text-[13px] text-center">{error}</p>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={handleClose}
                disabled={isClaiming}
                className="flex-1 px-4 py-3 text-white/40 text-[13px] font-medium hover:text-white/60 hover:bg-white/[0.03] rounded-xl border border-transparent hover:border-white/[0.06] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Maybe Later
              </button>

              <button
                onClick={handleClaim}
                disabled={isClaiming}
                className="flex-1 px-4 py-3 bg-white text-[#08080a] text-[13px] font-semibold rounded-xl flex items-center justify-center gap-2 hover:bg-white/90 hover:shadow-[0_0_30px_rgba(255,255,255,0.1)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isClaiming ? (
                  <div className="w-4 h-4 border-2 border-[#08080a]/20 border-t-[#08080a] rounded-full animate-spin" />
                ) : (
                  <>
                    Claim Credits
                    <ArrowRight size={14} strokeWidth={2.5} />
                  </>
                )}
              </button>
            </div>

            {/* Footer */}
            <p className="text-center text-white/20 text-[11px] mt-6">
              No expiration • No payment required
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WelcomeCreditBonusModal;
