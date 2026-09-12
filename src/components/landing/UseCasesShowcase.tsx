import React, { useState, useRef, useEffect, useCallback } from 'react';

/* ─── Use case data ─── */

const USE_CASES = [
  {
    id: 'image-gen',
    title: 'AI Image Generation',
    desc: 'Generate images with a simple text description. Control compositions with 20+ models, native 4K, 1000+ styles, image prompts, and style transfer — all through one unified interface.',
    href: '/create/image',
    cta: 'Try Image Generation',
  },
  {
    id: 'video-gen',
    title: 'AI Video Generation',
    desc: 'Access all major AI video models — Kling, Hailuo, Wan, Runway, and more. Generate videos for social media, animate images, or add details to existing footage.',
    href: '/create/video',
    cta: 'Try Video Generation',
  },
  {
    id: 'upscale',
    title: 'Enhance & Upscale',
    desc: 'Upscale images up to 8K and video to 4K at 120fps. Make blurry photos razor-sharp, restore old footage, or add ultra-fine detail with multiple enhancement models.',
    href: '/create/enhance',
    cta: 'Try Enhancement',
  },
  {
    id: 'audio',
    title: 'Audio & Music',
    desc: 'Generate voice, music, and sound effects with AI. Create custom soundtracks, voice clones, and audio content through professional studio tools.',
    href: '/create/audio',
    cta: 'Try Audio Studio',
  },
  {
    id: 'threed',
    title: '3D Generation',
    desc: 'Create 3D models, textures, and environmental assets from text or images. From concept art to production-ready assets for games and visualization.',
    href: '/create/3d',
    cta: 'Try 3D Generation',
  },
  {
    id: 'workflows',
    title: 'Visual Workflows',
    desc: 'Build node-based AI pipelines that chain models together. Connect image generation, upscaling, editing, and more into reusable automated workflows.',
    href: '/workflows',
    cta: 'Try Workflows',
  },
  {
    id: 'chat',
    title: 'Chat with AI',
    desc: 'Conversational AI with GPT-4, Claude, Gemini, and Llama. Get answers, generate code, analyze documents, and brainstorm — all models accessible through one interface.',
    href: '/chat',
    cta: 'Try AI Chat',
  },
];

/* ─── Video progress bar ─── */

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="absolute top-1.5 right-1.5 left-1.5 z-20 h-1 overflow-hidden rounded-full bg-white/10">
      <div
        className="h-full rounded-full bg-white/60 transition-[width] ease-linear"
        style={{ width: `${progress}%`, transitionDuration: '100ms' }}
      />
    </div>
  );
}

/* ─── Main component ─── */

