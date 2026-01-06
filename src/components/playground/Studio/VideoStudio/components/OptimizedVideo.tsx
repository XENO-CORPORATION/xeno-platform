import React from 'react';

interface OptimizedVideoProps {
  src: string;
  alt?: string;
  className?: string;
  onLoad?: () => void;
  onError?: () => void;
}

export const OptimizedVideo: React.FC<OptimizedVideoProps> = ({
  src,
  alt = '',
  className = '',
  onLoad,
  onError
}) => {
  return (
    <video
      src={src}
      className={className}
      onLoadedData={onLoad}
      onError={onError}
      controls
      preload="metadata"
    >
      {alt && <track kind="captions" label={alt} />}
    </video>
  );
};

export default OptimizedVideo;