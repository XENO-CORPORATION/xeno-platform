import React, { useEffect, useRef, useState } from 'react';

interface HeroSectionProps {
  onGetStarted: () => void;
}

const HeroSection: React.FC<HeroSectionProps> = ({ onGetStarted }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, []);

  return (
    <section
      ref={heroRef}
      className="relative w-screen h-screen overflow-hidden bg-[#08080a]"
    >
      {/* Background layers */}
      <div className="absolute inset-0">
        {/* Fallback image */}
        <img
          src="/hero-bg.jpg"
          alt=""
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${videoLoaded ? 'opacity-0' : 'opacity-[0.15]'}`}
        />

        {/* Video background */}
        <video
          ref={videoRef}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-1000 ${videoLoaded ? 'opacity-[0.15]' : 'opacity-0'}`}
          autoPlay
          muted
          loop
          playsInline
          onLoadedData={() => setVideoLoaded(true)}
          onEnded={(e) => {
            const video = e.currentTarget;
            video.currentTime = 0;
            video.play();
          }}
          poster="/hero-bg.jpg"
        >
          <source src="/hero-bg.mp4" type="video/mp4" />
        </video>

        {/* Dark overlay for better text contrast */}
        <div className="absolute inset-0 bg-[#08080a]/60" />

        {/* Vignette */}
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse 70% 70% at 50% 50%, transparent 0%, #08080a 100%)',
          }}
        />
      </div>

      {/* Main content - centered with viewport units */}
      <div
        className={`relative z-10 w-full h-full flex flex-col items-center justify-center transition-all duration-1000 ${
          isVisible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        {/* Badge */}
        <div
          className={`mb-[3vh] transition-all duration-700 delay-100 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
        >
          <div className="inline-flex items-center gap-[0.6vw] px-[1.2vw] py-[0.6vh] rounded-full bg-white/[0.04] border border-white/[0.08]">
            <div className="w-[0.5vw] h-[0.5vw] min-w-[6px] min-h-[6px] rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[min(1.4vw,14px)] text-white/70 font-medium whitespace-nowrap">
              Now in Public Beta
            </span>
          </div>
        </div>

        {/* Headline */}
        <h1
          className={`text-center font-semibold tracking-[-0.03em] text-white leading-[1.1] mb-[3vh] transition-all duration-700 delay-200 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
          style={{ fontSize: 'clamp(2rem, 6vw, 5.5rem)' }}
        >
          The AI-native<br />
          <span className="text-white/30">creative studio</span>
        </h1>

        {/* Subheadline */}
        <p
          className={`text-center text-white/45 leading-[1.6] mb-[4vh] max-w-[45vw] transition-all duration-700 delay-300 ${
            isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
          }`}
          style={{ fontSize: 'clamp(0.95rem, 1.3vw, 1.25rem)' }}
        >
          Generate, edit, and produce across image, video, audio, and 3D—all from one visual workspace.
          Professional tools, powered by the best AI models.
        </p>



        {/* Bottom section - value props */}
        <div
          className={`absolute left-0 right-0 transition-all duration-700 delay-500 ${
            isVisible ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ bottom: '5vh' }}
        >
          <div className="flex items-center justify-center gap-[4vw]">
            {[
              'Multi-modal generation',
              'Visual workflows',
              'Cloud OS',
            ].map((prop, i) => (
              <div
                key={prop}
                className="flex items-center gap-[0.6vw]"
                style={{
                  opacity: isVisible ? 1 : 0,
                  transitionDelay: `${600 + i * 100}ms`,
                  transition: 'opacity 0.5s ease-out'
                }}
              >
                <div className="w-[0.35vw] h-[0.35vw] min-w-[4px] min-h-[4px] rounded-full bg-white/30" />
                <span
                  className="text-white/35 font-medium whitespace-nowrap"
                  style={{ fontSize: 'clamp(0.7rem, 0.85vw, 0.85rem)' }}
                >
                  {prop}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
