import React, { useState, useEffect } from 'react';
import { ImageIcon, FileTextIcon, VideoIcon } from 'lucide-react';
import { useNodeContent } from './BaseNode';

// Define the component props
interface PreviewNodeProps {
  nodeId: string | number;
  initialState?: {
    previewUrl?: string;
    previewContent?: string;
    contentType?: 'image' | 'video' | 'text' | 'auto';
    displayMode?: 'Auto' | 'Image' | 'Video' | 'Text';
  };
}

const PreviewNode: React.FC<PreviewNodeProps> = ({ nodeId, initialState = {} }) => {
  // State for preview content
  const [previewState, setPreviewState] = useState({
    previewUrl: initialState.previewUrl || '',
    previewContent: initialState.previewContent || '',
    contentType: initialState.contentType || 'auto',
    displayMode: initialState.displayMode || 'Auto',
    isPlaying: false,
    hasContent: false,
    error: ''
  });
  
  const { isExpanded } = useNodeContent();
  
  // Event listeners for preview-related events
  useEffect(() => {
    // Listen for content update events
    const handleContentUpdate = (e: CustomEvent) => {
      const { detail } = e as CustomEvent<{ 
        nodeId: string | number; 
        content: string | Blob | File;
  contentType?: string;
      }>;
      
      if (detail.nodeId !== nodeId) return;
      
      // Handle different content types
      if (typeof detail.content === 'string') {
        // Handle text content
        setPreviewState(prev => ({
          ...prev,
          previewContent: detail.content as string,
          contentType: 'text',
          hasContent: true,
          error: ''
        }));
      } else {
        // Handle file/blob content
        const blob = detail.content as Blob;
        const url = URL.createObjectURL(blob);
        const type = detail.contentType || blob.type;
        
        setPreviewState(prev => ({
          ...prev,
          previewUrl: url,
          contentType: type.startsWith('image/') ? 'image' : 
                      type.startsWith('video/') ? 'video' : 'text',
          hasContent: true,
          error: ''
        }));
      }
    };
    
    // Listen for display mode change
    const handleDisplayModeChange = (e: CustomEvent) => {
      const { detail } = e as CustomEvent<{ nodeId: string | number; value: string }>;
      if (detail.nodeId !== nodeId) return;
      
      setPreviewState(prev => ({
        ...prev,
        displayMode: detail.value as 'Auto' | 'Image' | 'Video' | 'Text'
      }));
    };
    
    // Register event listeners
    window.addEventListener('preview-content-update', handleContentUpdate as EventListener);
    window.addEventListener('preview-mode-change', handleDisplayModeChange as EventListener);
    
    // Cleanup
    return () => {
      window.removeEventListener('preview-content-update', handleContentUpdate as EventListener);
      window.removeEventListener('preview-mode-change', handleDisplayModeChange as EventListener);
    };
  }, [nodeId]);
  
  // Clean up any object URLs when component unmounts
  useEffect(() => {
    return () => {
      if (previewState.previewUrl && previewState.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewState.previewUrl);
      }
    };
  }, [previewState.previewUrl]);
  
  // Determine which content type to display based on mode and available content
  const getEffectiveContentType = () => {
    // If mode is Auto, use detected content type
    if (previewState.displayMode === 'Auto') {
      return previewState.contentType;
    }
    
    // Otherwise use the explicitly selected mode
    return previewState.displayMode.toLowerCase() as 'image' | 'video' | 'text';
  };
  
  // Handle video playback controls
  const handleVideoPlay = () => {
    setPreviewState(prev => ({ ...prev, isPlaying: true }));
  };
  
  const handleVideoPause = () => {
    setPreviewState(prev => ({ ...prev, isPlaying: false }));
  };
  
  const contentType = getEffectiveContentType();
  const hasContent = previewState.hasContent;
  
  // The expanded view provides more controls and information
  if (isExpanded) {
    return (
      <div className="preview-node-expanded">
        {/* Preview container with enhanced controls */}
        <div className="space-y-4">
          <div className="relative w-full bg-black/40 border border-white/10 rounded-lg overflow-hidden" style={{ paddingBottom: '56.25%' }}>
            {/* Empty state */}
            {!hasContent && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white/40">
                <svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <circle cx="8.5" cy="8.5" r="1.5"></circle>
                  <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
                <span className="mt-2 text-sm">Connect an input to preview content</span>
                <p className="mt-1 text-xs text-white/30 max-w-xs text-center">
                  This node can display images, videos, or text content
                </p>
              </div>
            )}
            
            {/* Image preview */}
            {hasContent && contentType === 'image' && (
              <img 
                src={previewState.previewUrl} 
                className="absolute inset-0 w-full h-full object-contain"
                alt="Preview" 
              />
            )}
            
            {/* Video preview */}
            {hasContent && contentType === 'video' && (
              <div className="absolute inset-0">
                <video 
                  src={previewState.previewUrl}
                  className="w-full h-full object-contain"
                  controls
                  autoPlay={false}
                  loop
                  muted
                  onPlay={handleVideoPlay}
                  onPause={handleVideoPause}
                />
              </div>
            )}
            
            {/* Text preview */}
            {hasContent && contentType === 'text' && (
              <div className="absolute inset-0 p-4 overflow-auto text-white text-sm bg-black/60">
                <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                  {previewState.previewContent}
                </pre>
              </div>
            )}
            
            {/* Content type indicator */}
            {hasContent && (
              <div className="absolute top-2 right-2 bg-black/60 text-white/70 text-xs px-2 py-1 rounded-full flex items-center gap-1.5">
                {contentType === 'image' && <ImageIcon size={12} />}
                {contentType === 'video' && <VideoIcon size={12} />}
                {contentType === 'text' && <FileTextIcon size={12} />}
                <span className="capitalize">{contentType}</span>
              </div>
            )}
          </div>
          
          {/* Content type selection */}
          <div>
            <label className="block text-xs font-medium text-white/70 mb-2.5">Display Mode</label>
            <div className="grid grid-cols-4 gap-2">
              {['Auto', 'Image', 'Video', 'Text'].map((mode) => (
                <button
                  key={mode}
                  className={`flex items-center justify-center py-2 px-1 text-sm rounded-md border focus:outline-none transition-colors
                    ${previewState.displayMode === mode 
                      ? 'bg-white/10 border-white/30 text-white' 
                      : 'bg-black/30 border-white/10 text-white/70 hover:bg-white/5'}`}
                  onClick={() => {
                    setPreviewState(prev => ({ ...prev, displayMode: mode as any }));
                  }}
                >
                  {mode === 'Auto' && (
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
                      <circle cx="12" cy="12" r="10"></circle>
                      <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                  )}
                  {mode === 'Image' && <ImageIcon size={14} className="mr-1.5" />}
                  {mode === 'Video' && <VideoIcon size={14} className="mr-1.5" />}
                  {mode === 'Text' && <FileTextIcon size={14} className="mr-1.5" />}
                  {mode}
                </button>
              ))}
            </div>
          </div>
          
          {/* Additional controls based on content type */}
          {hasContent && contentType === 'image' && (
            <div>
              <label className="block text-xs font-medium text-white/70 mb-2.5">Image Options</label>
              <div className="grid grid-cols-2 gap-2">
                <button className="py-2 px-1 text-sm rounded-md border bg-black/30 border-white/10 text-white/70 hover:bg-white/5 transition-colors flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                  Download
                </button>
                <button className="py-2 px-1 text-sm rounded-md border bg-black/30 border-white/10 text-white/70 hover:bg-white/5 transition-colors flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                  </svg>
                  Edit
                </button>
              </div>
            </div>
          )}
          
          {hasContent && contentType === 'video' && (
            <div>
              <label className="block text-xs font-medium text-white/70 mb-2.5">Video Options</label>
              <div className="grid grid-cols-3 gap-2">
                <button className="py-2 px-1 text-sm rounded-md border bg-black/30 border-white/10 text-white/70 hover:bg-white/5 transition-colors flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                  Download
                </button>
                <button 
                  className={`py-2 px-1 text-sm rounded-md border transition-colors flex items-center justify-center
                    ${previewState.isPlaying 
                      ? 'bg-white/10 border-white/30 text-white' 
                      : 'bg-black/30 border-white/10 text-white/70 hover:bg-white/5'}`}
                >
                  {previewState.isPlaying ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
                      <rect x="6" y="4" width="4" height="16"></rect>
                      <rect x="14" y="4" width="4" height="16"></rect>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
                      <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                  )}
                  {previewState.isPlaying ? 'Pause' : 'Play'}
                </button>
                <button className="py-2 px-1 text-sm rounded-md border bg-black/30 border-white/10 text-white/70 hover:bg-white/5 transition-colors flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-9"></path>
                    <path d="M18 2 22 6 12 16l-4 1 1-4L19 3z"></path>
                  </svg>
                  Caption
                </button>
              </div>
            </div>
          )}
          
          {hasContent && contentType === 'text' && (
            <div>
              <label className="block text-xs font-medium text-white/70 mb-2.5">Text Options</label>
              <div className="grid grid-cols-2 gap-2">
                <button className="py-2 px-1 text-sm rounded-md border bg-black/30 border-white/10 text-white/70 hover:bg-white/5 transition-colors flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                  Download
                </button>
                <button className="py-2 px-1 text-sm rounded-md border bg-black/30 border-white/10 text-white/70 hover:bg-white/5 transition-colors flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                  </svg>
                  Copy
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
  
  // Default/collapsed view
  return (
    <div className="preview-node-default">
      {/* Preview container with minimal controls */}
      <div className="space-y-2">
        <div className="relative w-full bg-black/40 border border-white/10 rounded-lg overflow-hidden" style={{ paddingBottom: '56.25%' }}>
          {/* Empty state */}
          {!hasContent && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white/40">
              <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
              <span className="mt-2 text-xs">Connect an input to preview content</span>
            </div>
          )}
          
          {/* Image preview */}
          {hasContent && contentType === 'image' && (
            <img 
              src={previewState.previewUrl} 
              className="absolute inset-0 w-full h-full object-contain"
              alt="Preview" 
            />
          )}
          
          {/* Video preview - simplified in default view */}
          {hasContent && contentType === 'video' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative w-full h-full">
                <video 
                  src={previewState.previewUrl}
                  className="absolute inset-0 w-full h-full object-contain"
                  controls={false}
                  autoPlay={false}
                  loop
                  muted
                />
                {/* Play button overlay */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <button className="w-16 h-16 rounded-full bg-white/10 hover:bg-white/20 transition-colors flex items-center justify-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                      <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {/* Text preview - simplified */}
          {hasContent && contentType === 'text' && (
            <div className="absolute inset-0 p-3 overflow-auto text-white text-sm bg-black/60">
              <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed max-h-full overflow-hidden">
                {previewState.previewContent.length > 200 
                  ? `${previewState.previewContent.substring(0, 200)}...` 
                  : previewState.previewContent}
              </pre>
            </div>
          )}
          
          {/* Content type indicator */}
          {hasContent && (
            <div className="absolute top-2 right-2 bg-black/60 text-white/70 text-xs px-2 py-1 rounded-full flex items-center gap-1.5">
              {contentType === 'image' && <ImageIcon size={12} />}
              {contentType === 'video' && <VideoIcon size={12} />}
              {contentType === 'text' && <FileTextIcon size={12} />}
              <span className="capitalize">{contentType}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PreviewNode; 