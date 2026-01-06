import React, { useState, useRef, useEffect } from 'react';
import { Type, Save, RefreshCw, X, Bold, Italic, AlignLeft, AlignCenter, AlignRight, Palette } from 'lucide-react';
import { TextStyle } from './types';

interface TextLayer {
  id: string;
  text: string;
  x: number;
  y: number;
  style: TextStyle;
  isEditing: boolean;
}

interface TextModalProps {
  isVisible: boolean;
  position: { x: number; y: number };
  zIndex: number;
  isDragging: boolean;
  textStyle: TextStyle;
  onPositionChange: (position: { x: number; y: number }) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onTextStyleChange: (style: TextStyle) => void;
  onAddText: (text: string, style: TextStyle) => void;
  onSave: () => void;
  onReset: () => void;
  onClose: () => void;
  onBringToFront: () => void;
  isOnTop: boolean;
  onHover?: (isHovering: boolean) => void;
  canvasRef?: React.RefObject<HTMLCanvasElement>;
  imageObj?: HTMLImageElement | null;
  scale?: number;
  translateX?: number;
  translateY?: number;
}

const TextModal: React.FC<TextModalProps> = ({
  isVisible,
  position,
  zIndex,
  isDragging,
  textStyle,
  onPositionChange,
  onDragStart,
  onDragEnd,
  onTextStyleChange,
  onAddText,
  onSave,
  onReset,
  onClose,
  onBringToFront,
  isOnTop,
  onHover,
  canvasRef,
  imageObj,
  scale = 1,
  translateX = 0,
  translateY = 0
}) => {
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const textCanvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  const [text, setText] = useState('');
  const [localStyle, setLocalStyle] = useState<TextStyle>(textStyle);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showOutlineColor, setShowOutlineColor] = useState(false);
  const [textLayers, setTextLayers] = useState<TextLayer[]>([]);
  const [activeTextLayer, setActiveTextLayer] = useState<string | null>(null);
  const [isAddingText, setIsAddingText] = useState(false);
  const [editingText, setEditingText] = useState('');

  // Font options
  const fontFamilies = [
    'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Courier New',
    'Verdana', 'Trebuchet MS', 'Impact', 'Comic Sans MS', 'Palatino',
    'Garamond', 'Bookman', 'Tahoma', 'Lucida Console', 'Monaco'
  ];

  const warpStyles = [
    { id: 'none', name: 'None' },
    { id: 'arc', name: 'Arc' },
    { id: 'wave', name: 'Wave' },
    { id: 'flag', name: 'Flag' },
    { id: 'fish', name: 'Fish' },
    { id: 'inflate', name: 'Inflate' },
    { id: 'squeeze', name: 'Squeeze' }
  ];

  useEffect(() => {
    setLocalStyle(textStyle);
  }, [textStyle]);

  // Setup text canvas overlay
  useEffect(() => {
    if (!canvasRef?.current || !textCanvasRef.current || !isVisible) return;

    const mainCanvas = canvasRef.current;
    const textCanvas = textCanvasRef.current;

    // Match text canvas size to main canvas
    textCanvas.width = mainCanvas.width;
    textCanvas.height = mainCanvas.height;

    // Position text canvas exactly over main canvas
    textCanvas.style.position = 'absolute';
    textCanvas.style.top = '0';
    textCanvas.style.left = '0';
    textCanvas.style.width = `${mainCanvas.offsetWidth}px`;
    textCanvas.style.height = `${mainCanvas.offsetHeight}px`;
    textCanvas.style.pointerEvents = 'auto';
    textCanvas.style.zIndex = '150';
    textCanvas.style.cursor = 'text';

    // Append to canvas parent
    if (mainCanvas.parentNode && !mainCanvas.parentNode.contains(textCanvas)) {
      mainCanvas.parentNode.appendChild(textCanvas);
    }

    return () => {
      if (textCanvas.parentNode) {
        textCanvas.parentNode.removeChild(textCanvas);
      }
    };
  }, [canvasRef, isVisible]);

  // Canvas click handler for adding text
  useEffect(() => {
    if (!isVisible || !canvasRef?.current || !imageObj) return;

    const canvas = canvasRef.current;

    const handleCanvasClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;

      // Convert canvas coordinates to image coordinates
      const imageX = (canvasX - translateX) / scale;
      const imageY = (canvasY - translateY) / scale;

      // Check if click is within image bounds
      if (imageX < 0 || imageY < 0 || imageX > imageObj.width || imageY > imageObj.height) {
        return;
      }

      // Check if clicking on existing text layer
      const clickedLayer = textLayers.find(layer => {
        const layerX = layer.x * scale + translateX;
        const layerY = layer.y * scale + translateY;
        const textWidth = getTextWidth(layer.text, layer.style) * scale;
        const textHeight = layer.style.fontSize * scale;
        
        return (
          canvasX >= layerX && 
          canvasX <= layerX + textWidth &&
          canvasY >= layerY - textHeight &&
          canvasY <= layerY
        );
      });

      if (clickedLayer) {
        // Edit existing text
        setActiveTextLayer(clickedLayer.id);
        setEditingText(clickedLayer.text);
        startTextEditing(clickedLayer);
      } else {
        // Create new text layer
        const newLayerId = `text-${Date.now()}`;
        const newLayer: TextLayer = {
          id: newLayerId,
          text: 'New Text',
          x: imageX,
          y: imageY,
          style: { ...localStyle },
          isEditing: true
        };
        
        setTextLayers(prev => [...prev, newLayer]);
        setActiveTextLayer(newLayerId);
        setEditingText('New Text');
        startTextEditing(newLayer);
      }
    };

    canvas.addEventListener('click', handleCanvasClick);
    return () => canvas.removeEventListener('click', handleCanvasClick);
  }, [isVisible, canvasRef, imageObj, scale, translateX, translateY, textLayers, localStyle]);

  // Render text layers on canvas
  useEffect(() => {
    if (!textCanvasRef.current || !isVisible) return;

    const canvas = textCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Render all text layers
    textLayers.forEach(layer => {
      if (layer.isEditing && layer.id === activeTextLayer) {
        renderEditingText(ctx, layer);
      } else {
        renderTextLayer(ctx, layer);
      }
    });
  }, [textLayers, activeTextLayer, scale, translateX, translateY, isVisible]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    onBringToFront();
    onDragStart();
    
    const panelElement = e.currentTarget.closest('[style*="left:"]') as HTMLElement;
    if (!panelElement) return;
    
    const rect = panelElement.getBoundingClientRect();
    
    dragOffsetRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  // Global mouse events for dragging
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      
      const newX = e.clientX - dragOffsetRef.current.x;
      const newY = e.clientY - dragOffsetRef.current.y;
      
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const panelWidth = 320;
      const panelHeight = 600;
      
      const constrainedX = Math.max(0, Math.min(newX, viewportWidth - panelWidth));
      const constrainedY = Math.max(0, Math.min(newY, viewportHeight - panelHeight));
      
      onPositionChange({ x: constrainedX, y: constrainedY });
    };

    const handleGlobalMouseUp = () => {
      onDragEnd();
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, onPositionChange, onDragEnd]);

  // Helper function to calculate text width
  const getTextWidth = (text: string, style: TextStyle): number => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`;
    return ctx.measureText(text).width;
  };

  // Helper function to render a text layer
  const renderTextLayer = (ctx: CanvasRenderingContext2D, layer: TextLayer) => {
    const x = layer.x * scale + translateX;
    const y = layer.y * scale + translateY;
    
    // Set text properties
    ctx.font = `${layer.style.fontStyle} ${layer.style.fontWeight} ${layer.style.fontSize * scale}px ${layer.style.fontFamily}`;
    ctx.textAlign = layer.style.textAlign as CanvasTextAlign;
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = layer.style.color;
    
    // Draw outline if specified
    if (layer.style.outline) {
      ctx.strokeStyle = layer.style.outline.color;
      ctx.lineWidth = layer.style.outline.width * scale;
      ctx.strokeText(layer.text, x, y);
    }
    
    // Draw text
    ctx.fillText(layer.text, x, y);
  };

  // Helper function to render editing text with cursor
  const renderEditingText = (ctx: CanvasRenderingContext2D, layer: TextLayer) => {
    const x = layer.x * scale + translateX;
    const y = layer.y * scale + translateY;
    
    // Set text properties
    ctx.font = `${layer.style.fontStyle} ${layer.style.fontWeight} ${layer.style.fontSize * scale}px ${layer.style.fontFamily}`;
    ctx.textAlign = layer.style.textAlign as CanvasTextAlign;
    ctx.textBaseline = 'bottom';
    
    // Draw semi-transparent background
    const textWidth = getTextWidth(editingText, layer.style) * scale;
    const textHeight = layer.style.fontSize * scale;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
    ctx.fillRect(x - 5, y - textHeight - 5, textWidth + 10, textHeight + 10);
    
    // Draw text
    ctx.fillStyle = layer.style.color;
    if (layer.style.outline) {
      ctx.strokeStyle = layer.style.outline.color;
      ctx.lineWidth = layer.style.outline.width * scale;
      ctx.strokeText(editingText, x, y);
    }
    ctx.fillText(editingText, x, y);
    
    // Draw blinking cursor
    const cursorX = x + getTextWidth(editingText, layer.style) * scale;
    if (Math.floor(Date.now() / 500) % 2) {
      ctx.strokeStyle = layer.style.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cursorX, y);
      ctx.lineTo(cursorX, y - textHeight);
      ctx.stroke();
    }
  };

  // Start text editing
  const startTextEditing = (layer: TextLayer) => {
    // Create invisible input for keyboard handling
    const input = document.createElement('input');
    input.style.position = 'absolute';
    input.style.left = '-9999px';
    input.style.opacity = '0';
    input.value = editingText;
    document.body.appendChild(input);
    input.focus();
    
    const handleInput = (e: Event) => {
      const target = e.target as HTMLInputElement;
      setEditingText(target.value);
    };
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        finishTextEditing(layer.id, e.key === 'Enter');
        input.removeEventListener('input', handleInput);
        input.removeEventListener('keydown', handleKeyDown);
        document.body.removeChild(input);
      }
    };
    
    input.addEventListener('input', handleInput);
    input.addEventListener('keydown', handleKeyDown);
  };

  // Finish text editing
  const finishTextEditing = (layerId: string, save: boolean) => {
    if (save && editingText.trim()) {
      setTextLayers(prev => prev.map(layer => 
        layer.id === layerId 
          ? { ...layer, text: editingText.trim(), isEditing: false }
          : layer
      ));
    } else if (!save || !editingText.trim()) {
      // Remove layer if empty or cancelled
      setTextLayers(prev => prev.filter(layer => layer.id !== layerId));
    }
    
    setActiveTextLayer(null);
    setEditingText('');
  };

  const updateStyle = (updates: Partial<TextStyle>) => {
    const newStyle = { ...localStyle, ...updates };
    setLocalStyle(newStyle);
    onTextStyleChange(newStyle);
    
    // Update active text layer style if editing
    if (activeTextLayer) {
      setTextLayers(prev => prev.map(layer => 
        layer.id === activeTextLayer 
          ? { ...layer, style: newStyle }
          : layer
      ));
    }
  };

  const handleAddText = () => {
    if (text.trim()) {
      onAddText(text, localStyle);
      setText('');
    }
  };

  if (!isVisible) return null;

  return (
    <div 
      className="absolute"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: position.y === 0 ? 'translateY(50vh) translateY(-50%)' : 'none',
        zIndex: zIndex
      }}
    >
      <div 
        className={`bg-black/90 border rounded-lg w-80 max-h-[70vh] overflow-hidden shadow-2xl transition-all duration-200 ${
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
        onMouseEnter={() => onHover?.(true)}
        onMouseLeave={() => onHover?.(false)}
      >
        {/* Header - Draggable */}
        <div 
          className={`px-4 py-3 border-b border-white/10 flex items-center justify-between ${
            isDragging ? 'cursor-grabbing' : 'cursor-grab'
          } select-none transition-colors duration-200 ${
            isDragging ? 'bg-white/5' : 'hover:bg-white/5'
          }`}
          onMouseDown={handleMouseDown}
          title="Drag to move panel • Double-click to reset position"
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
            <h3 className="text-white text-sm font-medium">Text Tool</h3>
          </div>
          <div className="flex items-center gap-1">
            {/* Save Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSave();
              }}
              className="text-white/60 hover:text-white transition-colors p-1.5 rounded-md hover:bg-white/10"
              title="Save text settings"
            >
              <Save size={14} />
            </button>
            
            {/* Reset Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onReset();
              }}
              className="text-white/60 hover:text-white transition-colors p-1.5 rounded-md hover:bg-white/10"
              title="Reset to defaults"
            >
              <RefreshCw size={14} />
            </button>
            
            {/* Close Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="text-white/60 hover:text-white transition-colors p-1.5 rounded-md hover:bg-white/10"
              title="Close text tool"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        
        {/* Text Controls - Scrollable Content */}
        <div 
          className="p-4 space-y-4 overflow-y-auto max-h-[calc(70vh-80px)] scrollbar-hide" 
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}
        >
          {/* Click to Add Text Instructions */}
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
            <div className="text-blue-200 text-xs mb-1 font-medium">💡 How to Add Text</div>
            <div className="space-y-1 text-xs text-blue-200/70">
              <div>• Click anywhere on the image to add text</div>
              <div>• Click existing text to edit it</div>
              <div>• Press Enter to confirm, Escape to cancel</div>
              <div>• Adjust styles before or during editing</div>
            </div>
          </div>

          {/* Active Text Layers */}
          {textLayers.length > 0 && (
            <div className="space-y-2">
              <label className="text-white/70 text-xs block">Text Layers ({textLayers.length})</label>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {textLayers.map(layer => (
                  <div 
                    key={layer.id}
                    className={`bg-black/30 border rounded-lg p-2 text-xs transition-all ${
                      layer.id === activeTextLayer 
                        ? 'border-blue-400/50 bg-blue-500/10' 
                        : 'border-white/10 hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="text-white truncate">{layer.text}</div>
                        <div className="text-white/50 text-xs">
                          {layer.style.fontFamily} • {layer.style.fontSize}px
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {layer.isEditing && (
                          <span className="text-blue-400 text-xs">editing...</span>
                        )}
                        <button
                          onClick={() => {
                            setTextLayers(prev => prev.filter(l => l.id !== layer.id));
                          }}
                          className="text-red-400/60 hover:text-red-400 transition-colors p-1"
                          title="Delete text layer"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Font Family */}
          <div className="space-y-2">
            <label className="text-white/70 text-xs block">Font Family</label>
            <select
              value={localStyle.fontFamily}
              onChange={(e) => updateStyle({ fontFamily: e.target.value })}
              className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
            >
              {fontFamilies.map(font => (
                <option key={font} value={font} style={{ fontFamily: font }}>
                  {font}
                </option>
              ))}
            </select>
          </div>

          {/* Font Size */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-white/70 text-xs">Font Size</label>
              <input
                type="number"
                min="8"
                max="200"
                value={localStyle.fontSize}
                onChange={(e) => updateStyle({ fontSize: parseInt(e.target.value) || 16 })}
                className="w-16 bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-white text-center focus:outline-none focus:ring-1 focus:ring-white/20"
              />
            </div>
            <input
              type="range"
              min="8"
              max="200"
              value={localStyle.fontSize}
              onChange={(e) => updateStyle({ fontSize: parseInt(e.target.value) })}
              className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
            />
          </div>

          {/* Font Style & Weight */}
          <div className="space-y-2">
            <label className="text-white/70 text-xs block">Style & Weight</label>
            <div className="flex gap-2">
              <button
                onClick={() => updateStyle({ 
                  fontWeight: localStyle.fontWeight === 'bold' ? 'normal' : 'bold' 
                })}
                className={`flex-1 px-3 py-2 rounded-md text-xs transition-all ${
                  localStyle.fontWeight === 'bold'
                    ? 'bg-white/20 text-white border border-white/40'
                    : 'bg-black/30 text-white/70 border border-white/10 hover:bg-white/10'
                }`}
              >
                <Bold size={14} className="mx-auto" />
              </button>
              <button
                onClick={() => updateStyle({ 
                  fontStyle: localStyle.fontStyle === 'italic' ? 'normal' : 'italic' 
                })}
                className={`flex-1 px-3 py-2 rounded-md text-xs transition-all ${
                  localStyle.fontStyle === 'italic'
                    ? 'bg-white/20 text-white border border-white/40'
                    : 'bg-black/30 text-white/70 border border-white/10 hover:bg-white/10'
                }`}
              >
                <Italic size={14} className="mx-auto" />
              </button>
            </div>
          </div>

          {/* Text Align */}
          <div className="space-y-2">
            <label className="text-white/70 text-xs block">Alignment</label>
            <div className="flex gap-2">
              {(['left', 'center', 'right'] as const).map(align => (
                <button
                  key={align}
                  onClick={() => updateStyle({ textAlign: align })}
                  className={`flex-1 px-3 py-2 rounded-md text-xs transition-all ${
                    localStyle.textAlign === align
                      ? 'bg-white/20 text-white border border-white/40'
                      : 'bg-black/30 text-white/70 border border-white/10 hover:bg-white/10'
                  }`}
                >
                  {align === 'left' && <AlignLeft size={14} className="mx-auto" />}
                  {align === 'center' && <AlignCenter size={14} className="mx-auto" />}
                  {align === 'right' && <AlignRight size={14} className="mx-auto" />}
                </button>
              ))}
            </div>
          </div>

          {/* Text Color */}
          <div className="space-y-2">
            <label className="text-white/70 text-xs block">Text Color</label>
            <div className="flex items-center gap-2">
              <div 
                className="w-8 h-8 rounded-lg border-2 border-white/20 cursor-pointer hover:border-white/40 transition-colors"
                style={{ backgroundColor: localStyle.color }}
                onClick={() => setShowColorPicker(!showColorPicker)}
              />
              <input
                type="text"
                value={localStyle.color}
                onChange={(e) => updateStyle({ color: e.target.value })}
                className="flex-1 bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                placeholder="#ffffff"
              />
            </div>
          </div>

          {/* Letter Spacing */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-white/70 text-xs">Letter Spacing</label>
              <span className="text-white/50 text-xs">{localStyle.letterSpacing}px</span>
            </div>
            <input
              type="range"
              min="-5"
              max="20"
              value={localStyle.letterSpacing}
              onChange={(e) => updateStyle({ letterSpacing: parseInt(e.target.value) })}
              className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
            />
          </div>

          {/* Line Height */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-white/70 text-xs">Line Height</label>
              <span className="text-white/50 text-xs">{localStyle.lineHeight}</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.1"
              value={localStyle.lineHeight}
              onChange={(e) => updateStyle({ lineHeight: parseFloat(e.target.value) })}
              className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
            />
          </div>

          {/* Text Effects */}
          <div className="space-y-2">
            <label className="text-white/70 text-xs block">Text Effects</label>
            
            {/* Outline */}
            <div className="bg-black/30 border border-white/10 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-white/70 text-xs">Outline</span>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!localStyle.outline}
                    onChange={(e) => {
                      if (e.target.checked) {
                        updateStyle({ outline: { width: 2, color: '#000000' } });
                      } else {
                        updateStyle({ outline: undefined });
                      }
                    }}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-black/30 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-white/30"></div>
                </label>
              </div>
              
              {localStyle.outline && (
                <div className="space-y-2">
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={localStyle.outline.width}
                    onChange={(e) => updateStyle({ 
                      outline: { ...localStyle.outline!, width: parseInt(e.target.value) }
                    })}
                    className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
                  />
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-6 h-6 rounded border-2 border-white/20 cursor-pointer hover:border-white/40 transition-colors"
                      style={{ backgroundColor: localStyle.outline.color }}
                      onClick={() => setShowOutlineColor(!showOutlineColor)}
                    />
                    <input
                      type="text"
                      value={localStyle.outline.color}
                      onChange={(e) => updateStyle({ 
                        outline: { ...localStyle.outline!, color: e.target.value }
                      })}
                      className="flex-1 bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-white/20"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Text Warp */}
          <div className="space-y-2">
            <label className="text-white/70 text-xs block">Text Warp</label>
            <select
              value={localStyle.warpStyle || 'none'}
              onChange={(e) => updateStyle({ 
                warpStyle: e.target.value as TextStyle['warpStyle'],
                warpAmount: e.target.value === 'none' ? 0 : 50
              })}
              className="w-full bg-black/30 border border-white/10 rounded-lg p-2 text-white text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
            >
              {warpStyles.map(style => (
                <option key={style.id} value={style.id}>
                  {style.name}
                </option>
              ))}
            </select>
            
            {localStyle.warpStyle && localStyle.warpStyle !== 'none' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-white/70 text-xs">Warp Amount</span>
                  <span className="text-white/50 text-xs">{localStyle.warpAmount}%</span>
                </div>
                <input
                  type="range"
                  min="-100"
                  max="100"
                  value={localStyle.warpAmount || 0}
                  onChange={(e) => updateStyle({ warpAmount: parseInt(e.target.value) })}
                  className="w-full h-1 bg-white/20 rounded-lg appearance-none cursor-pointer slider"
                />
              </div>
            )}
          </div>

          {/* Text Preview */}
          <div className="bg-black/30 border border-white/10 rounded-lg p-4">
            <div className="text-white/70 text-xs mb-2">Preview</div>
            <div 
              className="min-h-[60px] flex items-center justify-center"
              style={{
                fontFamily: localStyle.fontFamily,
                fontSize: `${Math.min(localStyle.fontSize, 24)}px`,
                fontWeight: localStyle.fontWeight,
                fontStyle: localStyle.fontStyle,
                textAlign: localStyle.textAlign,
                color: localStyle.color,
                letterSpacing: `${localStyle.letterSpacing}px`,
                lineHeight: localStyle.lineHeight,
                ...(localStyle.outline ? {
                  textShadow: `
                    -${localStyle.outline.width}px -${localStyle.outline.width}px 0 ${localStyle.outline.color},
                    ${localStyle.outline.width}px -${localStyle.outline.width}px 0 ${localStyle.outline.color},
                    -${localStyle.outline.width}px ${localStyle.outline.width}px 0 ${localStyle.outline.color},
                    ${localStyle.outline.width}px ${localStyle.outline.width}px 0 ${localStyle.outline.color}
                  `
                } : {})
              }}
            >
              {text || 'Sample Text'}
            </div>
          </div>
        </div>
      </div>
      
      {/* Text Canvas Overlay */}
      <canvas
        ref={textCanvasRef}
        style={{ display: isVisible ? 'block' : 'none' }}
      />
    </div>
  );
};

export default TextModal; 