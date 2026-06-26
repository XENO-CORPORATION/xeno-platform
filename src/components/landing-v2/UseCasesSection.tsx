import React, { useState } from 'react';
import { ArrowRight, Play } from 'lucide-react';

interface UseCasesSectionProps {
  onGetStarted: () => void;
}

const UseCasesSection: React.FC<UseCasesSectionProps> = ({ onGetStarted }) => {
  const [activeCase, setActiveCase] = useState(0);

  const useCases = [
    {
      id: 0,
      category: 'Marketing',
      title: 'Create campaign assets visually',
      description: 'Generate ad variations, social assets, and marketing collateral using AI models connected in a visual workflow.',
      icon: '01',
      gradient: 'from-white/[0.03] via-transparent to-transparent',
    },
    {
      id: 1,
      category: 'Product Design',
      title: 'Explore concepts rapidly',
      description: 'Generate product shots, packaging concepts, and design variations. Iterate visually without switching tools.',
      icon: '02',
      gradient: 'from-white/[0.03] via-transparent to-transparent',
    },
    {
      id: 2,
      category: 'Content Creation',
      title: 'Produce visuals at scale',
      description: 'Create illustrations, thumbnails, and editorial visuals. Build reusable pipelines for consistent output.',
      icon: '03',
      gradient: 'from-white/[0.03] via-transparent to-transparent',
    },
    {
      id: 3,
      category: 'Game Development',
      title: 'Generate game assets',
      description: 'Create concept art, textures, sprites, and environmental assets with style control. From indie to studio scale.',
      icon: '04',
      gradient: 'from-white/[0.03] via-transparent to-transparent',
    },
  ];

  return (
    <section className="relative py-28 px-6 lg:px-8 bg-[#08080a]">
      <div className="max-w-[1200px] mx-auto">
        {/* Header */}
        <div className="mb-14">
          <p className="text-[13px] text-white/40 uppercase tracking-[0.15em] font-medium mb-4">
            Use Cases
          </p>
          <h2 className="text-[clamp(2rem,5vw,3.25rem)] font-semibold text-white tracking-[-0.02em] leading-[1.15] mb-5">
            Built for creators.
          </h2>
          <p className="text-[17px] text-white/40 leading-[1.7] max-w-lg">
            Whether you're a solo creator or part of a team, Xeno adapts to your workflow.
          </p>
        </div>

        {/* Use cases grid */}
        <div className="grid md:grid-cols-2 gap-4">
          {useCases.map((useCase, index) => (
            <button
              key={useCase.id}
              onClick={() => setActiveCase(index)}
              className={`group relative text-left p-8 md:p-10 rounded-2xl border transition-all duration-500 overflow-hidden ${
                activeCase === index 
                  ? 'bg-white/[0.03] border-white/[0.1]' 
                  : 'bg-transparent border-white/[0.04] hover:border-white/[0.08] hover:bg-white/[0.01]'
              }`}
            >
              {/* Background gradient */}
              <div className={`absolute inset-0 bg-gradient-to-br ${useCase.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-500`} />
              
              <div className="relative z-10">
                {/* Category badge */}
                <span className="inline-block px-3 py-1 text-xs text-white/50 bg-white/[0.04] rounded-full border border-white/[0.06] mb-6">
                  {useCase.category}
                </span>
                
                {/* Title */}
                <h3 className="text-2xl md:text-3xl font-bold text-white mb-4 group-hover:text-white transition-colors">
                  {useCase.title}
                </h3>
                
                {/* Description */}
                <p className="text-white/50 leading-relaxed mb-8">
                  {useCase.description}
                </p>
                
                {/* Number and arrow */}
                <div className="flex items-end justify-between">
                  <div className="text-5xl md:text-6xl font-bold text-white/10 tracking-tight">
                    {useCase.icon}
                  </div>
                  
                  <div className={`w-12 h-12 rounded-full border flex items-center justify-center transition-all duration-300 ${
                    activeCase === index 
                      ? 'border-white/20 bg-white/5' 
                      : 'border-white/10 group-hover:border-white/20'
                  }`}>
                    <ArrowRight size={18} className="text-white/60 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* CTA */}
        <div className="text-center mt-16">
          <button
            onClick={onGetStarted}
            className="inline-flex items-center gap-3 px-8 py-4 bg-white text-black font-medium rounded-xl hover:bg-white/90 transition-all hover:scale-[1.02]"
          >
            <span>Start your project</span>
            <ArrowRight size={18} />
          </button>
        </div>
      </div>
    </section>
  );
};

export default UseCasesSection;
