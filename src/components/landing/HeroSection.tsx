import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, useScroll, useTransform, useMotionValue } from 'framer-motion';

/* ─── Grid items with animation wave + hover labels ─── */

const GRID_ITEMS: { src: string; area: string; wave: number; label: string; tag: string }[] = [
  { src: '/hero-assets/hero-workspace.jpg',    area: 'ws', wave: 1, label: 'AI Workspace',     tag: 'Node Editor' },
  { src: '/hero-assets/hero-neural.jpg',       area: 'nr', wave: 1, label: 'Neural Art',        tag: 'Image Gen' },
  { src: '/hero-assets/hero-portrait.jpg',     area: 'pt', wave: 1, label: 'Portrait Studio',   tag: 'Face AI' },
  { src: '/hero-assets/hero-fluid.jpg',        area: 'fl', wave: 2, label: 'Fluid Dynamics',    tag: 'Simulation' },
  { src: '/hero-assets/hero-abstract.webp',    area: 'ab', wave: 0, label: 'Abstract Forms',    tag: 'Generative' },
  { src: '/hero-assets/hero-architecture.jpg', area: 'ar', wave: 0, label: 'Architecture',      tag: '3D Render' },
  { src: '/hero-assets/hero-portrait.webp',    area: 'pw', wave: 2, label: 'Character Design',  tag: 'Stylize' },
  { src: '/hero-assets/hero-nature.webp',      area: 'nt', wave: 2, label: 'Nature Scenes',     tag: 'Landscape' },
  { src: '/hero-assets/hero-city.webp',        area: 'ct', wave: 1, label: 'Cityscapes',        tag: 'Environment' },
  { src: '/hero-assets/hero-ui.webp',          area: 'ui', wave: 2, label: 'UI Generation',     tag: 'Design' },
];

/* ─── Hook ─── */

function useEntryAnimation() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReduced) {
      ref.current?.classList.add('hero-visible');
      return;
    }

    requestAnimationFrame(() => {
      ref.current?.classList.add('hero-visible');
    });
  }, []);

  return ref;
}

/* ─── Reduced motion hook ─── */

function useReducedMotion() {
  const ref = useRef(false);
  useEffect(() => {
    ref.current =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }, []);
  return ref;
}

/* ─── Scroll Sequence Words ─── */

const SEQUENCE_WORDS = ['EXPLORE', 'CREATE', 'INNOVATE'] as const;

const SECTION_DATA: Record<string, { items: { label: string; desc: string }[] }> = {
  EXPLORE: {
    items: [
      { label: 'Chat with AI',    desc: 'Conversational AI with LLMs and voice' },
      { label: 'Office Suite',     desc: 'PDF, Word, Spreadsheets, Presentations' },
      { label: 'Search',           desc: 'General, Finance & Shopping search' },
      { label: 'Canvas Planning',  desc: 'Visual planning & whiteboarding' },
    ],
  },
  CREATE: {
    items: [
      { label: 'Image Generation', desc: 'AI image synthesis & inpainting' },
      { label: 'Video Generation', desc: 'AI video creation & editing' },
      { label: 'Audio & Music',    desc: 'AI audio generation & studio' },
      { label: '3D Generation',    desc: '3D model and asset creation' },
      { label: 'Enhance & Upscale',desc: 'Image & video quality enhancement' },
      { label: 'Studio Tools',     desc: 'Image, video & audio editing suites' },
      { label: 'Converters',       desc: 'File conversion & compression' },
    ],
  },
  INNOVATE: {
    items: [
      { label: 'AI Workflows',     desc: 'Node-based agentic workflow labs' },
      { label: 'Studio Interfaces',desc: 'Professional editing environments' },
      { label: 'Xeno OS',          desc: 'Full desktop OS environment' },
      { label: 'Collaboration',    desc: 'Real-time shared sessions' },
      { label: 'Content Creation', desc: 'YouTube, TikTok management & scheduling' },
    ],
  },
};

// Each word occupies a slice of the 0–1 scroll progress
// Expanded ranges for 800vh runway to give sub-items enough scroll room
const WORD_RANGES: [number, number][] = [
  [0.10, 0.32], // EXPLORE (starts after hero fully fades at 6%)
  [0.32, 0.57], // CREATE
  [0.57, 0.82], // INNOVATE
];

