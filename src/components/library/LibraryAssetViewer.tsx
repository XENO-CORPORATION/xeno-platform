import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Download, X } from '@/lib/icons';
import { libraryService, type LibraryAssetRef } from '@/services/libraryService';
import LibraryAssetImage from './LibraryAssetImage';

export type LibraryViewerItem = {
  id: string;
  name: string;
  asset?: LibraryAssetRef | null;
  sourceUrl?: string;
  context?: string;
};

export type LibraryAssetViewerProps = {
  items: LibraryViewerItem[];
  activeId: string;
  onClose: () => void;
};

export const LibraryAssetViewer: React.FC<LibraryAssetViewerProps> = ({ items, activeId, onClose }) => {
  const initialIndex = Math.max(items.findIndex((item) => item.id === activeId), 0);
  const [index, setIndex] = useState(initialIndex);
  const [resolvedUrl, setResolvedUrl] = useState('');
  const item = items[index] || items[0];
  const imageItems = useMemo(() => items.filter(Boolean), [items]);

  useEffect(() => {
    setIndex(Math.max(items.findIndex((entry) => entry.id === activeId), 0));
  }, [activeId, items]);

  useEffect(() => setResolvedUrl(''), [item?.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') setIndex((current) => Math.max(current - 1, 0));
      if (event.key === 'ArrowRight') setIndex((current) => Math.min(current + 1, items.length - 1));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [items.length, onClose]);

  if (!item) return null;

  const getShareUrl = async (download = false) => {
    if (item.asset?.assetId) return libraryService.createSignedLink(item.asset.assetId, { download });
    return new URL(item.sourceUrl || '', window.location.origin).toString();
  };

  const download = async () => {
    const url = await getShareUrl(true);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = item.name;
    anchor.rel = 'noopener';
    anchor.click();
  };

  const copyLink = async () => {
    const url = resolvedUrl || await getShareUrl(false);
    await navigator.clipboard.writeText(url);
  };

  return (
    <div className="fixed inset-0 z-[10000] flex flex-col bg-[#050505] text-white" role="dialog" aria-modal="true" aria-label={`Library preview: ${item.name}`}>
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/10 px-3">
        <div className="flex min-w-0 items-center gap-2 text-[12px] text-white/65">
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-white/10" aria-label="Close preview"><X size={16} /></button>
          <span className="text-white/75">Library</span><span>/</span>
          {item.context && <><span className="truncate">{item.context}</span><span>/</span></>}
          <span className="truncate font-medium text-white">{item.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => void copyLink()} className="rounded-lg p-2 hover:bg-white/10" aria-label="Copy share link"><Copy size={16} /></button>
          <button type="button" onClick={() => void download()} className="rounded-lg p-2 hover:bg-white/10" aria-label="Download"><Download size={16} /></button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {imageItems.length > 1 && (
          <aside className="flex w-[76px] shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-white/10 py-3">
            {imageItems.map((entry, entryIndex) => (
              <button key={entry.id} type="button" onClick={() => setIndex(entryIndex)} className={`h-14 w-14 overflow-hidden rounded-lg border ${entryIndex === index ? 'border-white/80' : 'border-white/15 opacity-70 hover:opacity-100'}`}>
                <LibraryAssetImage asset={entry.asset} sourceUrl={entry.sourceUrl} alt="" className="h-full w-full object-cover" draggable={false} />
              </button>
            ))}
          </aside>
        )}
        <main className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-5">
          <LibraryAssetImage
            key={item.id}
            asset={item.asset}
            sourceUrl={item.sourceUrl}
            onResolvedUrl={setResolvedUrl}
            alt={item.name}
            className="max-h-full max-w-full cursor-grab select-none object-contain active:cursor-grabbing"
          />
        </main>
      </div>
    </div>
  );
};

export default LibraryAssetViewer;
