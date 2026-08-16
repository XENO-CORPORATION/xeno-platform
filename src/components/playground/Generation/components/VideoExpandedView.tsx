import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Play, Pause, Download, Share2, Clock, RectangleHorizontal, ChevronDown, ChevronUp } from 'lucide-react';
import type { VideoResultItem } from './VideoResultCard';
import VideoActionsMenu from './VideoActionsMenu';
import PromptText from './PromptText';

// ── helpers (kept local to avoid coupling) ──────────────────────────────────
const shortModelName = (model?: string): string => {
  if (!model) return 'Video';
  const m = model.toLowerCase();
  if (m.includes('kling') && m.includes('v2')) return 'Kling Video';
  if (m.includes('kling')) return 'Kling Video';
  if (m.includes('veo')) return 'Veo';
  if (m.includes('wan')) return 'Wan';
  if (m.includes('hunyuan')) return 'Hunyuan';
  if (m.includes('luma')) return 'Luma';
  if (m.includes('pika')) return 'Pika';
  if (m.includes('minimax') || m.includes('hailuo')) return 'MiniMax';
  return 'Video';
};
const modelVersion = (model?: string): string => {
  if (!model) return '';
  const m = model.toLowerCase();
  if (m.includes('v2')) return '2.0';
  if (m.includes('v1.6') || m.includes('kling')) return '1.6';
  if (m.includes('veo')) return '2';
  if (m.includes('pika')) return '2.2';
  if (m.includes('luma')) return 'Ray-2';
  return '';
};
const metaModel = (model?: string): string => {
  const v = modelVersion(model);
  return v ? `${shortModelName(model)} ${v}` : shortModelName(model);
};
const fmtClock = (sec?: number): string => {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const deriveTitle = (prompt: string): string => {
  const words = (prompt || '').trim().split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
  if (!words) return 'Untitled video';
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const timeAgo = (date: Date, now: number): string => {
  const d = date instanceof Date ? date : new Date(date);
  const diff = Math.max(0, (now - d.getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

interface VideoExpandedViewProps {
  item: VideoResultItem;
  now: number;
  /** When false, the card is an off-center reel peek — playback is paused. */
  active?: boolean;
  /** Feed card's rect at expand time — the card travels from here on open. */
  originRect?: DOMRect | null;
  onDownload?: (item: VideoResultItem) => void;
  onShare?: (item: VideoResultItem) => void;
  onRegenerate?: (item: VideoResultItem) => void;
  onToggleFavorite?: (item: VideoResultItem) => void;
  onDelete?: (item: VideoResultItem) => void;
}

const VideoExpandedView: React.FC<VideoExpandedViewProps> = ({ item, now, active = true, originRect, onDownload, onShare, onRegenerate, onToggleFavorite, onDelete }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  // Manual collapse of the info panel on the active video (separate from the
  // automatic collapse applied to off-center neighbours).
  const [infoCollapsed, setInfoCollapsed] = useState(false);
  // The video area is measured so we can size the container as the largest box
  // of the clip's aspect ratio that fits — a true "contain" that grows in both
  // dimensions (no letterbox) as the info panel frees space.
  const cardRef = useRef<HTMLDivElement>(null);
  const videoAreaRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  // Only the centered (active) video plays — pause when scrolled away. Also reset the
  // manual info collapse, so a video doesn't stay collapsed when you scroll back to it.
  useEffect(() => {
    if (!active) {
      videoRef.current?.pause();
      setInfoCollapsed(false);
    }
  }, [active]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };
  const seekBar = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    v.currentTime = frac * duration;
  };

  const title = deriveTitle(item.prompt);
  const meta = metaModel(item.metadata?.model);
  const dur = fmtClock(item.metadata?.duration);
  const aspect = item.metadata?.aspectRatio || '16:9';
  const ratio = (() => {
    const [w, h] = aspect.split(':').map(Number);
    return w && h ? w / h : 16 / 9;
  })();
  const when = timeAgo(item.timestamp, now);
  const progress = duration ? (current / duration) * 100 : 0;

  // Measure the video area and compute the largest ratio-locked box that fits.
  // Recomputes as the info panel collapses/expands (the area's height animates),
  // so the container grows/shrinks in step — always hugging the video's ratio.
  useLayoutEffect(() => {
    const area = videoAreaRef.current;
    const card = cardRef.current;
    if (!area || !card) return;
    const PAD = 12; // even padding around the video, in px
    const compute = () => {
      const ah = area.clientHeight;
      if (ah <= 0) return;
      // Height-driven: the video fills the available height; its width follows the
      // ratio. Capped so the hugging card never overflows its slide.
      const parent = card.parentElement;
      const maxBoxW = (parent ? parent.clientWidth : ah * ratio + 2 * PAD) - 2 * PAD;
      let h = ah;
      let w = h * ratio;
      if (w > maxBoxW) {
        w = maxBoxW;
        h = w / ratio;
      }
      setBox({ w: Math.round(w), h: Math.round(h) });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(area);
    if (card.parentElement) ro.observe(card.parentElement);
    return () => ro.disconnect();
  }, [ratio]);

  // Entrance: on open, place this card over the feed card it came from, then animate
  // it linearly into its expanded position. Done before paint (computing the final
  // width directly) so there's no hidden gap, flash, or teleport.
  const didFlip = useRef(false);
  useLayoutEffect(() => {
    if (didFlip.current) return;
    didFlip.current = true;
    if (!active || !originRect) return;
    const area = videoAreaRef.current;
    const card = cardRef.current;
    if (!area || !card) return;
    const PAD = 12;
    const ah = area.clientHeight;
    if (!ah) return;
    const parent = card.parentElement;
    const maxBoxW = (parent ? parent.clientWidth : ah * ratio + 2 * PAD) - 2 * PAD;
    let bw = ah * ratio;
    if (bw > maxBoxW) bw = maxBoxW;
    const cardWidth = Math.round(bw) + 2 * PAD; // matches the rendered card width
    const r = card.getBoundingClientRect(); // centre & height are width-independent (centred, h-full)
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const s = originRect.width / cardWidth;
    const dx = originRect.left + originRect.width / 2 - cx;
    const dy = originRect.top + originRect.height / 2 - cy;
    card.style.transformOrigin = 'center';
    card.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
    const id = requestAnimationFrame(() => {
      card.style.transition = 'transform 480ms linear';
      card.style.transform = 'none';
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={cardRef}
      data-active={active ? 'true' : undefined}
      className="relative h-full flex flex-col rounded-2xl border border-white/10 backdrop-blur-sm"
      style={{
        // The card hugs the video: its width is the video box width plus an even
        // padding on every side, so the bg scales with the video and the left/right
        // gap always matches the top gap (no empty side space, no full-width stretch).
        width: box.w ? `${box.w + 24}px` : '100%',
        maxWidth: '100%',
        marginLeft: 'auto',
        marginRight: 'auto',
        padding: '12px',
        // A single soft light source behind the glass, sitting at the video/info
        // boundary (just below the video, at the top of the info) and spreading down
        // through the info. Clipped to the card — light from behind, no outside spill.
        backgroundImage: active
          ? 'radial-gradient(110% 60% at 50% 74%, rgba(158,180,230,0.20) 0%, rgba(150,170,215,0.07) 48%, transparent 82%)'
          : 'none',
        // Faint base border; the per-edge gradient strips add the centred glow.
        borderColor: active ? 'rgba(160,180,225,0.12)' : 'rgba(255,255,255,0.10)',
        // Glass top highlight inside only — no drop shadow.
        boxShadow: active ? 'inset 0 1px 0 rgba(185,205,245,0.18)' : 'none',
      }}
    >
      {/* Per-edge border glow: each strip is brightest in the middle of its side and
          fades to transparent toward the corners. Active only. */}
      {active && (
        <>
          <div className="pointer-events-none absolute inset-x-4 top-0 h-px" style={{ background: 'linear-gradient(to right, transparent, rgba(190,210,250,0.55), transparent)' }} />
          <div className="pointer-events-none absolute inset-x-4 bottom-0 h-px" style={{ background: 'linear-gradient(to right, transparent, rgba(190,210,250,0.42), transparent)' }} />
          <div className="pointer-events-none absolute inset-y-4 left-0 w-px" style={{ background: 'linear-gradient(to bottom, transparent, rgba(190,210,250,0.48), transparent)' }} />
          <div className="pointer-events-none absolute inset-y-4 right-0 w-px" style={{ background: 'linear-gradient(to bottom, transparent, rgba(190,210,250,0.48), transparent)' }} />
        </>
      )}

      {/* Video — a box sized to the clip's aspect ratio and centered, so the bordered
          container hugs the video (no letterbox). It grows in BOTH width and height to
          fill the space the info panel frees as it collapses. */}
      <div ref={videoAreaRef} className="relative flex-1 min-h-0 flex items-center justify-center">
        <div
          className="relative overflow-hidden rounded-xl bg-black group/vid"
          style={{
            width: box.w ? `${box.w}px` : '100%',
            height: box.h ? `${box.h}px` : '100%',
          }}
        >
        <video
          ref={videoRef}
          src={item.video}
          loop
          playsInline
          onClick={togglePlay}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setCurrent((e.target as HTMLVideoElement).currentTime)}
          onLoadedMetadata={(e) => setDuration((e.target as HTMLVideoElement).duration || 0)}
          className="w-full h-full bg-black object-contain cursor-pointer"
        />

        {/* Created time — top-right corner, revealed on hover */}
        <div className="pointer-events-none absolute top-3 right-3 px-2 py-1 rounded-md bg-black/60 backdrop-blur-sm text-xs text-white/85 opacity-0 group-hover/vid:opacity-100 transition-opacity">
          Created {when}
        </div>

        {/* Controls: play (left) · time (right) · thin progress bar pinned to the bottom edge */}
        <div className="absolute inset-x-0 bottom-0">
          <div className="flex items-center justify-between px-4 pb-3 pt-12 bg-gradient-to-t from-black/60 via-black/20 to-transparent">
            <button
              type="button"
              onClick={togglePlay}
              className="text-white/90 hover:text-white transition-colors"
              title={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause size={22} /> : <Play size={22} className="ml-0.5" fill="currentColor" />}
            </button>
            <div className="flex items-center gap-3">
              <span className="text-sm text-white/90 tabular-nums">{fmtClock(current)}</span>
              {active && (
                <button
                  type="button"
                  onClick={() => setInfoCollapsed((c) => !c)}
                  className="text-white/80 hover:text-white transition-colors"
                  title={infoCollapsed ? 'Show details' : 'Hide details'}
                >
                  {infoCollapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
                </button>
              )}
            </div>
          </div>
          <div onClick={seekBar} className="h-[3px] w-full bg-white/15 cursor-pointer">
            <div className="h-full bg-white/80" style={{ width: `${progress}%` }} />
          </div>
        </div>
        </div>
      </div>

      {/* Information container — collapses to zero height on the non-active (peek)
          videos, so neighbours show only the video. Animated via grid-template-rows
          (1fr ⇄ 0fr) so it slides open/closed as a video scrolls in or out of center. */}
      <div
        className="flex-none grid"
        style={{
          // Collapse on the SAME timeline as the slide scale (900ms, same curve) so
          // the shrink + info-fold + video-fill happen as one motion — no two-step.
          gridTemplateRows: active ? '1fr' : '0fr',
          opacity: active ? 1 : 0,
          transition: 'grid-template-rows 900ms cubic-bezier(0.65, 0, 0.35, 1), opacity 500ms ease',
        }}
      >
        <div className="overflow-hidden min-h-0">
          {/* Collapsible details — toggled by the chevron in the video controls. The
              padding lives INSIDE the collapsible region so it folds away completely,
              leaving the video evenly padded on all sides when collapsed. */}
          <div
            className="grid"
            style={{
              gridTemplateRows: infoCollapsed ? '0fr' : '1fr',
              opacity: infoCollapsed ? 0 : 1,
              transition: 'grid-template-rows 360ms cubic-bezier(0.45, 0, 0.55, 1), opacity 240ms ease',
            }}
          >
            <div className="overflow-hidden min-h-0">
        <div className="px-1 pt-3 pb-0">
        <div className="relative">
          {/* Specs pinned top-right. The staircase below reserves room on its first line
              so line 1 clears these. */}
          <div className="absolute top-1 right-0 flex items-center gap-3 text-xs text-white/55 whitespace-nowrap">
            <span className="px-2 py-1 rounded-md bg-white/[0.07] text-white/85 font-medium">{meta}</span>
            <span className="flex items-center gap-1.5">
              <Clock size={13} className="text-white/40" />
              {dur}
            </span>
            <span className="flex items-center gap-1.5">
              <RectangleHorizontal size={13} className="text-white/40" />
              {aspect}
            </span>
          </div>

          {/* Title — capped so it never runs under the absolute specs. */}
          <h3
            className="text-[#d7d8d8] text-lg font-semibold leading-tight truncate"
            style={{ fontFamily: "'Inter', sans-serif", maxWidth: 'calc(100% - 220px)' }}
          >
            {title}
          </h3>

          {/* Prompt staircase + actions. The ascending lines leave an empty gap on the
              right of the LAST (longest) line; the actions sit in that gap, anchored to the
              bottom-right of the prompt block so they line up with the last line. */}
          <div className="relative mt-1.5">
            <PromptText
              prompt={item.prompt}
              staircase={{ lines: 3, minFraction: 0.5, maxFraction: 0.72 }}
              className="text-[#868a8e] text-sm leading-relaxed cursor-pointer hover:text-[#a8acb0] transition-colors"
            />
            <div className="absolute bottom-0 right-0 flex items-center gap-4">
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors"
                onClick={() => onDownload?.(item)}
              >
                <Download size={15} />
                Download
              </button>
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs text-white/70 hover:text-white transition-colors"
                onClick={() => onShare?.(item)}
              >
                <Share2 size={15} />
                Share
              </button>
              <VideoActionsMenu
                isFavorite={(item as any).favorite}
                onRegenerate={() => onRegenerate?.(item)}
                onToggleFavorite={() => onToggleFavorite?.(item)}
                onDelete={() => onDelete?.(item)}
              />
            </div>
          </div>
        </div>
        </div>
            </div>
          </div>
      </div>
      </div>
    </div>
  );
};

export default VideoExpandedView;