const UseCasesShowcase: React.FC = () => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [autoRotate, setAutoRotate] = useState(true);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const ROTATE_INTERVAL = 6000; // ms per item

  // Auto-rotate through items
  useEffect(() => {
    if (!autoRotate) return;

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const p = ((elapsed % ROTATE_INTERVAL) / ROTATE_INTERVAL) * 100;
      setProgress(p);
    }, 50);

    const rotateTimer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % USE_CASES.length);
    }, ROTATE_INTERVAL);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      clearInterval(rotateTimer);
    };
  }, [autoRotate, activeIndex]);

  const handleItemClick = useCallback((index: number) => {
    setActiveIndex(index);
    setAutoRotate(false);
    setProgress(0);
    // Resume auto-rotate after 15s of inactivity
    setTimeout(() => setAutoRotate(true), 15000);
  }, []);

  const activeItem = USE_CASES[activeIndex];

  return (
    <section className="relative py-24 md:py-40 px-4 lg:px-6 bg-[#08080a] overflow-hidden">
      <div className="max-w-[1920px] mx-auto">
        {/* Header */}
        <div className="mb-3">
          <span className="text-white/30 text-sm font-medium tracking-[0.2em] uppercase">Use cases</span>
        </div>
        <h2 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight max-w-3xl mb-11 leading-snug">
          Generate and edit high quality images, videos, audio, and 3D objects with AI
        </h2>

        {/* Two-column layout */}
        <div className="flex flex-col-reverse items-end gap-8 lg:flex-row">
          {/* Left: scrollable list */}
          <div className="relative z-0 flex-1 w-full">
            <ul className="space-y-3 lg:max-h-[42rem] lg:overflow-y-auto no-scrollbar">
              {USE_CASES.map((item, i) => {
                const isActive = i === activeIndex;
                return (
                  <li key={item.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleItemClick(i)}
                      onKeyDown={(e) => e.key === 'Enter' && handleItemClick(i)}
                      className={`flex flex-col gap-2.5 w-full cursor-pointer rounded-xl p-5 text-left transition duration-300 ease-out select-none ${
                        isActive
                          ? 'bg-white/[0.04] text-white/60'
                          : 'text-white/30 hover:text-white/50 active:scale-[0.98]'
                      }`}
                    >
                      <h3
                        className={`text-2xl font-semibold text-white transition-opacity duration-300 ease-out ${
                          isActive ? 'opacity-100' : 'opacity-35 group-hover:opacity-100'
                        }`}
                      >
                        {item.title}
                      </h3>
                      <p className="text-sm leading-[1.4em] font-normal">{item.desc}</p>

                      {/* CTA button - visible only for active item */}
                      <div
                        className="mt-3 w-fit transition-all duration-300 ease-out overflow-hidden"
                        style={{
                          maxHeight: isActive ? '3rem' : '0px',
                          opacity: isActive ? 1 : 0,
                          transform: isActive ? 'scale(1)' : 'scale(0.95)',
                        }}
                      >
                        <a
                          href={item.href}
                          className="flex items-center justify-center rounded-md px-5 py-3 text-sm bg-white text-[#08080a] font-medium hover:bg-white/90 transition-colors"
                        >
                          {item.cta}
                        </a>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Scroll fade gradients */}
            <div className="pointer-events-none absolute top-0 right-0 -left-4 z-10 hidden h-14 bg-gradient-to-b from-[#08080a] to-transparent transition-opacity duration-200 lg:block opacity-0" />
            <div className="pointer-events-none absolute right-0 bottom-0 -left-4 z-10 hidden h-14 bg-gradient-to-t from-[#08080a] to-transparent transition-opacity duration-200 lg:block opacity-100" />
          </div>

          {/* Right: preview panel */}
          <div className="sticky top-[60px] z-1 mb-auto w-full flex-1 lg:w-auto">
            <div className="bg-[#111113] relative aspect-video overflow-hidden rounded-lg border border-white/[0.06]">
              {/* Top gradient overlay */}
              <div
                className="absolute top-0 left-0 z-10 h-[25%] w-full"
                style={{ background: 'linear-gradient(rgba(30,30,30,0.5) 0%, rgba(0,0,0,0) 100%)' }}
              />

              {/* Progress bar */}
              {autoRotate && <ProgressBar progress={progress} />}

              {/* Preview content - crossfade */}
              <div className="relative z-0 h-full w-full flex flex-col items-center justify-center p-8 text-center">
                <div
                  key={activeItem.id}
                  className="flex flex-col items-center gap-4 animate-fade-in"
                >
                  {/* Icon placeholder */}
                  <div className="w-16 h-16 rounded-2xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path
                        d="M12 2L2 7L12 12L22 7L12 2Z"
                        stroke="white"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity="0.5"
                      />
                      <path
                        d="M2 17L12 22L22 17"
                        stroke="white"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity="0.3"
                      />
                      <path
                        d="M2 12L12 17L22 12"
                        stroke="white"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity="0.4"
                      />
                    </svg>
                  </div>
                  <span className="text-white text-2xl md:text-3xl font-semibold">
                    {activeItem.title}
                  </span>
                  <span className="text-white/40 text-sm md:text-base max-w-md">
                    {activeItem.desc}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.4s ease-out both;
        }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </section>
  );
};

export default UseCasesShowcase;
