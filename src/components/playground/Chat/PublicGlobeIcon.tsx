import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

const CHECK_EASE = [0.22, 0.7, 0.2, 1] as const;

type Props = {
  selected: boolean;
  reduceMotion: boolean;
  spinRequest?: number;
};

const GlobeSvg: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={style}
  >
    <circle cx="12" cy="12" r="9" />
    <ellipse cx="12" cy="12" rx="4" ry="9" />
    <path d="M3 12h18" />
  </svg>
);

/**
 * Same lucide globe, same 16px slot. On click the icon itself turns in 3D
 * (front + back face so it doesn’t vanish at 90°). No portal, no bigger orb.
 */
export const PublicGlobeIcon: React.FC<Props> = ({
  selected,
  reduceMotion,
  spinRequest = 0,
}) => {
  const prevSelected = useRef(selected);
  const prevSpin = useRef(spinRequest);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const justSelected = selected && !prevSelected.current;
    const spinBumped = spinRequest > 0 && spinRequest !== prevSpin.current;
    prevSelected.current = selected;
    prevSpin.current = spinRequest;
    if (!justSelected && !spinBumped) return;

    setPlaying(false);
    const id = window.setTimeout(() => setPlaying(true), 0);
    return () => window.clearTimeout(id);
  }, [selected, spinRequest]);

  const duration = reduceMotion ? 0.35 : 1.15;

  return (
    <span
      className="relative inline-flex h-4 w-4 items-center justify-center text-current"
      style={{ perspective: 280 }}
      aria-hidden="true"
      data-globe-variant="lucide-same-size-spin"
    >
      <motion.span
        className="relative h-4 w-4"
        style={{ transformStyle: 'preserve-3d' }}
        initial={false}
        animate={
          playing
            ? { rotateY: 360, rotateX: [0, 12, 0] }
            : { rotateY: 0, rotateX: 0 }
        }
        transition={
          playing
            ? {
                rotateY: { duration, ease: CHECK_EASE },
                rotateX: { duration, ease: CHECK_EASE, times: [0, 0.5, 1] },
              }
            : { duration: 0 }
        }
        onAnimationComplete={() => {
          if (playing) setPlaying(false);
        }}
      >
        {/* Front — exact lucide */}
        <span
          className="absolute inset-0 flex items-center justify-center"
          style={{ backfaceVisibility: 'hidden', transform: 'translateZ(0.5px)' }}
        >
          <GlobeSvg />
        </span>
        {/* Back — same icon, so a full turn stays a globe, not an empty edge */}
        <span
          className="absolute inset-0 flex items-center justify-center"
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg) translateZ(0.5px)',
          }}
        >
          <GlobeSvg />
        </span>
      </motion.span>
    </span>
  );
};
