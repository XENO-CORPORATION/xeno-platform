import React, { useEffect, useState } from 'react';
import { FileImage } from '@/lib/icons';
import { libraryService, type LibraryAssetRef } from '@/services/libraryService';

export type LibraryAssetImageState = 'resolving' | 'ready' | 'unavailable';

export type LibraryAssetImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onDragStart'> & {
  asset?: LibraryAssetRef | null;
  sourceUrl?: string;
  onResolvedUrl?: (url: string) => void;
  onStateChange?: (state: LibraryAssetImageState) => void;
  fallback?: React.ReactNode;
  loadingFallback?: React.ReactNode;
};

export const LibraryAssetImage: React.FC<LibraryAssetImageProps> = ({
  asset,
  sourceUrl,
  onResolvedUrl,
  onStateChange,
  fallback,
  loadingFallback,
  draggable = true,
  ...imageProps
}) => {
  const directUrl = sourceUrl || asset?.contentUrl || '';
  // A blob:/data: sourceUrl is bytes we already hold locally — always showable, and immune to the
  // quarantine window a freshly-uploaded library asset sits in (its signed link 404s until the
  // malware scan passes). Prefer it over a signed link when we have it; only resolve the asset's
  // signed link when there is NO local source (e.g. a reload, where the blob is gone). This is what
  // makes a just-attached chat image show its preview instead of a blank icon while it is scanned.
  const localUrl = /^(?:blob:|data:)/i.test(sourceUrl || '') ? (sourceUrl as string) : '';
  const useAssetLink = Boolean(asset?.assetId) && !localUrl;
  const [url, setUrl] = useState(useAssetLink ? '' : directUrl);
  const [state, setState] = useState<LibraryAssetImageState>(
    useAssetLink ? 'resolving' : directUrl ? 'ready' : 'unavailable',
  );

  useEffect(() => {
    let cancelled = false;
    const nextLocalUrl = /^(?:blob:|data:)/i.test(sourceUrl || '') ? (sourceUrl as string) : '';
    const nextDirectUrl = sourceUrl || asset?.contentUrl || '';
    const nextUseAssetLink = Boolean(asset?.assetId) && !nextLocalUrl;
    setUrl(nextUseAssetLink ? '' : nextDirectUrl);

    if (!nextUseAssetLink) {
      const nextState = nextDirectUrl ? 'ready' : 'unavailable';
      setState(nextState);
      onStateChange?.(nextState);
      if (nextDirectUrl) onResolvedUrl?.(nextDirectUrl);
      return undefined;
    }

    const assetId = asset?.assetId;
    if (!assetId) return undefined; // unreachable given nextUseAssetLink, but narrows for the compiler
    setState('resolving');
    onStateChange?.('resolving');
    void libraryService.createSignedLink(assetId)
      .then((signedUrl) => {
        if (cancelled) return;
        setUrl(signedUrl);
        setState('ready');
        onStateChange?.('ready');
        onResolvedUrl?.(signedUrl);
      })
      .catch(() => {
        if (cancelled) return;
        // The signed link can be refused while the asset is still in its scan. If we hold a local
        // source (blob/data) fall back to it rather than showing a blank; otherwise report
        // unavailable so any external retry (e.g. ChatGeneratedImage's backoff) can take over.
        if (nextLocalUrl) {
          setUrl(nextLocalUrl);
          setState('ready');
          onStateChange?.('ready');
          onResolvedUrl?.(nextLocalUrl);
          return;
        }
        setUrl('');
        setState('unavailable');
        onStateChange?.('unavailable');
      });
    return () => { cancelled = true; };
  }, [asset?.assetId, asset?.contentUrl, sourceUrl, onResolvedUrl, onStateChange]);

  const handleDragStart = (event: React.DragEvent<HTMLImageElement>) => {
    if (!url) return;
    const absolute = new URL(url, window.location.origin).toString();
    const name = asset?.name || imageProps.alt || 'XENO image';
    const mime = asset?.mimeType || 'image/png';
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData('text/uri-list', absolute);
    event.dataTransfer.setData('text/plain', absolute);
    event.dataTransfer.setData('DownloadURL', `${mime}:${name}:${absolute}`);
  };

  if (state !== 'ready' || !url) {
    const content = state === 'resolving'
      ? loadingFallback
      : fallback;
    return (
      <span
        className={imageProps.className}
        style={imageProps.style}
        role="img"
        aria-label={imageProps.alt || (state === 'resolving' ? 'Loading image preview' : 'Image preview unavailable')}
        aria-busy={state === 'resolving' || undefined}
        data-library-image-state={state}
      >
        {content || <FileImage size={20} aria-hidden="true" />}
      </span>
    );
  }

  return (
    <img
      {...imageProps}
      src={url}
      draggable={draggable}
      onDragStart={handleDragStart}
      onError={(event) => {
        setUrl('');
        setState('unavailable');
        onStateChange?.('unavailable');
        imageProps.onError?.(event);
      }}
      data-library-image-state="ready"
    />
  );
};

export default LibraryAssetImage;
