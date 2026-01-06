import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Image } from 'lucide-react';
import { ImagePlaceholderProps, ChatMessage } from '../core/types';
import { imageCache } from '../core/utils';

// YouTube-style Image Placeholder with Skeleton
export const ImagePlaceholder: React.FC<ImagePlaceholderProps> = ({ 
  width = 300, 
  height = 200, 
  aspectRatio, 
  className = "" 
}) => {
  const placeholderStyle = aspectRatio 
    ? { aspectRatio } 
    : { width, height };

  return (
    <div 
      className={`relative bg-gray-800 rounded-md overflow-hidden ${className}`}
      style={placeholderStyle}
    >
      {/* Animated gradient background */}
      <div className="absolute inset-0 bg-gradient-to-r from-gray-800 via-gray-700 to-gray-800 animate-pulse" />
      
      {/* Shimmer effect */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-gray-600/20 to-transparent animate-shimmer" />
      
      {/* Content placeholder */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-gray-500 opacity-50">
          <Image size={Math.min(width, height) * 0.2} />
        </div>
      </div>
    </div>
  );
};

// High-Performance Image Component with Instant Placeholders
export const OptimizedImage = React.memo(({ 
  src, 
  alt, 
  className, 
  onClick, 
  onLoad,
  placeholderWidth = 300,
  placeholderHeight = 200,
  placeholderAspectRatio
}: { 
  src: string; 
  alt: string; 
  className?: string; 
  onClick?: () => void;
  onLoad?: () => void;
  placeholderWidth?: number;
  placeholderHeight?: number;
  placeholderAspectRatio?: string;
}) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [imageDimensions, setImageDimensions] = useState<{width: number, height: number} | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Check if image is already cached/preloaded
  const [isPreloaded, setIsPreloaded] = useState(() => {
    if (imageCache.has(src)) {
      const cached = imageCache.get(src);
      return cached?.preloaded || false;
    }
    return false;
  });

  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const target = e.target as HTMLImageElement;
    const dimensions = { width: target.naturalWidth, height: target.naturalHeight };
    
    setImageDimensions(dimensions);
    setImageLoaded(true);
    
    // Cache the dimensions
    if (imageCache.has(src)) {
      const cached = imageCache.get(src);
      if (cached) {
        cached.dimensions = dimensions;
        cached.preloaded = true;
      }
    } else {
      imageCache.set(src, {
        url: src,
        timestamp: Date.now(),
        preloaded: true,
        dimensions
      });
    }
    
    onLoad?.();
  }, [src, onLoad]);

  const handleImageError = useCallback(() => {
    setImageError(true);
  }, []);

  // Calculate responsive dimensions
  const getResponsiveDimensions = useCallback(() => {
    if (imageDimensions) {
      const maxWidth = 400;
      const ratio = imageDimensions.width / imageDimensions.height;
      const width = Math.min(imageDimensions.width, maxWidth);
      const height = width / ratio;
      return { width, height };
    }
    return { width: placeholderWidth, height: placeholderHeight };
  }, [imageDimensions, placeholderWidth, placeholderHeight]);

  const responsiveDimensions = getResponsiveDimensions();

  if (imageError) {
    return (
      <div 
        className={`bg-gray-800 rounded-md p-4 flex items-center justify-center text-gray-400 ${className}`}
        style={{ width: responsiveDimensions.width, height: responsiveDimensions.height }}
      >
        <Image size={24} />
        <span className="ml-2 text-sm">Failed to load</span>
      </div>
    );
  }

  return (
    <div className="relative" style={responsiveDimensions}>
      {/* Always show placeholder first for instant visual feedback */}
      {!imageLoaded && (
        <ImagePlaceholder
          width={responsiveDimensions.width}
          height={responsiveDimensions.height}
          aspectRatio={placeholderAspectRatio}
          className="absolute inset-0"
        />
      )}
      
      {/* Real image with smooth transition */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={`${className} transition-all duration-500 ease-out ${
          imageLoaded 
            ? 'opacity-100 scale-100' 
            : 'opacity-0 scale-95'
        }`}
        onClick={onClick}
        onLoad={handleImageLoad}
        onError={handleImageError}
        style={{
          width: responsiveDimensions.width,
          height: responsiveDimensions.height,
          objectFit: 'cover'
        }}
        decoding="async"
      />
    </div>
  );
});

// Virtualized Message List Component for Better Performance with Large Conversations
export const VirtualizedMessageList = React.memo(({ 
  messages, 
  renderMessage 
}: { 
  messages: ChatMessage[]; 
  renderMessage: (message: ChatMessage, index: number) => React.ReactNode;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 10 });
  const scrollHandlerEnabledRef = useRef(true);
  
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      // Skip scroll handling if disabled (during scroll restoration)
      if (!scrollHandlerEnabledRef.current) return;
      
      const scrollTop = container.scrollTop;
      const containerHeight = container.clientHeight;
      const itemHeight = 150; // Approximate message height
      
      const start = Math.max(0, Math.floor(scrollTop / itemHeight) - 2);
      const end = Math.min(messages.length, Math.ceil((scrollTop + containerHeight) / itemHeight) + 2);
      
      setVisibleRange({ start, end });
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Initial calculation

    // Expose the container ref and scroll handler control globally for scroll restoration
    if (typeof window !== 'undefined') {
      (window as any).xenoVirtualizedContainer = container;
      (window as any).xenoDisableScrollHandler = () => {
        scrollHandlerEnabledRef.current = false;
      };
      (window as any).xenoEnableScrollHandler = () => {
        scrollHandlerEnabledRef.current = true;
      };
    }

    return () => {
      container.removeEventListener('scroll', handleScroll);
      // Clean up global references
      if (typeof window !== 'undefined') {
        delete (window as any).xenoVirtualizedContainer;
        delete (window as any).xenoDisableScrollHandler;
        delete (window as any).xenoEnableScrollHandler;
      }
    };
  }, [messages.length]);

  // Render only visible messages for performance
  const visibleMessages = messages.slice(visibleRange.start, visibleRange.end);
  const totalHeight = messages.length * 150; // Approximate
  const offsetTop = visibleRange.start * 150;

  return (
    <div 
      ref={containerRef}
      className="flex-1 overflow-y-auto px-4 py-6"
      style={{ position: 'relative', height: '100%' }}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetTop}px)` }}>
          <div className="max-w-[45rem] mx-auto w-full space-y-2">
            {visibleMessages.map((message, index) => renderMessage(message, visibleRange.start + index))}
          </div>
        </div>
      </div>
    </div>
  );
}); 