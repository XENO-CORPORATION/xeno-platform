import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import VideoExpandedView from './VideoExpandedView';
import type { VideoResultItem } from './VideoResultCard';

interface VideoExpandedReelProps {
  /** Videos in display order (oldest first → newest last), matching the feed. */
  items: VideoResultItem[];
  /** Id of the video to open on first render. */
  activeId: string;
  /** Feed card's on-screen rect at expand time — the active card travels from here. */
  originRect?: DOMRect | null;
  now: number;
  onActiveChange: (id: string) => void;
  onDownload?: (item: VideoResultItem) => void;
  onShare?: (item: VideoResultItem) => void;
  onRegenerate?: (item: VideoResultItem) => void;
  onToggleFavorite?: (item: VideoResultItem) => void;
  onDelete?: (item: VideoResultItem) => void;
}

// How far (as a fraction of the container height) each neighbour sits from the
// centred video, and how much smaller the neighbours are.
const STEP_FRACTION = 0.575;
const NEIGHBOR_SCALE = 0.55;

/**
 * Vertical "coverflow" carousel for the expanded video view.
 *
 * The active video keeps its full size in the centre; the previous and next
 * videos are positioned above/below at a smaller scale (and blurred/dimmed), so
 * they read as distinct smaller videos rather than clipped edges. Scrolling the
 * wheel (or pressing ↑/↓) advances the index — the incoming video zooms up from
 * NEIGHBOR_SCALE → 1 while the outgoing one shrinks back down.
 */
const VideoExpandedReel: React.FC<VideoExpandedReelProps> = ({
  items,
  activeId,
  originRect,
  now,
  onActiveChange,
  onDownload,
  onShare,
  onRegenerate,
  onToggleFavorite,
  onDelete,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wheelLock = useRef(false);
  const [height, setHeight] = useState(0);
  const [index, setIndex] = useState(() => {
    const i = items.findIndex((it) => it.id === activeId);
    return i >= 0 ? i : 0;
  });
  // The active card does its own entrance FLIP (from originRect) — see VideoExpandedView.

  // Measure the container so neighbour offsets can be computed in pixels.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setHeight(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Focus so arrow keys work immediately after opening.
  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  // Report the centred video up to the parent (keeps the feed in sync).
  useEffect(() => {
    const it = items[index];
    if (it) onActiveChange(it.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const move = (dir: number) => {
    setIndex((i) => Math.min(items.length - 1, Math.max(0, i + dir)));
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(e.deltaY) < 6 || wheelLock.current) return;
    wheelLock.current = true;
    // "next" sits above, "previous" below — so scrolling down should go to the
    // lower (previous) video and scrolling up to the higher (next) one.
    move(e.deltaY > 0 ? -1 : 1);
    window.setTimeout(() => {
      wheelLock.current = false;
    }, 900); // roughly the transition duration, so one notch = one step
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(1);
    }
  };

  const step = height * STEP_FRACTION;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
      className="relative h-full w-full overflow-hidden outline-none"
    >
      {items.map((item, i) => {
        const dist = i - index;
        const isActive = dist === 0;
        const visible = Math.abs(dist) <= 1; // only render the neighbours
        return (
          <div
            key={item.id}
            className="absolute left-1/2 top-1/2 w-full h-[72%] will-change-transform"
            style={{
              transform: `translate(-50%, -50%) translateY(${-dist * step}px) scale(${isActive ? 1 : NEIGHBOR_SCALE})`,
              opacity: visible ? (isActive ? 1 : 0.5) : 0,
              filter: isActive ? 'none' : 'blur(2px)',
              zIndex: isActive ? 20 : 10,
              pointerEvents: isActive ? 'auto' : 'none',
              // Active slide sheds its side padding so the container can grow wider;
              // neighbours keep the gap. Animated in step with the scale/collapse.
              paddingLeft: isActive ? '0.25rem' : '1rem',
              paddingRight: isActive ? '0.25rem' : '1rem',
              transition:
                'transform 900ms cubic-bezier(0.65, 0, 0.35, 1), opacity 900ms ease, filter 900ms ease, padding 900ms cubic-bezier(0.65, 0, 0.35, 1)',
            }}
          >
            <VideoExpandedView
              item={item}
              now={now}
              active={isActive}
              originRect={isActive ? originRect : undefined}
              onDownload={onDownload}
              onShare={onShare}
              onRegenerate={onRegenerate}
              onToggleFavorite={onToggleFavorite}
              onDelete={onDelete}
            />
          </div>
        );
      })}
    </div>
  );
};

export default VideoExpandedReel;
