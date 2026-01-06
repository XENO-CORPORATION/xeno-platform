import React from 'react';
import { ArrowRight } from 'lucide-react';

interface CTASectionProps {
  onGetStarted: () => void;
}

const CTASection: React.FC<CTASectionProps> = ({ onGetStarted }) => {
  return (
    <section className="relative py-28 px-6 lg:px-8 bg-[#08080a] overflow-hidden">
      <div className="absolute inset-0">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-white/[0.02] rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-[700px] mx-auto text-center">
        <h2 className="text-[clamp(2rem,5vw,3.5rem)] font-semibold text-white tracking-[-0.02em] leading-[1.1] mb-6">
          Start building today.
        </h2>

        <p className="text-[17px] text-white/40 leading-[1.7] mb-10">
          Create with AI in a visual workspace. 
          Free to start, no credit card required.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <button
            onClick={onGetStarted}
            className="group px-7 py-3.5 bg-white text-[#0a0a0a] text-[15px] font-semibold rounded-full transition-all duration-200 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.2),0_4px_24px_rgba(255,255,255,0.12)] hover:scale-[1.02] flex items-center gap-2"
          >
            Get Started — Free
            <ArrowRight size={16} strokeWidth={2.5} className="group-hover:translate-x-0.5 transition-transform" />
          </button>
          
          <button className="px-6 py-3.5 text-white/50 text-[15px] font-medium hover:text-white/80 transition-colors">
            Talk to Sales
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-6 mt-12 pt-10 border-t border-white/[0.06]">
          {['Free tier available', 'No credit card', 'Cancel anytime'].map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-[13px] text-white/35">
              <div className="w-1 h-1 rounded-full bg-white/35" />
              {item}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default CTASection;
