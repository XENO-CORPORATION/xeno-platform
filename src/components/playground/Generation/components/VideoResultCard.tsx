import React from 'react';
import { Download, Share2, Clock, RectangleHorizontal } from 'lucide-react';
import VideoActionsMenu from './VideoActionsMenu';
import PromptText from './PromptText';

export interface VideoResultItem {
  id: string;
  video: string;
  prompt: string;
  timestamp: Date;
  metadata?: {
    model?: string;
    duration?: number;
    aspectRatio?: string;
    [key: string]: any;
  };
}

// Short, human display name for a model id (e.g. fal-ai/kling-video/v1.6/... → "Kling 1.6").
const shortModelName = (model?: string): string => {
  if (!model) return 'Video';
  const m = model.toLowerCase();
  if (m.includes('kling') && m.includes('v2')) return 'Kling 2.0';
  if (m.includes('kling')) return 'Kling 1.6';
  if (m.includes('veo')) return 'Veo 2';
  if (m.includes('wan')) return 'Wan T2V';
  if (m.includes('hunyuan')) return 'Hunyuan';
  if (m.includes('luma')) return 'Luma Ray-2';
  if (m.includes('pika')) return 'Pika 2.2';
  if (m.includes('minimax') || m.includes('hailuo')) return 'MiniMax';
  return 'Video';
};

const fmtDuration = (sec?: number): string => {
  const s = Math.max(0, Math.round(sec || 0));
  return `0:${String(s).padStart(2, '0')}`;
};

// First few words of the prompt, used as a lightweight title.
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

interface VideoResultCardProps {
  item: VideoResultItem;
  /** Wall-clock used for the relative "x ago" label (passed in to keep render pure-ish). */
  now: number;
  /** When false, the card is de-emphasised (faded + slightly blurred). */
  focused?: boolean;
  onDownload?: (item: VideoResultItem) => void;
  onShare?: (item: VideoResultItem) => void;
  onRegenerate?: (item: VideoResultItem) => void;
  onToggleFavorite?: (item: VideoResultItem) => void;
  onDelete?: (item: VideoResultItem) => void;
}

const VideoResultCard: React.FC<VideoResultCardProps> = ({ item, now, focused = true, onDownload, onShare, onRegenerate, onToggleFavorite, onDelete }) => {
  const title = deriveTitle(item.prompt);
  const model = shortModelName(item.metadata?.model);
  const duration = fmtDuration(item.metadata?.duration);
  const aspect = item.metadata?.aspectRatio || '16:9';
  const when = timeAgo(item.timestamp, now);

  return (
    <div
      className={`w-full bg-[#1a1a1c]/80 border border-white/10 rounded-2xl overflow-hidden transition-[opacity,filter,transform] duration-500 ease-out ${
        focused ? 'opacity-100 blur-0 scale-100' : 'opacity-40 blur-[2px] scale-[0.985]'
      }`}
    >
      {/* Video player */}
      <div className="relative group/vid">
        <video
          src={item.video}
          controls
          playsInline
          loop
          className="w-full aspect-video bg-black object-contain"
        />
        {/* Created time — top-right corner, revealed on hover */}
        <div className="pointer-events-none absolute top-3 right-3 px-2 py-1 rounded-md bg-black/60 backdrop-blur-sm text-xs text-white/85 opacity-0 group-hover/vid:opacity-100 transition-opacity">
          Created {when}
        </div>
      </div>

      {/* Details — title/specs row, then prompt/actions row (actions align to the prompt's last line) */}
      <div className="p-4 min-h-[88px]">
        {/* Row 1 — title (left) + specs (right), top-aligned */}
        <div className="flex items-start justify-between gap-[50px]">
          <h3 className="text-[#d7d8d8] font-normal text-lg leading-tight" style={{ fontFamily: "'Inter', sans-serif" }}>{title}</h3>
          <div className="flex items-center gap-3 text-xs text-white/55 whitespace-nowrap flex-shrink-0 mt-1">
            <span className="px-2 py-1 rounded-md bg-white/[0.07] text-white/85 font-medium">{model}</span>
            <span className="flex items-center gap-1.5">
              <Clock size={13} className="text-white/40" />
              {duration}
            </span>
            <span className="flex items-center gap-1.5">
              <RectangleHorizontal size={13} className="text-white/40" />
              {aspect}
            </span>
          </div>
        </div>

        {/* Row 2 — prompt (left) + actions (right). items-end aligns the actions to the prompt's last line. */}
        <div className="flex items-end justify-between gap-[50px] mt-1.5">
          <PromptText
            prompt={item.prompt}
            className="flex-1 min-w-0 text-[#868a8e] text-sm leading-relaxed line-clamp-2 cursor-pointer hover:text-[#a8acb0] transition-colors"
          />
          <div className="flex items-center gap-4 flex-shrink-0">
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
  );
};

export default VideoResultCard;
