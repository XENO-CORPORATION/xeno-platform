import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Download, File, FileImage, X } from '@/lib/icons';
import { libraryService, type LibraryAssetRef } from '@/services/libraryService';
import LibraryAssetImage, { type LibraryAssetImageState } from './LibraryAssetImage';

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
  leftInset?: number;
};

const MAX_VISIBLE_THUMBNAILS = 9;

const hasPreviewSource = (item: LibraryViewerItem) => Boolean(
  item.asset?.assetId || item.asset?.contentUrl || item.sourceUrl,
);

export const getVisibleLibraryViewerItems = (items: LibraryViewerItem[], activeIndex: number) => {
  const previewable = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => hasPreviewSource(item));
  if (previewable.length <= MAX_VISIBLE_THUMBNAILS) return previewable;

  const activePreviewIndex = Math.max(
    previewable.findIndex(({ index }) => index === activeIndex),
    0,
  );
  const start = Math.min(
    Math.max(activePreviewIndex - Math.floor(MAX_VISIBLE_THUMBNAILS / 2), 0),
    previewable.length - MAX_VISIBLE_THUMBNAILS,
  );
  return previewable.slice(start, start + MAX_VISIBLE_THUMBNAILS);
};

export const LibraryAssetViewer: React.FC<LibraryAssetViewerProps> = ({ items, activeId, onClose, leftInset = 0 }) => {
  const initialIndex = Math.max(items.findIndex((item) => item.id === activeId), 0);
  const [index, setIndex] = useState(initialIndex);
  const [resolvedUrl, setResolvedUrl] = useState('');
  const [imageState, setImageState] = useState<LibraryAssetImageState>('resolving');
  const item = items[index] || items[0];
  const mimeType = item?.asset?.mimeType || '';
  const isImage = mimeType.startsWith('image/') || (!mimeType && Boolean(item?.sourceUrl?.startsWith('data:image/')));
  const visibleImageItems = useMemo(() => getVisibleLibraryViewerItems(items, index), [index, items]);

  useEffect(() => {
    setIndex(Math.max(items.findIndex((entry) => entry.id === activeId), 0));
  }, [activeId, items]);

  useEffect(() => {
    setResolvedUrl('');
    setImageState(hasPreviewSource(item) ? 'resolving' : 'unavailable');
  }, [item]);

  useEffect(() => {
    if (!item || isImage || !hasPreviewSource(item)) return undefined;
    let cancelled = false;
    setImageState('resolving');
    const resolve = item.asset?.assetId
      ? libraryService.createSignedLink(item.asset.assetId)
      : Promise.resolve(item.sourceUrl || item.asset?.contentUrl || '');
    void resolve.then((url) => {
      if (cancelled) return;
      setResolvedUrl(url);
      setImageState(url ? 'ready' : 'unavailable');
    }).catch(() => {
      if (!cancelled) setImageState('unavailable');
    });
    return () => { cancelled = true; };
  }, [isImage, item]);

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute('data-library-viewer-open');
    root.setAttribute('data-library-viewer-open', 'true');
    return () => {
      if (previous === null) root.removeAttribute('data-library-viewer-open');
      else root.setAttribute('data-library-viewer-open', previous);
    };
  }, []);

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
    const source = item.sourceUrl || item.asset?.contentUrl;
    if (!source) throw new Error('library_preview_unavailable');
    return new URL(source, window.location.origin).toString();
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

  const handleImageStateChange = useCallback((nextState: LibraryAssetImageState) => {
    setImageState(nextState);
  }, []);

  const canExport = hasPreviewSource(item) && imageState !== 'unavailable';

  return (
    <div
      className="fixed inset-y-0 right-0 z-[11000] isolate flex flex-col overflow-hidden bg-[#050505] text-white"
      style={{ left: Math.max(0, leftInset) }}
      role="dialog"
      aria-label={`Library preview: ${item.name}`}
      data-library-asset-viewer="true"
      data-library-viewer-left={Math.max(0, leftInset)}
    >
      <header className="grid h-[50px] shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-white/10 bg-[#080808] px-3">
        <div className="flex min-w-0 items-center gap-2 overflow-hidden text-[12px] text-white/65">
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-white/10" aria-label="Close preview"><X size={16} /></button>
          <span className="shrink-0 text-[13px] font-semibold tracking-tight text-white">XENO</span>
          <span className="shrink-0 text-white/30">/</span>
          <span className="shrink-0 text-white/75">Library</span><span className="shrink-0 text-white/30">/</span>
          {item.context && <><span className="max-w-52 truncate">{item.context}</span><span className="shrink-0 text-white/30">/</span></>}
          <span className="truncate font-medium text-white">{item.name}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" disabled={!canExport} onClick={() => void copyLink()} className="rounded-lg p-2 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent" aria-label="Copy share link"><Copy size={16} /></button>
          <button type="button" disabled={!canExport} onClick={() => void download()} className="rounded-lg p-2 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent" aria-label="Download"><Download size={16} /></button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-5" data-library-preview-state={imageState}>
          {isImage ? (
            <LibraryAssetImage
              key={item.id}
              asset={item.asset}
              sourceUrl={item.sourceUrl}
              onResolvedUrl={setResolvedUrl}
              onStateChange={handleImageStateChange}
              alt={item.name}
              className="flex max-h-full max-w-full cursor-grab select-none flex-col items-center justify-center object-contain text-white/45 active:cursor-grabbing"
              loadingFallback={<span className="text-[12px] text-white/45">Loading preview…</span>}
              fallback={(
                <span className="flex max-w-sm flex-col items-center gap-3 text-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]"><FileImage size={22} aria-hidden="true" /></span>
                  <span className="text-[14px] font-medium text-white/80">Preview unavailable</span>
                  <span className="text-[12px] leading-relaxed text-white/45">This Library image is unavailable or no longer authorized.</span>
                </span>
              )}
            />
          ) : imageState === 'resolving' ? (
            <span className="text-[12px] text-white/45">Loading preview…</span>
          ) : imageState === 'ready' && resolvedUrl ? (
            mimeType.startsWith('video/') ? (
              <video src={resolvedUrl} controls className="max-h-full max-w-full" aria-label={item.name} />
            ) : mimeType.startsWith('audio/') ? (
              <audio src={resolvedUrl} controls className="w-full max-w-xl" aria-label={item.name} />
            ) : (
              <iframe
                src={resolvedUrl}
                title={item.name}
                sandbox={mimeType === 'text/html' ? '' : undefined}
                className="h-full w-full rounded-lg border border-white/10 bg-white"
              />
            )
          ) : (
            <span className="flex max-w-sm flex-col items-center gap-3 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]"><File size={22} aria-hidden="true" /></span>
              <span className="text-[14px] font-medium text-white/80">Preview unavailable</span>
              <span className="text-[12px] leading-relaxed text-white/45">This Library file is unavailable or no longer authorized.</span>
            </span>
          )}
        </main>
        {visibleImageItems.length > 1 && (
          <aside
            className="flex w-[76px] shrink-0 flex-col items-center gap-2 overflow-y-auto border-l border-white/10 py-3"
            aria-label="Image history"
            data-library-preview-rail="right"
          >
            {visibleImageItems.map(({ item: entry, index: entryIndex }) => (
              <button key={entry.id} type="button" onClick={() => setIndex(entryIndex)} className={`h-14 w-14 overflow-hidden rounded-lg border bg-white/[0.03] ${entryIndex === index ? 'border-white/80' : 'border-white/15 opacity-70 hover:opacity-100'}`} aria-label={`Preview ${entry.name}`}>
                <LibraryAssetImage asset={entry.asset} sourceUrl={entry.sourceUrl} alt={entry.name} className="flex h-full w-full items-center justify-center object-cover text-white/35" draggable={false} />
              </button>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
};

export default LibraryAssetViewer;
