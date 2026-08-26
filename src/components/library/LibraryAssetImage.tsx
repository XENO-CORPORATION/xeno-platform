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
  const [url, setUrl] = useState(asset?.assetId ? '' : directUrl);
  const [state, setState] = useState<LibraryAssetImageState>(
    asset?.assetId ? 'resolving' : directUrl ? 'ready' : 'unavailable',
  );

  useEffect(() => {
    let cancelled = false;
    const nextDirectUrl = sourceUrl || asset?.contentUrl || '';
    setUrl(asset?.assetId ? '' : nextDirectUrl);

    if (!asset?.assetId) {
      const nextState = nextDirectUrl ? 'ready' : 'unavailable';
      setState(nextState);
      onStateChange?.(nextState);
      if (nextDirectUrl) onResolvedUrl?.(nextDirectUrl);
      return undefined;
    }

    setState('resolving');
    onStateChange?.('resolving');
    void libraryService.createSignedLink(asset.assetId)
      .then((signedUrl) => {
        if (cancelled) return;
        setUrl(signedUrl);
        setState('ready');
        onStateChange?.('ready');
        onResolvedUrl?.(signedUrl);
      })
      .catch(() => {
        if (cancelled) return;
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
