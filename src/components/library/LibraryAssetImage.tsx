import React, { useEffect, useState } from 'react';
import { libraryService, type LibraryAssetRef } from '@/services/libraryService';

export type LibraryAssetImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onDragStart'> & {
  asset?: LibraryAssetRef | null;
  sourceUrl?: string;
  onResolvedUrl?: (url: string) => void;
};

export const LibraryAssetImage: React.FC<LibraryAssetImageProps> = ({
  asset,
  sourceUrl,
  onResolvedUrl,
  draggable = true,
  ...imageProps
}) => {
  const [url, setUrl] = useState(asset?.assetId ? '' : sourceUrl || asset?.contentUrl || '');

  useEffect(() => {
    let cancelled = false;
    setUrl(asset?.assetId ? '' : sourceUrl || asset?.contentUrl || '');
    if (!asset?.assetId) return undefined;
    void libraryService.createSignedLink(asset.assetId)
      .then((signedUrl) => {
        if (cancelled) return;
        setUrl(signedUrl);
        onResolvedUrl?.(signedUrl);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [asset?.assetId, asset?.contentUrl, sourceUrl, onResolvedUrl]);

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

  return (
    <img
      {...imageProps}
      src={url || undefined}
      draggable={draggable}
      onDragStart={handleDragStart}
    />
  );
};

export default LibraryAssetImage;