/* ─── Single word + sub-items + 16:9 container phase ─── */

function WordPhase({
  word,
  range,
  scrollYProgress,
  showGhost = false,
}: {
  word: string;
  range: [number, number];
  scrollYProgress: import('framer-motion').MotionValue<number>;
  showGhost?: boolean;
}) {
  const [start, end] = range;
  const span = end - start;
  const items = SECTION_DATA[word]?.items ?? [];

  // Refs to measure actual DOM positions for precise word landing
  const wordRef = useRef<HTMLSpanElement>(null);
  const landingRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0, scale: 1 });

  // Measure where the word needs to land: left-aligned with the landing ref,
  // bottom edge sitting right above the divider line.
  // The word element starts centered in viewport (via flex). With transformOrigin
  // 'left top', the top-left corner is the anchor point for scale + translate.
  // So at rest: top-left corner is at (centerX - width/2, centerY - height/2).
  // We need that corner to move to (landingLeft, landingTop - scaledHeight).
  useEffect(() => {
    const measure = () => {
      const wordEl = wordRef.current;
      const landingEl = landingRef.current;
      if (!wordEl || !landingEl) return;

      const wordRect = wordEl.getBoundingClientRect();
      const landingRect = landingEl.getBoundingClientRect();

      // The word's top-left corner position (its anchor since transformOrigin is left top)
      const wordLeft = wordRect.left;
      const wordTop = wordRect.top;

      // Scale word to fit the sidebar width (280px)
      const targetScale = Math.max(0.44, 480 / wordRect.width);

      // Word's left edge pushed further left from the sidebar,
      // Word's TOP edge aligns with landing's top (top of sidebar column, beside the panel)
      const targetLeft = landingRect.left - 320;
      const targetTop = landingRect.top - 100;

      setOffset({
        x: targetLeft - wordLeft,
        y: targetTop - wordTop,
        scale: targetScale,
      });
    };

    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Sub-ranges within this word's range (adjusted for sub-item scroll)
  const fadeInEnd   = start + span * 0.15;  // 0-15%: word fades in centered
  const slideEnd    = start + span * 0.30;  // 15-30%: word slides to top-left
  const subStart    = start + span * 0.30;  // 30%: sub-item scroll begins
  const subEnd      = start + span * 0.85;  // 85%: sub-item scroll ends
  const fadeOutStart = start + span * 0.85; // 85-100%: everything fades out

  // Ghost word (bg-colored) appears earlier than the white word
  const ghostEarlyStart = 0.03;
  const ghostOpacity = useTransform(
    scrollYProgress,
    [ghostEarlyStart, ghostEarlyStart + span * 0.08, start + span * 0.10, fadeInEnd],
    [0, 1, 1, 0],
  );

  // Word opacity: fade in 0→1, hold through sub-items, fade out 1→0
  const wordOpacity = useTransform(
    scrollYProgress,
    [start, fadeInEnd, fadeOutStart, end],
    [0, 1, 1, 0],
  );

  // Word starts centered, big font, wide letter spacing.
  // Animates to measured landing position (top of divider, left of panel).
  const wordX = useTransform(
    scrollYProgress,
    [start, fadeInEnd, slideEnd],
    [0, 0, offset.x],
  );
  const wordY = useTransform(
    scrollYProgress,
    [start, fadeInEnd, slideEnd],
    [0, 0, offset.y],
  );
  const wordScale = useTransform(
    scrollYProgress,
    [start, fadeInEnd, slideEnd],
    [1, 1, offset.scale],
  );
  const wordLetterSpacing = useTransform(
    scrollYProgress,
    [start, fadeInEnd, slideEnd],
    ['0.4em', '0.4em', '0.05em'],
  );

  // Sidebar + panel fade in as word settles, fade out at end
  const sidebarOpacity = useTransform(
    scrollYProgress,
    [fadeInEnd, slideEnd, fadeOutStart, end],
    [0, 1, 1, 0],
  );

  // Active sub-item index: derived from progress within the sub-item scroll range
  // Maps subStart→subEnd to 0→items.length, then floor-clamped
  const activeIndexRaw = useTransform(
    scrollYProgress,
    [subStart, subEnd],
    [0, items.length],
  );

  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const unsubscribe = activeIndexRaw.on('change', (v) => {
      const clamped = Math.max(0, Math.min(items.length - 1, Math.floor(v)));
      setActiveIndex(clamped);
    });
    return unsubscribe;
  }, [activeIndexRaw, items.length]);

  // Per-item opacity for crossfade in the 16:9 panel
  const itemOpacities = items.map((_, i) => {
    const itemStart = subStart + ((subEnd - subStart) / items.length) * i;
    const itemEnd   = subStart + ((subEnd - subStart) / items.length) * (i + 1);
    const fadeIn    = itemStart;
    const fadeInDone = itemStart + (itemEnd - itemStart) * 0.15;
    const fadeOutBegin = itemEnd - (itemEnd - itemStart) * 0.15;
    const fadeOut   = itemEnd;

    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useTransform(
      scrollYProgress,
      [fadeIn, fadeInDone, fadeOutBegin, fadeOut],
      [0, 1, 1, 0],
    );
  });

  return (
    <>
    {/* Ghost word — bg-colored, appears before the white word (EXPLORE only) */}
    {showGhost && (
      <motion.div
        className="absolute inset-0 flex items-center justify-center pointer-events-none"
        style={{ opacity: ghostOpacity }}
      >
        <motion.span
          className="absolute font-bold uppercase whitespace-nowrap"
          style={{
            fontSize: 'clamp(5rem, 14vw, 12rem)',
            color: 'rgba(255,255,255,0.08)',
            letterSpacing: wordLetterSpacing,
            scale: wordScale,
            x: wordX,
            y: wordY,
            transformOrigin: 'left top',
          }}
        >
          {word}
        </motion.span>
      </motion.div>
    )}

    <motion.div
      className="absolute inset-0 flex items-center justify-center"
      style={{ opacity: wordOpacity }}
    >
      {/* Word — absolutely positioned, starts centered/big, flies to measured landing spot */}
      <motion.span
        ref={wordRef}
        className="absolute font-bold uppercase text-white whitespace-nowrap"
        style={{
          fontSize: 'clamp(5rem, 14vw, 12rem)',
          letterSpacing: wordLetterSpacing,
          scale: wordScale,
          x: wordX,
          y: wordY,
          transformOrigin: 'left top',
        }}
      >
        {word}
      </motion.span>

      {/* Layout container: sidebar + panel, centered in viewport */}
      <motion.div
        className="absolute inset-0 flex items-center justify-center"
        style={{ opacity: sidebarOpacity, paddingLeft: '190px' }}
      >
        <div
          className="relative"
          style={{ width: '90vw', maxWidth: '1400px', height: '60vh', background: 'rgba(255,0,0,0.1)' }}
        >
          {/* Left column: word landing zone + divider + sub-item list — absolutely positioned */}
          <div className="absolute flex flex-col" style={{ width: '240px', left: '0px', top: '80px', background: 'rgba(0,255,0,0.15)' }}>
            {/* Landing target — word flies here, then divider + items below */}
            <div ref={landingRef} style={{ height: '8px' }} />
            {/* Horizontal divider */}
            <div className="h-px w-full bg-white/20 mb-4" />

            {/* Item list */}
            <div className="flex flex-col gap-1.5">
              {items.map((item, i) => (
                <div
                  key={item.label}
                  className="flex items-center gap-2 transition-all duration-300"
                  style={{
                    opacity: i === activeIndex ? 1 : 0.3,
                  }}
                >
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 transition-all duration-300"
                    style={{
                      backgroundColor: i === activeIndex ? 'white' : 'transparent',
                    }}
                  />
                  <span className="text-white text-sm font-medium truncate">
                    {item.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 16:9 panel — absolutely positioned, independent of left column */}
          <div className="absolute rounded-lg border border-white/10 overflow-hidden bg-red-500/30" style={{ left: '360px', right: '0px', top: '0px', bottom: '0px' }}>

            {/* Crossfading content layers */}
            {items.map((item, i) => (
              <motion.div
                key={item.label}
                className="absolute inset-0 flex flex-col items-center justify-center px-8"
                style={{ opacity: itemOpacities[i] }}
              >
                <span className="text-white text-2xl md:text-3xl font-semibold text-center">
                  {item.label}
                </span>
                <span className="mt-3 text-white/40 text-sm md:text-base text-center max-w-md">
                  {item.desc}
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>
    </motion.div>
    </>
  );
}

/* ─── Component ─── */

const WAVE_DELAY = [0, 350, 650];

function getScrollParent(el: HTMLElement): HTMLElement | Window {
  let parent = el.parentElement;
  while (parent) {
    const s = getComputedStyle(parent);
    if (/(auto|scroll)/.test(s.overflowY || s.overflow)) return parent;
    parent = parent.parentElement;
  }
  return window;
}

function useRunwayProgress(ref: React.RefObject<HTMLDivElement | null>) {
  const progress = useMotionValue(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const scrollTarget = getScrollParent(el);

    const onScroll = () => {
      const rect = el.getBoundingClientRect();
      const totalScroll = el.offsetHeight - window.innerHeight;
      const scrolled = -rect.top;
      const p = Math.max(0, Math.min(1, scrolled / Math.max(totalScroll, 1)));
      progress.set(p);
    };

    onScroll();
    scrollTarget.addEventListener('scroll', onScroll, { passive: true });
    return () => scrollTarget.removeEventListener('scroll', onScroll);
  }, [ref, progress]);

  return progress;
}

const HeroSection: React.FC = () => {
  const heroRef = useEntryAnimation();
  const reducedMotion = useReducedMotion();
  const runwayRef = useRef<HTMLDivElement>(null);
  const scrollYProgress = useRunwayProgress(runwayRef);

  // Hero grid fades out over 0–6% of runway scroll
  const heroOpacity = useTransform(scrollYProgress, [0, 0.06], [1, 0]);

  // Reduced motion: static fallback
  if (reducedMotion.current) {
    return (
      <>
        <section className="relative bg-[#08080a] overflow-hidden" style={{ height: 'calc(100svh - 46px)' }}>
          <div ref={heroRef} className="hero-mosaic absolute inset-0 p-1.5 sm:p-2 md:p-3">
            <div className="hero-grid h-full w-full gap-1.5 sm:gap-2 md:gap-2.5">
              {GRID_ITEMS.map((item) => (
                <HeroTile key={item.area} item={item} />
              ))}
            </div>
          </div>
        </section>
        <section className="bg-[#08080a]">
          {SEQUENCE_WORDS.map((word) => (
            <div key={word} className="flex items-center justify-center gap-12 px-8 py-24">
              <span className="font-bold uppercase tracking-tight text-white" style={{ fontSize: 'clamp(3rem, 6vw, 5rem)' }}>
                {word}
              </span>
              <div className="aspect-[16/9] w-full max-w-3xl rounded-2xl border border-white/10 bg-white/5" />
            </div>
          ))}
        </section>
        <HeroStyles />
        <XenoBrandMoment />
      </>
    );
  }

  return (
    <>
      {/* ═══ SCROLL RUNWAY — hero grid + word sequence in one sticky viewport ═══ */}
      <section ref={runwayRef} className="relative bg-[#08080a]" style={{ height: '800vh' }}>
        <div className="sticky w-full overflow-hidden" style={{ top: '46px', height: 'calc(100svh - 46px)' }}>

          {/* Layer 1: Word phases (behind the grid) */}
          {SEQUENCE_WORDS.map((word, i) => (
            <WordPhase
              key={word}
              word={word}
              range={WORD_RANGES[i]}
              scrollYProgress={scrollYProgress}
              showGhost={i === 0}
            />
          ))}

          {/* Layer 2: Hero grid (on top, fades out) */}
          <motion.div
            className="absolute inset-0 z-10"
            style={{ opacity: heroOpacity }}
          >
            <div
              ref={heroRef}
              className="hero-mosaic absolute inset-0 p-1.5 sm:p-2 md:p-3"
            >
              <div className="hero-grid h-full w-full gap-1.5 sm:gap-2 md:gap-2.5">
                {GRID_ITEMS.map((item) => (
                  <HeroTile key={item.area} item={item} />
                ))}
              </div>
            </div>

            {/* Bottom gradient */}
            <div
              className="pointer-events-none absolute bottom-0 left-0 right-0 h-24"
              style={{ background: 'linear-gradient(to top, #08080a 0%, transparent 100%)' }}
            />
          </motion.div>

        </div>
      </section>

      <HeroStyles />

      <XenoBrandMoment />
    </>
  );
};

/* ─── Hero Tile (extracted for reuse) ─── */

function HeroTile({ item }: { item: (typeof GRID_ITEMS)[number] }) {
  return (
    <div
      className="hero-tile hero-enter group relative overflow-hidden rounded-md md:rounded-lg cursor-pointer"
      style={{
        gridArea: item.area,
        transitionDelay: `${WAVE_DELAY[item.wave]}ms`,
      }}
    >
      <img
        src={item.src}
        alt=""
        loading={item.wave === 0 ? 'eager' : 'lazy'}
        className="h-full w-full object-cover grayscale opacity-50 transition-all duration-500 ease-out group-hover:scale-[1.05] group-hover:grayscale-0 group-hover:opacity-100"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <div className="absolute bottom-0 left-0 right-0 p-3 md:p-4 translate-y-4 opacity-0 transition-all duration-300 ease-out group-hover:translate-y-0 group-hover:opacity-100">
        <span className="inline-block rounded-full bg-white/10 backdrop-blur-sm px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-widest text-white/70 mb-1.5">
          {item.tag}
        </span>
        <p className="text-sm font-semibold text-white md:text-base">{item.label}</p>
      </div>
      <div className="absolute top-3 right-3 md:top-4 md:right-4 opacity-0 scale-75 transition-all duration-300 group-hover:opacity-100 group-hover:scale-100">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-white/10 backdrop-blur-sm">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 10L10 4M10 4H5M10 4V9" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </div>
  );
}

/* ─── XENO Brand Moment ─── */

function XenoBrandMoment() {
  return (
    <section className="relative overflow-hidden bg-[#08080a] px-6">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 50% 50%, rgba(255,255,255,0.03) 0%, transparent 70%)',
        }}
      />
      <div className="relative mx-auto flex min-h-[80vh] max-w-4xl flex-col items-center justify-center py-32 text-center">
        <span
          className="text-lg text-white/30"
          style={{ fontFamily: "'Playfair Display', serif", fontStyle: 'italic' }}
        >
          with
        </span>
        <span
          className="mt-3 select-none font-extrabold uppercase leading-[0.9] tracking-tight text-white"
          style={{ fontSize: 'clamp(4rem, 12vw, 10rem)' }}
        >
          XENO
        </span>
        <p className="mt-8 text-base text-white/40 md:text-lg">
          The complete visual AI platform.
        </p>
        <a
          href="/auth"
          className="mt-12 inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-medium text-[#08080a] transition-opacity hover:opacity-90"
        >
          Get Started
          <span aria-hidden="true">&rarr;</span>
        </a>
      </div>
    </section>
  );
}

/* ─── Styles ─── */

function HeroStyles() {
  return (
    <style>{`
      .hero-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        grid-template-rows: repeat(4, 1fr);
        grid-template-areas:
          "ws ws nr fl"
          "ws ws ab ar"
          "pt ct ct ui"
          "pt pw nt nt";
      }
      @media (min-width: 768px) {
        .hero-grid {
          grid-template-columns: repeat(6, 1fr);
          grid-template-rows: repeat(3, 1fr);
          grid-template-areas:
            "ws ws nr nr pt fl"
            "ws ws ab ar pt pw"
            "nt ct ct ct ui pw";
        }
      }
      .hero-enter {
        opacity: 0;
        transform: scale(0.92);
        transition: opacity 0.9s cubic-bezier(0.16, 1, 0.3, 1),
                    transform 0.9s cubic-bezier(0.16, 1, 0.3, 1);
        will-change: opacity, transform;
      }
      .hero-visible .hero-enter {
        opacity: 1;
        transform: scale(1);
      }
      @media (prefers-reduced-motion: reduce) {
        .hero-enter {
          opacity: 1 !important;
          transform: none !important;
          transition: none !important;
        }
      }
    `}</style>
  );
}

export default HeroSection;
