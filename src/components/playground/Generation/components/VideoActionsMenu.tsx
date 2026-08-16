import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, RefreshCw, Star, Trash2 } from 'lucide-react';

interface VideoActionsMenuProps {
  isFavorite?: boolean;
  onRegenerate?: () => void;
  onToggleFavorite?: () => void;
  onDelete?: () => void;
}

/**
 * The "⋯" overflow menu for a video — Regenerate, Add/Remove favorite, Delete.
 *
 * The dropdown is rendered in a portal (to document.body) so it isn't clipped by the
 * card's overflow-hidden (used for the info collapse) and always sits above the video.
 * It opens upward, right-aligned to the button, and closes on outside click.
 */
const VideoActionsMenu: React.FC<VideoActionsMenuProps> = ({
  isFavorite,
  onRegenerate,
  onToggleFavorite,
  onDelete,
}) => {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.top, left: r.right }); // menu's bottom-right anchors here
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const run = (fn?: () => void) => () => {
    setOpen(false);
    fn?.();
  };

  const itemClass =
    'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-white/80 hover:bg-white/10 transition-colors text-left';

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="text-white/70 hover:text-white transition-colors"
        title="More"
      >
        <MoreHorizontal size={18} />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed min-w-[180px] bg-[#1a1a1c] border border-white/10 rounded-lg p-1 shadow-xl shadow-black/50 z-[100]"
            style={{ top: pos.top, left: pos.left, transform: 'translate(-100%, -100%)', marginTop: '-8px' }}
          >
            <button type="button" onClick={run(onRegenerate)} className={itemClass}>
              <RefreshCw size={15} className="text-white/60" />
              Regenerate
            </button>
            <button type="button" onClick={run(onToggleFavorite)} className={itemClass}>
              <Star size={15} className={isFavorite ? 'text-yellow-400 fill-yellow-400' : 'text-white/60'} />
              {isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            </button>
            <button
              type="button"
              onClick={run(onDelete)}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-red-400 hover:bg-red-500/10 transition-colors text-left"
            >
              <Trash2 size={15} />
              Delete
            </button>
          </div>,
          document.body,
        )}
    </>
  );
};

export default VideoActionsMenu;
