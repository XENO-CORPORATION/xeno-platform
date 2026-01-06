import React, { useState, useRef, useEffect } from 'react';
import { Scissors, X, Download, Trash2, Eye, EyeOff, MousePointer, Square, Circle, Wand2, Undo, Redo, Save, RefreshCw } from 'lucide-react';

interface SegmentationPoint {
  x: number;
  y: number;
  type: 'positive' | 'negative'; // positive = include, negative = exclude
  id: string;
}

interface SegmentationMask {
  id: string;
  points: SegmentationPoint[];
  maskData: ImageData | null;
  visible: boolean;
  color: string;
  name: string;
}

interface SegmentationModalProps {
  isVisible: boolean;
  position: { x: number; y: number };
  zIndex: number;
  onClose: () => void;
  onBringToFront: () => void;
  isOnTop: boolean;
  imageUrl: string | null;
  onSegmentationComplete?: (maskData: ImageData, originalImage: string) => void;
  onCanvasClick?: (x: number, y: number, type: 'positive' | 'negative') => void;
  canvasRef?: React.RefObject<HTMLCanvasElement>;
}

const SegmentationModal: React.FC<SegmentationModalProps> = ({
  isVisible,
  position,
  zIndex,
  onClose,
  onBringToFront,
  isOnTop,
  imageUrl,
  onSegmentationComplete,
  onCanvasClick,
  canvasRef
}) => {
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [currentPosition, setCurrentPosition] = useState(position);
  
  // Segmentation state
  const [masks, setMasks] = useState<SegmentationMask[]>([]);
  const [activeMaskId, setActiveMaskId] = useState<string | null>(null);
  const [segmentationMode, setSegmentationMode] = useState<'click' | 'box' | 'auto'>('click');
  const [isSegmenting, setIsSegmenting] = useState(false);
  const [showAllMasks, setShowAllMasks] = useState(true);
  const [brushSize, setBrushSize] = useState(10);
  
  // Canvas refs for preview

  const [previewImage, setPreviewImage] = useState<HTMLImageElement | null>(null);

  // Predefined colors for masks
  const maskColors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
  ];

  // Load canvas image for reference
  useEffect(() => {
    if (!imageUrl || !isVisible) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setPreviewImage(img);
    };
    img.onerror = () => {
      console.error('Failed to load canvas image for segmentation');
    };
    img.src = imageUrl;
  }, [imageUrl, isVisible]);

  // Handle external canvas interaction
  useEffect(() => {
    if (!isVisible || segmentationMode !== 'click' || !canvasRef?.current) return;

    const canvas = canvasRef.current;
    
    const handleCanvasClickExternal = (e: MouseEvent) => {
      if (!previewImage) return;

      const rect = canvas.getBoundingClientRect();
      
      // Calculate click coordinates relative to the canvas
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      
      // Convert to image coordinates (assuming canvas displays the full image)
      const scaleX = previewImage.width / rect.width;
      const scaleY = previewImage.height / rect.height;
      
      const imageX = clickX * scaleX;
      const imageY = clickY * scaleY;

      const pointType = e.shiftKey ? 'negative' : 'positive';
      
      // Call the external handler if provided, otherwise use internal logic
      if (onCanvasClick) {
        onCanvasClick(imageX, imageY, pointType);
      } else {
        addSegmentationPoint(imageX, imageY, pointType);
      }
    };

    canvas.addEventListener('click', handleCanvasClickExternal);
    
    return () => {
      canvas.removeEventListener('click', handleCanvasClickExternal);
    };
  }, [isVisible, segmentationMode, canvasRef, previewImage, onCanvasClick]);

  // Create new mask
  const createNewMask = () => {
    const newMask: SegmentationMask = {
      id: `mask-${Date.now()}`,
      points: [],
      maskData: null,
      visible: true,
      color: maskColors[masks.length % maskColors.length],
      name: `Mask ${masks.length + 1}`
    };
    setMasks(prev => [...prev, newMask]);
    setActiveMaskId(newMask.id);
    return newMask;
  };

  // Add segmentation point
  const addSegmentationPoint = async (x: number, y: number, type: 'positive' | 'negative') => {
    if (!activeMaskId) {
      createNewMask();
    }

    const point: SegmentationPoint = {
      x,
      y,
      type,
      id: `point-${Date.now()}`
    };

    setMasks(prev => prev.map(mask => 
      mask.id === activeMaskId 
        ? { ...mask, points: [...mask.points, point] }
        : mask
    ));

    // Trigger SAM 2 segmentation
    await performSegmentation(point);
  };

  // Perform SAM 2 segmentation
  const performSegmentation = async (newPoint: SegmentationPoint) => {
    if (!imageUrl || !activeMaskId) return;

    setIsSegmenting(true);
    
    try {
      const activeMask = masks.find(m => m.id === activeMaskId);
      if (!activeMask) return;

      // Prepare points for SAM 2
      const allPoints = [...activeMask.points, newPoint];
      const positivePoints = allPoints.filter(p => p.type === 'positive').map(p => [p.x, p.y]);
      const negativePoints = allPoints.filter(p => p.type === 'negative').map(p => [p.x, p.y]);

      console.log('🎯 Segmentation: Sending points to SAM 2:', {
        positive: positivePoints,
        negative: negativePoints
      });

      // Call SAM 2 API
      const response = await fetch('/api/chat/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          task: 'segment_image',
          imageUrl: imageUrl,
          points: {
            positive: positivePoints,
            negative: negativePoints
          },
          outputFormat: 'png'
        }),
      });

      if (!response.ok) {
        throw new Error(`Segmentation failed: ${response.status}`);
      }

      const result = await response.json();
      console.log('🎯 Segmentation: FAL.ai SAM 2 result:', result);

      if (result.success && result.image) {
        // FAL.ai returns a segmented image with URL
        const maskImageData = await createImageDataFromUrl(result.image.url);
        
        // Update mask with result
        setMasks(prev => prev.map(mask => 
          mask.id === activeMaskId 
            ? { ...mask, maskData: maskImageData }
            : mask
        ));
      }

    } catch (error) {
      console.error('🎯 Segmentation: Error:', error);
    } finally {
      setIsSegmenting(false);
    }
  };

  // Convert mask data to ImageData
  const createImageDataFromMask = async (maskData: string): Promise<ImageData> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        resolve(imageData);
      };
      img.src = `data:image/png;base64,${maskData}`;
    });
  };

  // Convert image URL to ImageData (for FAL.ai responses)
  const createImageDataFromUrl = async (imageUrl: string): Promise<ImageData> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // Handle CORS for external URLs
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        resolve(imageData);
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = imageUrl;
    });
  };

  // Auto-segment entire image
  const performAutoSegmentation = async () => {
    if (!imageUrl) return;

    setIsSegmenting(true);
    
    try {
      console.log('🎯 Auto-segmentation: Starting SAM 2 auto-segment');

      const response = await fetch('/api/chat/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          task: 'auto_segment_image',
          imageUrl: imageUrl,
          outputFormat: 'png'
        }),
      });

      if (!response.ok) {
        throw new Error(`Auto-segmentation failed: ${response.status}`);
      }

      const result = await response.json();
      console.log('🎯 Auto-segmentation: FAL.ai SAM 2 result:', result);

      if (result.success && result.image) {
        // FAL.ai returns a single segmented image for auto-segmentation
        const newMask: SegmentationMask = {
          id: `auto-mask-${Date.now()}`,
          points: [],
          maskData: await createImageDataFromUrl(result.image.url),
          visible: true,
          color: maskColors[0],
          name: `Auto Segmentation`
        };

        setMasks(prev => [...prev, newMask]);
      }

    } catch (error) {
      console.error('🎯 Auto-segmentation: Error:', error);
    } finally {
      setIsSegmenting(false);
    }
  };

  // Delete mask
  const deleteMask = (maskId: string) => {
    setMasks(prev => prev.filter(m => m.id !== maskId));
    if (activeMaskId === maskId) {
      setActiveMaskId(null);
    }
  };

  // Toggle mask visibility
  const toggleMaskVisibility = (maskId: string) => {
    setMasks(prev => prev.map(mask => 
      mask.id === maskId 
        ? { ...mask, visible: !mask.visible }
        : mask
    ));
  };

  // Export segmentation
  const exportSegmentation = () => {
    const activeMask = masks.find(m => m.id === activeMaskId);
    if (activeMask && activeMask.maskData && onSegmentationComplete && imageUrl) {
      onSegmentationComplete(activeMask.maskData, imageUrl);
    }
  };

  // Clear all masks
  const clearAllMasks = () => {
    setMasks([]);
    setActiveMaskId(null);
  };



  // Dragging functionality
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    onBringToFront();
    setIsDragging(true);
    
    const panelElement = e.currentTarget.closest('[style*="left:"]') as HTMLElement;
    if (!panelElement) return;
    
    const rect = panelElement.getBoundingClientRect();
    dragOffsetRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      
      const newX = e.clientX - dragOffsetRef.current.x;
      const newY = e.clientY - dragOffsetRef.current.y;
      
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const panelWidth = 420;
      const panelHeight = 650;
      
      const constrainedX = Math.max(0, Math.min(newX, viewportWidth - panelWidth));
      const constrainedY = Math.max(0, Math.min(newY, viewportHeight - panelHeight));
      
      setCurrentPosition({ x: constrainedX, y: constrainedY });
    };

    const handleGlobalMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging]);

  if (!isVisible) return null;

  return (
    <div 
      className="absolute"
      style={{
        left: `${currentPosition.x}px`,
        top: currentPosition.y === 0 ? '50%' : `${currentPosition.y}px`,
        transform: currentPosition.y === 0 ? 'translateY(-50%)' : 'none',
        zIndex: zIndex
      }}
    >
      <div 
        className={`bg-black/90 border rounded-lg w-[420px] max-h-[85vh] overflow-hidden shadow-2xl transition-all duration-200 ${
          isDragging ? 'cursor-grabbing' : ''
        } ${
          isOnTop 
            ? 'border-white/40' 
            : 'border-white/20'
        }`}
        onClick={(e) => {
          e.stopPropagation();
          onBringToFront();
        }}
      >
        {/* Header - Draggable */}
        <div 
          className={`px-4 py-3 border-b border-white/10 flex items-center justify-between ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          } select-none transition-colors duration-200 ${
            isDragging ? 'bg-white/5' : 'hover:bg-white/5'
          }`}
          onMouseDown={handleMouseDown}
          title="Drag to move panel"
        >
          <div className="flex items-center gap-2">
            <div className="flex flex-col gap-0.5">
              <div className={`w-1 h-1 rounded-full transition-colors ${
                isDragging ? 'bg-white/80' : 'bg-white/40'
              }`}></div>
              <div className={`w-1 h-1 rounded-full transition-colors ${
                isDragging ? 'bg-white/80' : 'bg-white/40'
              }`}></div>
              <div className={`w-1 h-1 rounded-full transition-colors ${
                isDragging ? 'bg-white/80' : 'bg-white/40'
              }`}></div>
            </div>
            <h3 className="text-white text-sm font-medium">AI Segmentation</h3>
            <div className="text-xs text-white/50 bg-white/10 px-2 py-0.5 rounded">SAM 2</div>
          </div>
          <div className="flex items-center gap-1">
            {/* Save Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                exportSegmentation();
              }}
              className="text-white/60 hover:text-white transition-colors p-1.5 rounded-md hover:bg-white/10"
              title="Export segmentation"
              disabled={!activeMaskId || masks.length === 0}
            >
              <Save size={14} className={activeMaskId ? 'text-white' : 'text-white/30'} />
            </button>
            
            {/* Clear Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                clearAllMasks();
              }}
              className="text-white/60 hover:text-white transition-colors p-1.5 rounded-md hover:bg-white/10"
              title="Clear all masks"
              disabled={masks.length === 0}
            >
              <RefreshCw size={14} className={masks.length > 0 ? 'text-white' : 'text-white/30'} />
            </button>
            
            {/* Close Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="text-white/60 hover:text-white transition-colors p-1.5 rounded-md hover:bg-white/10"
              title="Close segmentation"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        
        {/* Content - Scrollable */}
        <div className="overflow-y-auto max-h-[calc(85vh-60px)]">
          {/* Instructions */}
          <div className="p-4 border-b border-white/10">
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${segmentationMode === 'click' ? 'bg-green-400 animate-pulse' : 'bg-blue-400'}`}></div>
                  <span className="text-blue-200 text-xs font-medium">
                    {segmentationMode === 'click' ? 'Click Mode Active' : 'Canvas Segmentation'}
                  </span>
                </div>
                <div className="text-xs text-white/50">
                  {masks.length} mask{masks.length !== 1 ? 's' : ''}
                </div>
              </div>
              <div className="text-white/70 text-xs space-y-1">
                <div>• <span className="text-green-400">Click</span> to add positive points (include)</div>
                <div>• <span className="text-red-400">Shift+Click</span> to add negative points (exclude)</div>
                <div>• Use Auto mode to segment everything at once</div>
              </div>
              {isSegmenting && (
                <div className="flex items-center mt-3 text-blue-200 text-xs">
                  <div className="animate-spin w-3 h-3 border border-blue-300/30 border-t-blue-300 rounded-full mr-2"></div>
                  Processing with SAM 2...
                </div>
              )}
            </div>
          </div>

          {/* Segmentation Mode */}
          <div className="p-4 border-b border-white/10">
            <div className="mb-3">
              <span className="text-white text-xs font-medium mb-2 block">Segmentation Mode</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setSegmentationMode('click')}
                  className={`flex-1 px-3 py-2 rounded-md text-xs transition-all ${
                    segmentationMode === 'click'
                      ? 'bg-white/20 text-white border border-white/40'
                      : 'bg-white/5 text-white/70 border border-white/20 hover:bg-white/10'
                  }`}
                >
                  <MousePointer size={12} className="inline mr-1" />
                  Click
                </button>
                <button
                  onClick={() => setSegmentationMode('box')}
                  className={`flex-1 px-3 py-2 rounded-md text-xs transition-all ${
                    segmentationMode === 'box'
                      ? 'bg-white/20 text-white border border-white/40'
                      : 'bg-white/5 text-white/70 border border-white/20 hover:bg-white/10'
                  }`}
                >
                  <Square size={12} className="inline mr-1" />
                  Box
                </button>
                <button
                  onClick={() => setSegmentationMode('auto')}
                  className={`flex-1 px-3 py-2 rounded-md text-xs transition-all ${
                    segmentationMode === 'auto'
                      ? 'bg-white/20 text-white border border-white/40'
                      : 'bg-white/5 text-white/70 border border-white/20 hover:bg-white/10'
                  }`}
                >
                  <Wand2 size={12} className="inline mr-1" />
                  Auto
                </button>
              </div>
            </div>

            {segmentationMode === 'auto' && (
              <button
                onClick={performAutoSegmentation}
                disabled={isSegmenting}
                className="w-full bg-white/10 hover:bg-white/20 border border-white/20 text-white text-sm font-medium py-2 px-4 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSegmenting ? (
                  <>
                    <div className="animate-spin w-4 h-4 border border-white/30 border-t-white rounded-full inline mr-2"></div>
                    Segmenting...
                  </>
                ) : (
                  <>
                    <Wand2 size={16} className="inline mr-2" />
                    Auto-Segment Everything
                  </>
                )}
              </button>
            )}

            {segmentationMode === 'click' && (
              <div className="text-xs text-white/60 bg-white/5 p-2 rounded">
                <strong>Click:</strong> Add positive point<br/>
                <strong>Shift+Click:</strong> Add negative point
              </div>
            )}
          </div>

          {/* Masks List */}
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-white text-xs font-medium">Masks ({masks.length})</span>
              <button
                onClick={createNewMask}
                className="text-white/60 hover:text-white transition-colors text-xs bg-white/10 hover:bg-white/20 px-2 py-1 rounded"
              >
                + New Mask
              </button>
            </div>

            <div className="space-y-2 max-h-40 overflow-y-auto">
              {masks.map((mask, index) => (
                <div
                  key={mask.id}
                  className={`flex items-center gap-2 p-2 rounded-md transition-all ${
                    activeMaskId === mask.id
                      ? 'bg-white/20 border border-white/40'
                      : 'bg-white/5 border border-white/20 hover:bg-white/10'
                  }`}
                >
                  <div
                    className="w-4 h-4 rounded border border-white/40"
                    style={{ backgroundColor: mask.color }}
                  ></div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-xs font-medium truncate">{mask.name}</div>
                    <div className="text-white/50 text-xs">{mask.points.length} points</div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setActiveMaskId(mask.id)}
                      className={`p-1 rounded transition-colors ${
                        activeMaskId === mask.id
                          ? 'text-white bg-white/20'
                          : 'text-white/60 hover:text-white hover:bg-white/10'
                      }`}
                      title="Select mask"
                    >
                      <MousePointer size={10} />
                    </button>
                    
                    <button
                      onClick={() => toggleMaskVisibility(mask.id)}
                      className="text-white/60 hover:text-white transition-colors p-1 rounded hover:bg-white/10"
                      title={mask.visible ? "Hide mask" : "Show mask"}
                    >
                      {mask.visible ? <Eye size={10} /> : <EyeOff size={10} />}
                    </button>
                    
                    <button
                      onClick={() => deleteMask(mask.id)}
                      className="text-white/60 hover:text-red-400 transition-colors p-1 rounded hover:bg-white/10"
                      title="Delete mask"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                </div>
              ))}

              {masks.length === 0 && (
                <div className="text-center text-white/50 text-xs py-4">
                  No masks created yet.<br/>
                  Click on the image or use auto-segment to start.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SegmentationModal;