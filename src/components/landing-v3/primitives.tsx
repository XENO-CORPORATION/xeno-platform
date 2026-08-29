import React, { useEffect, useRef, useState } from 'react';

/* ──────────────────────────────────────────────────────────────────────
 * landing-v3 shared design system
 * Extracted from the hero so every section below speaks the same language.
 * ────────────────────────────────────────────────────────────────────── */

export const T = {
  bg: '#060606',        // page background
  card: '#151515',      // floating container
  inset: '#0f0f0f',     // panel inside a card
  border: 'rgba(255,255,255,0.07)',
  borderHi: 'rgba(255,255,255,0.18)',
  accent: '#e8e3dc',    // primary violet
  accentHi: '#ffffff',  // bright violet
  title: '#ffffff',
  light: '#d8d2ca',
  body: '#948d83',      // muted body
  faint: '#8a847b',
  label: '#756f66',     // eyebrow / dim label
  dim: '#69635b',
} as const;

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

/* ──────────────────────────────────────────────────────────────────────
 * Reveal — fade + lift into view on scroll (once). Respects reduced-motion.
 * Wrap any block; pass `delay` (ms) to stagger siblings.
 * ────────────────────────────────────────────────────────────────────── */
export function Reveal({
  children,
  className = '',
  delay = 0,
  y = 14,
  as: Tag = 'div',
  style,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  y?: number;
  as?: 'div' | 'section' | 'li' | 'article' | 'span';
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);
  // Once the entrance transition finishes we drop will-change + the transform entirely,
  // so the text leaves its GPU compositing layer and Chrome restores crisp sub-pixel
  // (ClearType) antialiasing instead of the blurry grayscale fallback.
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      // fire a touch before the element fully enters, so it's never caught hidden
      { threshold: 0.04, rootMargin: '0px 0px 8% 0px' },
    );
    io.observe(el);
    // fail-safe: if the observer ever misses an element that's already in/past view,
    // reveal it — but never pre-reveal off-screen content (keeps the scroll effect intact)
    const failSafe = setTimeout(() => {
      const node = ref.current;
      if (node && node.getBoundingClientRect().top < window.innerHeight) setShown(true);
    }, 1200);
    return () => { io.disconnect(); clearTimeout(failSafe); };
  }, []);

  // After reveal, wait out the transition (560ms + capped stagger) then settle to a
  // plain, un-composited element so its text renders sharp.
  const d = Math.min(delay, 140); // cap the stagger; keep motion brisk
  useEffect(() => {
    if (!shown || settled) return;
    const t = setTimeout(() => setSettled(true), 560 + d + 60);
    return () => clearTimeout(t);
  }, [shown, settled, d]);

  const Comp = Tag as React.ElementType;
  return (
    <Comp
      ref={ref as React.Ref<HTMLElement>}
      className={cx(
        // only animate / promote a layer while the reveal is in flight
        settled
          ? ''
          : 'motion-safe:transition-all motion-safe:duration-[560ms] motion-safe:ease-[cubic-bezier(0.22,0.7,0.2,1)] will-change-transform',
        shown ? 'opacity-100' : 'opacity-0',
        className,
      )}
      style={{
        ...style,
        ...(settled
          ? {} // no transform, no will-change → back on the crisp ClearType path
          : shown
            ? { transform: 'translateY(0)', transitionDelay: `${d}ms` }
            : { transform: `translateY(${y}px)`, transitionDelay: `${d}ms` }),
      }}
    >
      {children}
    </Comp>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * Eyebrow — the small uppercase label above a section title.
 * ────────────────────────────────────────────────────────────────────── */
export function Eyebrow({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-2 text-[clamp(10.5px,0.75vw,12px)] font-semibold uppercase tracking-[0.22em]',
        className,
      )}
      style={{ color: T.label }}
    >
      <span className="h-1.5 w-1.5 rounded-[2px]" style={{ backgroundColor: 'rgb(var(--acc))' }} />
      {children}
    </span>
  );
}

/* ──────────────────────────────────────────────────────────────────────
 * SectionHeading — eyebrow + display headline + optional sub.
 * `align` controls text alignment; `serif` swaps to the Cormorant display face.
 * ────────────────────────────────────────────────────────────────────── */
export function SectionHeading({
  eyebrow,
  title,
  sub,
  align = 'center',
  serif = false,
  className = '',
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  align?: 'center' | 'left';
  serif?: boolean;
  className?: string;
}) {
  const centered = align === 'center';
  return (
    <div className={cx('flex flex-col', centered ? 'items-center text-center' : 'items-start text-left', className)}>
      {eyebrow ? <Reveal className="mb-[clamp(14px,1.8vh,22px)]"><Eyebrow>{eyebrow}</Eyebrow></Reveal> : null}
      <Reveal delay={60}>
        <h2
          className={cx(
            'text-[clamp(1.9rem,2.9vw,3.4rem)] leading-[1.08] tracking-[-0.01em] text-[#ece7df]',
            serif ? 'font-light' : 'font-semibold',
          )}
          style={serif ? { fontFamily: "'Cormorant Garamond', 'Playfair Display', Georgia, serif", fontWeight: 400, letterSpacing: '0.01em' } : undefined}
        >
          {title}
        </h2>
      </Reveal>
      {sub ? (
        <Reveal delay={120}>
          <p
            className={cx(
              'mt-[clamp(14px,2vh,24px)] text-[clamp(13px,1vw,16px)] leading-[1.6]',
              centered ? 'mx-auto max-w-[640px]' : 'max-w-[560px]',
            )}
            style={{ color: T.body }}
          >
            {sub}
          </p>
        </Reveal>
      ) : null}
    </div>
  );
}
