import React, { useState } from 'react';

const GenerationSection: React.FC = () => {
  const [hoveredCard, setHoveredCard] = useState<string | null>(null);

  // Animated label component that shows dot -> line -> text on hover
  const AnimatedLabel = ({ label, isHovered }: { label: string; isHovered: boolean }) => (
    <div className="flex items-center gap-0 overflow-hidden">
      {/* Dot/line: hidden by default, appears and expands on hover */}
      <div
        className={`h-[6px] rounded-full bg-white/40 transition-all duration-300 ease-out ${
          isHovered ? 'w-8 opacity-100' : 'w-0 opacity-0'
        }`}
        style={{ transitionDelay: isHovered ? '0ms' : '100ms' }}
      />
      {/* Text: slides in after dot appears */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-out ${
          isHovered ? 'max-w-[200px] opacity-100 ml-2' : 'max-w-0 opacity-0 ml-0'
        }`}
        style={{ transitionDelay: isHovered ? '150ms' : '0ms' }}
      >
        <span className="text-sm font-medium text-white whitespace-nowrap">{label}</span>
      </div>
    </div>
  );

  return (
    <section className="relative py-32 px-6 lg:px-8 bg-[#08080a] overflow-hidden">
      {/* Section header - platform perspective */}
      <div className="max-w-[1200px] mx-auto mb-20">
        <div className="max-w-3xl">
          <p className="text-white/30 text-sm font-medium tracking-[0.2em] uppercase mb-6">
            Generation
          </p>
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-semibold text-white tracking-[-0.03em] leading-[1.05] mb-8">
            One prompt.
            <br />
            <span className="text-white/20">Every format.</span>
          </h2>
          <p className="text-xl text-white/40 leading-relaxed">
            Access the world's best AI models for image, video, audio, and 3D generation — unified in a single creative workspace.
          </p>
        </div>
      </div>

      {/* Bento grid */}
      <div className="max-w-[1200px] mx-auto">
        <div className="grid grid-cols-12 gap-4">

          {/* Large hero card - Image Generation */}
          <div
            className="col-span-12 lg:col-span-7 group cursor-pointer"
            onMouseEnter={() => setHoveredCard('image')}
            onMouseLeave={() => setHoveredCard(null)}
          >
            <div className={`h-full rounded-2xl border p-5 flex flex-col transition-all duration-300 ${hoveredCard === 'image' ? 'bg-[#0e0e10] border-white/[0.12]' : 'bg-[#0c0c0e] border-white/[0.06]'}`}>
              {/* Preview area with animated label */}
              <div className="flex-1 min-h-[280px] rounded-xl border border-white/[0.04] bg-white/[0.02] mb-4 p-4 flex flex-col justify-start">
                <AnimatedLabel label="Image Generation" isHovered={hoveredCard === 'image'} />
              </div>

              {/* Description */}
              <p className="text-white/35 text-sm leading-relaxed">
                Flux Pro, Stable Diffusion 3.5, DALL-E 3, Imagen 4, Recraft — one prompt, endless possibilities.
              </p>
            </div>
          </div>

          {/* Right column */}
          <div className="col-span-12 lg:col-span-5 flex flex-col gap-4">

            {/* Video Generation */}
            <div
              className="group cursor-pointer flex-1"
              onMouseEnter={() => setHoveredCard('video')}
              onMouseLeave={() => setHoveredCard(null)}
            >
              <div className={`h-full rounded-2xl border p-4 flex flex-col transition-all duration-300 ${hoveredCard === 'video' ? 'bg-[#0e0e10] border-white/[0.12]' : 'bg-[#0c0c0e] border-white/[0.06]'}`}>
                {/* Preview area with animated label */}
                <div className="flex-1 min-h-[120px] rounded-xl border border-white/[0.04] bg-white/[0.02] mb-3 p-3 flex flex-col justify-start">
                  <AnimatedLabel label="Video Generation" isHovered={hoveredCard === 'video'} />
                </div>

                {/* Description */}
                <p className="text-white/35 text-sm">Runway, Pika, Kling, Luma, Veo2</p>
              </div>
            </div>

            {/* Bottom row - Audio & 3D */}
            <div className="grid grid-cols-2 gap-4">

              {/* Audio Generation */}
              <div
                className="group cursor-pointer"
                onMouseEnter={() => setHoveredCard('audio')}
                onMouseLeave={() => setHoveredCard(null)}
              >
                <div className={`h-full rounded-2xl border p-4 flex flex-col transition-all duration-300 ${hoveredCard === 'audio' ? 'bg-[#0e0e10] border-white/[0.12]' : 'bg-[#0c0c0e] border-white/[0.06]'}`}>
                  {/* Preview area with animated label */}
                  <div className="flex-1 min-h-[80px] rounded-lg border border-white/[0.04] bg-white/[0.02] mb-3 p-3 flex flex-col justify-start">
                    <AnimatedLabel label="Audio" isHovered={hoveredCard === 'audio'} />
                  </div>

                  {/* Description */}
                  <p className="text-white/35 text-xs">Voice, music, SFX</p>
                </div>
              </div>

              {/* 3D Generation */}
              <div
                className="group cursor-pointer"
                onMouseEnter={() => setHoveredCard('3d')}
                onMouseLeave={() => setHoveredCard(null)}
              >
                <div className={`h-full rounded-2xl border p-4 flex flex-col transition-all duration-300 ${hoveredCard === '3d' ? 'bg-[#0e0e10] border-white/[0.12]' : 'bg-[#0c0c0e] border-white/[0.06]'}`}>
                  {/* Preview area with animated label */}
                  <div className="flex-1 min-h-[80px] rounded-lg border border-white/[0.04] bg-white/[0.02] mb-3 p-3 flex flex-col justify-start">
                    <AnimatedLabel label="3D" isHovered={hoveredCard === '3d'} />
                  </div>

                  {/* Description */}
                  <p className="text-white/35 text-xs">Objects & scenes</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Subtle background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-white/[0.008] rounded-full blur-[150px] pointer-events-none" />
    </section>
  );
};

export default GenerationSection;
