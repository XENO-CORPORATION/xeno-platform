import React, { useEffect, useRef, useState } from 'react';

interface HeroSectionProps {
  onGetStarted: () => void;
}

const LIVE_SURFACES = [
  'Runs in any modern browser',
  'No install, no local setup',
  'Projects sync across devices',
  'One URL for every suite',
];

const HeroSection: React.FC<HeroSectionProps> = ({ onGetStarted }) => {
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [sequenceStep, setSequenceStep] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const timers = [120, 250, 420, 590, 760, 940].map((delay, index) =>
      setTimeout(() => setSequenceStep(index + 1), delay)
    );

    return () => timers.forEach((timer) => clearTimeout(timer));
  }, []);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, []);

  const scrollToPlatform = () => {
    const features = document.getElementById('features');
    if (features) {
      features.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const revealClass = (step: number, hiddenTransform = 'translate-y-6') =>
    sequenceStep >= step ? 'translate-y-0 opacity-100' : `${hiddenTransform} opacity-0`;

  return (
    <section className="relative w-full overflow-hidden bg-[#08080a] min-h-[100svh] lg:h-[100svh]">
      <div className="absolute inset-0">
        <img
          src="/hero-bg.jpg"
          alt=""
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${
            videoLoaded ? 'opacity-0' : 'opacity-[0.24]'
          }`}
        />

        <video
          ref={videoRef}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${
            videoLoaded ? 'opacity-[0.28]' : 'opacity-0'
          }`}
          autoPlay
          muted
          loop
          playsInline
          onLoadedData={() => setVideoLoaded(true)}
          onEnded={(event) => {
            const video = event.currentTarget;
            video.currentTime = 0;
            video.play();
          }}
          poster="/hero-bg.jpg"
        >
          <source src="/hero-bg.mp4" type="video/mp4" />
        </video>

        <div className="absolute inset-0 bg-[#08080a]/62" />
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 70% 72% at 50% 30%, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.04) 24%, rgba(8,8,10,0.78) 58%, #08080a 100%)',
          }}
        />
        <div className="hero-glow absolute -left-[16vw] top-[6vh] h-[30vw] w-[30vw] rounded-full bg-white/[0.06] blur-[130px]" />
        <div className="hero-glow-delayed absolute -right-[16vw] bottom-[2vh] h-[28vw] w-[28vw] rounded-full bg-white/[0.04] blur-[120px]" />
      </div>

      <div className="relative z-10 flex h-full w-full items-center justify-center px-2 pb-5 pt-24 sm:px-4 lg:px-6 lg:pb-8 lg:pt-28 xl:px-7">
        <div className="max-w-[920px] text-center">
            <div
              className={`inline-flex items-center gap-2 rounded-full border border-white/[0.14] bg-white/[0.05] px-3.5 py-1.5 text-[11px] uppercase tracking-[0.14em] text-white/74 transition-all duration-700 ${revealClass(1, 'translate-y-4')}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Browser Creative OS
            </div>

            <h1
              className={`mt-5 text-balance text-[clamp(2.1rem,5.8vw,5.2rem)] font-semibold leading-[0.92] tracking-[-0.03em] text-white transition-all duration-700 ${revealClass(2)}`}
            >
              Create studio-grade work.
              <span className="block text-white/38">Directly in your browser.</span>
            </h1>

            <p
              className={`mx-auto mt-5 max-w-[620px] text-[clamp(0.96rem,1.05vw,1.1rem)] leading-[1.62] text-white/60 transition-all duration-700 ${revealClass(3)}`}
            >
              Xeno unifies Studio, Tools, Office, and Corpo on one cloud URL. Live today:
              Xeno Gen Image, Xeno Gen Video, and Background Removal, all inside HUB, AGENT,
              and CODE without downloads.
            </p>

            <div className={`mt-7 flex flex-wrap items-center justify-center gap-3 transition-all duration-700 ${revealClass(4)}`}>
              <button
                onClick={onGetStarted}
                className="group inline-flex items-center rounded-full bg-white px-7 py-3 text-sm font-semibold text-[#08080a] transition-all duration-200 hover:scale-[1.02] hover:bg-white/90"
              >
                Enter Xeno Hub
                <span className="ml-2 transition-transform duration-200 group-hover:translate-x-0.5">{'->'}</span>
              </button>

              <button
                onClick={scrollToPlatform}
                className="rounded-full border border-white/[0.16] bg-white/[0.04] px-6 py-3 text-sm font-medium text-white/76 transition-colors hover:border-white/[0.25] hover:text-white"
              >
                Explore Platform
              </button>
            </div>

            <div className={`mt-5 flex flex-wrap justify-center gap-2 transition-all duration-700 ${revealClass(5)}`}>
              {LIVE_SURFACES.map((surface) => (
                <span
                  key={surface}
                  className="rounded-full border border-white/[0.14] bg-black/24 px-3 py-1.5 text-[10px] font-medium text-white/66"
                >
                  {surface}
                </span>
              ))}
            </div>
        </div>
      </div>

      <style>{`
        @keyframes heroGlow {
          0%, 100% { opacity: 0.52; transform: scale(1); }
          50% { opacity: 0.82; transform: scale(1.08); }
        }
        .hero-glow {
          animation: heroGlow 8s ease-in-out infinite;
        }
        .hero-glow-delayed {
          animation: heroGlow 11s ease-in-out infinite;
          animation-delay: 1.6s;
        }
      `}</style>
    </section>
  );
};

export default HeroSection;
