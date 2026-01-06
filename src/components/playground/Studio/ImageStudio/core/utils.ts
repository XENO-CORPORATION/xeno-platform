import { useRef, useCallback } from 'react';
import { ImageCacheEntry, ChatMessage } from './types';

// Global image cache for better performance
export const imageCache = new Map<string, ImageCacheEntry>();

// URL Object Cache for Memory Management
export class URLObjectCache {
  private cache = new Map<string, string>();
  private refs = new Map<string, number>();

  createURL(blob: Blob | File, key: string): string {
    if (this.cache.has(key)) {
      this.refs.set(key, (this.refs.get(key) || 0) + 1);
      return this.cache.get(key)!;
    }

    const url = URL.createObjectURL(blob);
    this.cache.set(key, url);
    this.refs.set(key, 1);
    return url;
  }

  releaseURL(key: string): void {
    const refCount = this.refs.get(key) || 0;
    if (refCount <= 1) {
      const url = this.cache.get(key);
      if (url) {
        URL.revokeObjectURL(url);
        this.cache.delete(key);
        this.refs.delete(key);
      }
    } else {
      this.refs.set(key, refCount - 1);
    }
  }

  cleanup(): void {
    this.cache.forEach(url => URL.revokeObjectURL(url));
    this.cache.clear();
    this.refs.clear();
  }
}

// Global URL cache instance
export const urlCache = new URLObjectCache();

// Text parsing utilities
export const cleanText = (text: string | null): string | null => {
  if (!text) return null;
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold markdown
    .replace(/\*(.*?)\*/g, '$1') // Remove italic markdown
    .replace(/`(.*?)`/g, '$1') // Remove inline code markdown
    .replace(/^\s*[-*+]\s+/gm, '') // Remove list markers
    .replace(/^\s*\d+\.\s+/gm, '') // Remove numbered list markers
    .trim();
};

export const parseResponse = (fullText: string, reasoningExpected: boolean = false): { thinking: string | null; answer: string; hasThinking: boolean } => {
  // Try to split on <thinking> tags first
  const thinkingRegex = /<thinking>([\s\S]*?)<\/thinking>/i;
  const thinkingMatch = fullText.match(thinkingRegex);
  
  if (thinkingMatch) {
    const thinking = thinkingMatch[1].trim();
    const answer = fullText.replace(thinkingRegex, '').trim();
    return { 
      thinking: thinking || null, 
      answer: answer || fullText.trim(), 
      hasThinking: true 
    };
  }

  // If no <thinking> tags found and we expect reasoning, try to detect thinking patterns
  if (reasoningExpected) {
    const lines = fullText.split('\n');
    let thinkingEndIndex = -1;
    
    // Look for patterns that might indicate end of thinking
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].toLowerCase().trim();
      if (line.includes('here\'s') || 
          line.includes('to answer') || 
          line.includes('in summary') ||
          line.includes('the answer is') ||
          line.includes('based on') ||
          (line.length > 0 && !line.includes('let me') && !line.includes('i need to') && !line.includes('first') && !line.includes('then'))) {
        thinkingEndIndex = i;
        break;
      }
    }
    
    if (thinkingEndIndex > 0) {
      const thinkingLines = lines.slice(0, thinkingEndIndex);
      const answerLines = lines.slice(thinkingEndIndex);
      
      return {
        thinking: thinkingLines.join('\n').trim() || null,
        answer: answerLines.join('\n').trim() || fullText.trim(),
        hasThinking: true
      };
    }
  }

  // Default: no thinking detected
  return { 
    thinking: null, 
    answer: fullText.trim(), 
    hasThinking: false 
  };
};

// Advanced Image Preloader with Caching and Priority
export const useImagePreloader = () => {
  const preloadingQueue = useRef(new Set<string>());
  
  const preloadImage = useCallback((src: string, priority: 'high' | 'normal' | 'low' = 'normal') => {
    if (imageCache.has(src) && imageCache.get(src)?.preloaded) {
      return Promise.resolve();
    }

    if (preloadingQueue.current.has(src)) {
      return Promise.resolve();
    }

    preloadingQueue.current.add(src);

    return new Promise<void>((resolve, reject) => {
      const img = new window.Image();
      
      img.onload = () => {
        const dimensions = { width: img.naturalWidth, height: img.naturalHeight };
        
        // Cache with dimensions
        imageCache.set(src, {
          url: src,
          timestamp: Date.now(),
          preloaded: true,
          dimensions
        });
        
        preloadingQueue.current.delete(src);
        resolve();
      };
      
      img.onerror = () => {
        preloadingQueue.current.delete(src);
        reject(new Error(`Failed to preload: ${src}`));
      };
      
      // Set priority hint for browser
      if ('fetchPriority' in img) {
        if (priority === 'high') {
          (img as any).fetchPriority = 'high';
        } else if (priority === 'low') {
          (img as any).fetchPriority = 'low';
        }
      }
      
      img.src = src;
    });
  }, []);

  const preloadImages = useCallback(async (urls: string[], priority: 'high' | 'normal' | 'low' = 'normal') => {
    // Filter out already cached/preloading images
    const urlsToLoad = urls.filter(url => 
      !imageCache.has(url) || !imageCache.get(url)?.preloaded
    );
    
    if (urlsToLoad.length === 0) return;

    // Batch preload with concurrency limit
    const concurrencyLimit = priority === 'high' ? 6 : 3;
    const batches = [];
    
    for (let i = 0; i < urlsToLoad.length; i += concurrencyLimit) {
      batches.push(urlsToLoad.slice(i, i + concurrencyLimit));
    }

    for (const batch of batches) {
      const promises = batch.map(url => preloadImage(url, priority).catch(() => {}));
      await Promise.allSettled(promises);
    }
  }, [preloadImage]);

  const preloadAllConversationImages = useCallback(async (messages: ChatMessage[]) => {
    const imageUrls: string[] = [];
    
    messages.forEach(message => {
      if (message.imageData) {
        imageUrls.push(message.imageData);
      }
      if (message.userImageAttachment?.base64Data) {
        imageUrls.push(message.userImageAttachment.base64Data);
      }
    });

    if (imageUrls.length > 0) {
      await preloadImages(imageUrls, 'normal');
    }
  }, [preloadImages]);

  return {
    preloadImage,
    preloadImages,
    preloadAllConversationImages
  };
}; 