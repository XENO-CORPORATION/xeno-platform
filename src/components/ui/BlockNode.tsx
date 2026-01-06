import React, { useState, useEffect, useRef } from 'react';
import { Maximize2, Minimize2, Settings, ChevronDown, ChevronUp } from 'lucide-react';

interface BlockNodeProps {
  id: number;
  title: string;
  icon: React.ReactNode;
  description: string;
  type: 'llm' | 'image' | 'video' | 'utility' | 'upscale-image' | 'upscale-video' | string;
  initialPosition: { x: number; y: number };
  onPositionChange?: (id: number, position: { x: number; y: number }) => void;
  onNodeSelect?: (id: number) => void;
  onDragStateChange?: (isDragging: boolean) => void;
  isSelected?: boolean;
  isConnecting?: boolean;
  isConnectionSource?: boolean;
  isExecuting?: boolean;
  executionProgress?: number;
  inputs?: Array<{ id: string; type: string; label: string }>;
  outputs?: Array<{ id: string; type: string; label: string }>;
  onStartConnection?: (outputId: string, e: React.MouseEvent) => void;
  onCompleteConnection?: (inputId: string, e: React.MouseEvent) => void;
}

const BlockNode: React.FC<BlockNodeProps> = ({ 
  id,
  title, 
  icon, 
  description, 
  type, 
  initialPosition,
  onPositionChange,
  onNodeSelect,
  onDragStateChange,
  isSelected = false,
  isConnecting = false,
  isConnectionSource = false,
  isExecuting = false,
  executionProgress = 0,
  inputs = [{ id: "prompt", type: "text", label: "Prompt" }],
  outputs = [{ id: "text", type: "text", label: "Generated Text" }],
  onStartConnection,
  onCompleteConnection
}) => {
  const nodeRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(initialPosition);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, nodeX: 0, nodeY: 0 });
  const lastPositionRef = useRef({ x: initialPosition.x, y: initialPosition.y });
  const [isExpanded, setIsExpanded] = useState(false);
  const [nodeSettings, setNodeSettings] = useState({
    prompt: '',
    model: type === 'llm' ? 'gpt-4' : 
           type === 'image' ? 'stable-diffusion-xl' : 
           type === 'video' ? 'gen-2' : 
           type === 'upscale-image' ? 'real-esrgan' :
           type === 'upscale-video' ? 'topaz' : '',
    temperature: 0.7,
    resolution: '1024x1024',
    style: 'photorealistic',
    steps: 30,
    guidance: 7.5,
    fps: 24,
    duration: 3,
    upscaleFactor: 2,
    denoise: 50,
    stability: 50,
    enhanceDetails: true,
    preserveColors: true
  });

  // Type-specific styles
  const typeStyles = {
    llm: {
      bgColor: 'bg-[#1E1E1E]',
      textColor: 'text-white',
      borderColor: 'border-yellow-500/40',
      glowColor: 'rgba(234, 179, 8, 0.3)',
      inputColor: 'bg-[#333333]',
      outputColor: 'bg-[#444444]',
      progressColor: 'bg-yellow-500'
    },
    image: {
      bgColor: 'bg-[#1E1E1E]',
      textColor: 'text-white',
      borderColor: 'border-green-500/40',
      glowColor: 'rgba(34, 197, 94, 0.3)',
      inputColor: 'bg-[#333333]',
      outputColor: 'bg-[#444444]',
      progressColor: 'bg-green-500'
    },
    video: {
      bgColor: 'bg-[#1E1E1E]',
      textColor: 'text-white',
      borderColor: 'border-blue-500/40',
      glowColor: 'rgba(59, 130, 246, 0.3)',
      inputColor: 'bg-[#333333]',
      outputColor: 'bg-[#444444]',
      progressColor: 'bg-blue-500'
    },
    'upscale-image': {
      bgColor: 'bg-[#1E1E1E]',
      textColor: 'text-white',
      borderColor: 'border-pink-500/40',
      glowColor: 'rgba(236, 72, 153, 0.3)',
      inputColor: 'bg-[#333333]',
      outputColor: 'bg-[#444444]',
      progressColor: 'bg-pink-500'
    },
    'upscale-video': {
      bgColor: 'bg-[#1E1E1E]',
      textColor: 'text-white',
      borderColor: 'border-pink-500/40',
      glowColor: 'rgba(236, 72, 153, 0.3)',
      inputColor: 'bg-[#333333]',
      outputColor: 'bg-[#444444]',
      progressColor: 'bg-pink-500'
    },
    utility: {
      bgColor: 'bg-[#1E1E1E]',
      textColor: 'text-white',
      borderColor: 'border-purple-500/40',
      glowColor: 'rgba(168, 85, 247, 0.3)',
      inputColor: 'bg-[#333333]',
      outputColor: 'bg-[#444444]',
      progressColor: 'bg-purple-500'
    }
  };
  
  const currentTypeStyle = typeStyles[type as keyof typeof typeStyles] || 
    { 
      bgColor: 'bg-[#1E1E1E]', 
      textColor: 'text-white', 
      borderColor: 'border-white/40',
      glowColor: 'rgba(255, 255, 255, 0.15)',
      inputColor: 'bg-[#333333]',
      outputColor: 'bg-[#444444]',
      progressColor: 'bg-white'
    };

  // Update position when initialPosition changes
  useEffect(() => {
    if (!isDraggingRef.current) {
      setPosition(initialPosition);
      lastPositionRef.current = initialPosition;
      if (nodeRef.current) {
        nodeRef.current.style.transform = `translate3d(${initialPosition.x}px, ${initialPosition.y}px, 0)`;
      }
    }
  }, [initialPosition]);

  // Get canvas container and current zoom level
  const getCanvasInfo = () => {
    const canvasContainer = document.querySelector('.node-canvas-container');
    if (!canvasContainer) return { scale: 1, canvasRect: null };

    const style = window.getComputedStyle(canvasContainer);
    const transform = style.transform || 'scale(1)';
    const scaleMatch = transform.match(/scale\(([^)]+)\)/);
    const scale = scaleMatch ? parseFloat(scaleMatch[1]) : 1;
    const canvasRect = canvasContainer.getBoundingClientRect();

    return { scale, canvasRect };
  };

  // Convert screen coordinates to canvas coordinates
  const screenToCanvasCoords = (screenX: number, screenY: number) => {
    const { scale, canvasRect } = getCanvasInfo();
    if (!canvasRect) return { x: 0, y: 0 };

    // Get current canvas pan offset
    const style = window.getComputedStyle(canvasRect as unknown as Element);
    const transform = style.transform;
    const matches = transform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    const panX = matches ? parseFloat(matches[1]) : 0;
    const panY = matches ? parseFloat(matches[2]) : 0;

    // Convert screen coordinates to canvas coordinates
    const x = (screenX - canvasRect.left - panX) / scale;
    const y = (screenY - canvasRect.top - panY) / scale;

    return { x, y };
  };

  // Start dragging - with zoom and pan support
  const handleMouseDown = (e: React.MouseEvent) => {
    // Get the target element
    const target = e.target as HTMLElement;
    
    // Check if we're clicking on an interactive element
    const isInteractiveElement = 
      target.tagName === 'BUTTON' ||
      target.tagName === 'INPUT' ||
      target.tagName === 'SELECT' ||
      target.tagName === 'TEXTAREA' ||
      target.closest('button') ||
      target.closest('input') ||
      target.closest('select') ||
      target.closest('textarea') ||
      target.closest('[role="button"]') ||
      target.closest('.interactive-element');
    
    // Check if we're clicking on a connector
    const isConnector = 
      target.closest('.node-connector') || 
      target.closest('.node-control');
    
    // Check if we're clicking on a draggable area (header or explicitly marked)
    const isDraggableArea = 
      target.closest('.node-header') || 
      target.closest('.draggable-area');
    
    // If clicking on a connector, don't do anything (let the connector handle it)
    if (isConnector) {
      return;
    }
    
    // If clicking on an interactive element, don't select or drag
    if (isInteractiveElement && !isDraggableArea) {
      return;
    }
    
    e.stopPropagation();
    
    // When in connecting mode, only handle selection
    if (isConnecting && !isConnectionSource) {
      if (onNodeSelect) onNodeSelect(id);
      return;
    }
    
    // Always select the node when clicking
    if (onNodeSelect) onNodeSelect(id);
    
    if (!nodeRef.current) return;

    // Get current canvas info
    const { scale, canvasRect } = getCanvasInfo();
    if (!canvasRect) return;

    // Store initial positions
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      nodeX: position.x,
      nodeY: position.y
    };
    
    // Set dragging state
    isDraggingRef.current = true;
    if (onDragStateChange) onDragStateChange(true);
    
    // Add mouse move and up listeners
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    // Apply grabbing cursor and set will-change property
    if (nodeRef.current) {
      nodeRef.current.style.cursor = 'grabbing';
      nodeRef.current.style.zIndex = '30';
      nodeRef.current.style.willChange = 'transform';
    }
  };

  // Handle mouse movement - with zoom and pan support
  const handleMouseMove = (e: MouseEvent) => {
    if (!isDraggingRef.current || !nodeRef.current) return;

    // Get current canvas info
    const { scale, canvasRect } = getCanvasInfo();
    if (!canvasRect) return;

    // Calculate delta in screen coordinates
    const dx = (e.clientX - dragStartRef.current.x) / scale;
    const dy = (e.clientY - dragStartRef.current.y) / scale;

    // Apply delta to initial node position
    const newX = dragStartRef.current.nodeX + dx;
    const newY = dragStartRef.current.nodeY + dy;

    // Update node position with requestAnimationFrame for smoother movement
    requestAnimationFrame(() => {
      if (nodeRef.current) {
        nodeRef.current.style.transform = `translate3d(${newX}px, ${newY}px, 0)`;
        lastPositionRef.current = { x: newX, y: newY };
      }
    });
  };

  // End dragging
  const handleMouseUp = () => {
    if (!isDraggingRef.current) return;
    
    // Reset dragging state
    isDraggingRef.current = false;
    if (onDragStateChange) onDragStateChange(false);
    
    // Remove event listeners
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    
    // Reset cursor and will-change property
    if (nodeRef.current) {
      nodeRef.current.style.cursor = 'grab';
      nodeRef.current.style.zIndex = isSelected ? '5' : '1';
      nodeRef.current.style.willChange = 'auto';
    }
    
    // Update React state with final position
    const newPosition = lastPositionRef.current;
    setPosition(newPosition);
    
    // Notify parent
    if (onPositionChange) {
      onPositionChange(id, newPosition);
    }
  };

  // Touch events - with zoom and pan support
  const handleTouchStart = (e: React.TouchEvent) => {
    // Don't start dragging if we touched on an input or output connector
    if ((e.target as HTMLElement).closest('.node-connector') || 
        (e.target as HTMLElement).closest('.node-control')) {
      return;
    }
    
    e.stopPropagation();
    
    // When in connecting mode, only handle selection
    if (isConnecting && !isConnectionSource) {
      if (onNodeSelect) onNodeSelect(id);
      return;
    }
    
    // Always select the node when tapping
    if (onNodeSelect) onNodeSelect(id);
    
    if (!nodeRef.current || e.touches.length !== 1) return;

    const touch = e.touches[0];

    // Get current canvas info
    const { scale, canvasRect } = getCanvasInfo();
    if (!canvasRect) return;

    // Store initial positions
    dragStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      nodeX: position.x,
      nodeY: position.y
    };
    
    // Set dragging state
    isDraggingRef.current = true;
    if (onDragStateChange) onDragStateChange(true);
    
    // Add touch listeners
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('touchcancel', handleTouchEnd);
    
    // Apply styles for better performance
    if (nodeRef.current) {
      nodeRef.current.style.willChange = 'transform';
      nodeRef.current.style.zIndex = '30';
    }
  };

  // Handle touch movement - with zoom and pan support
  const handleTouchMove = (e: TouchEvent) => {
    if (!isDraggingRef.current || !nodeRef.current || e.touches.length !== 1) return;
    e.preventDefault(); // Prevent scrolling

    const touch = e.touches[0];

    // Get current canvas info
    const { scale, canvasRect } = getCanvasInfo();
    if (!canvasRect) return;

    // Calculate delta in screen coordinates
    const dx = (touch.clientX - dragStartRef.current.x) / scale;
    const dy = (touch.clientY - dragStartRef.current.y) / scale;

    // Apply delta to initial node position
    const newX = dragStartRef.current.nodeX + dx;
    const newY = dragStartRef.current.nodeY + dy;

    // Update node position with requestAnimationFrame for smoother movement
    requestAnimationFrame(() => {
      if (nodeRef.current) {
        nodeRef.current.style.transform = `translate3d(${newX}px, ${newY}px, 0)`;
        lastPositionRef.current = { x: newX, y: newY };
      }
    });
  };

  // End touch dragging
  const handleTouchEnd = () => {
    if (!isDraggingRef.current) return;
    
    // Reset dragging state
    isDraggingRef.current = false;
    if (onDragStateChange) onDragStateChange(false);
    
    // Remove event listeners
    document.removeEventListener('touchmove', handleTouchMove);
    document.removeEventListener('touchend', handleTouchEnd);
    document.removeEventListener('touchcancel', handleTouchEnd);
    
    // Reset styles
    if (nodeRef.current) {
      nodeRef.current.style.willChange = 'auto';
      nodeRef.current.style.zIndex = isSelected ? '5' : '1';
    }
    
    // Update React state with final position
    const newPosition = lastPositionRef.current;
    setPosition(newPosition);
    
    // Notify parent
    if (onPositionChange) {
      onPositionChange(id, newPosition);
    }
  };

  // Handle starting a connection from an output
  const handleStartConnection = (outputId: string, e: React.MouseEvent | React.TouchEvent) => {
    if (onStartConnection) {
      // For touch events, create an object with the properties needed from MouseEvent
      if ('touches' in e) {
        const touch = e.touches[0];
        const mouseEvent = {
          clientX: touch.clientX,
          clientY: touch.clientY,
          button: 0,
          buttons: 1,
          // Add other required properties
          preventDefault: () => e.preventDefault(),
          stopPropagation: () => e.stopPropagation()
        } as unknown as React.MouseEvent;
        
        onStartConnection(outputId, mouseEvent);
      } else {
        onStartConnection(outputId, e);
      }
    }
  };

  // Handle completing a connection to an input
  const handleCompleteConnection = (inputId: string, e: React.MouseEvent | React.TouchEvent) => {
    if (onCompleteConnection) {
      // For touch events, create an object with the properties needed from MouseEvent
      if ('touches' in e) {
        const touch = e.touches[0];
        const mouseEvent = {
          clientX: touch.clientX,
          clientY: touch.clientY,
          button: 0,
          buttons: 1,
          // Add other required properties
          preventDefault: () => e.preventDefault(),
          stopPropagation: () => e.stopPropagation()
        } as unknown as React.MouseEvent;
        
        onCompleteConnection(inputId, mouseEvent);
      } else {
        onCompleteConnection(inputId, e);
      }
    }
  };

  // Toggle node expansion
  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  // Handle settings changes
  const handleSettingChange = (key: string, value: any) => {
    setNodeSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  // Render node settings based on type
  const renderSettings = () => {
    switch (type) {
      case 'llm':
        return (
          <div className="space-y-4">
            {/* Model Selection */}
            <div className="bg-black/20 rounded-lg p-4">
              <label className="block text-xs font-medium text-white/70 mb-2">Model Selection</label>
              <select 
                value={nodeSettings.model}
                onChange={(e) => handleSettingChange('model', e.target.value)}
                className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
              >
                <option value="gpt-4o">GPT-4o</option>
                <option value="claude-3-sonnet">Claude 3 Sonnet</option>
                <option value="gemini">Gemini</option>
                <option value="grok-3">Grok 3</option>
                <option value="ollama">Ollama</option>
              </select>
              <p className="mt-2 text-xs text-white/50">Select the language model to use for text generation</p>
            </div>

            {/* Prompt Input */}
            <div className="bg-black/20 rounded-lg p-4">
              <label className="block text-xs font-medium text-white/70 mb-2">System Prompt</label>
              <textarea
                value={nodeSettings.prompt}
                onChange={(e) => handleSettingChange('prompt', e.target.value)}
                className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm min-h-[100px] focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20 resize-none"
                placeholder="Enter system instructions..."
              />
              <p className="mt-2 text-xs text-white/50">Define the behavior and context for the language model</p>
            </div>

            {/* Temperature Control */}
            <div className="bg-black/20 rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-medium text-white/70">Temperature</label>
                <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                  {nodeSettings.temperature}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={nodeSettings.temperature}
                onChange={(e) => handleSettingChange('temperature', parseFloat(e.target.value))}
                className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
              />
              <div className="flex justify-between text-xs text-white/50 mt-2">
                <span>Precise</span>
                <span>Balanced</span>
                <span>Creative</span>
              </div>
              <p className="mt-2 text-xs text-white/50">Adjust response creativity and randomness</p>
            </div>
          </div>
        );
      
      case 'image':
        return (
          <div className="space-y-4">
            {/* Model Selection */}
            <div className="bg-black/20 rounded-lg p-4">
              <label className="block text-xs font-medium text-white/70 mb-2">Model Selection</label>
              <select 
                value={nodeSettings.model}
                onChange={(e) => handleSettingChange('model', e.target.value)}
                className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
              >
                <option value="fal-ai/flux-pro/v1.1-ultra">Flux Pro v1.1-Ultra</option>
                <option value="fal-ai/luma-photon/flash">Luma Photon Flash</option>
                <option value="fal-ai/recraft/v3/text-to-image">Recraft V3</option>
                <option value="fal-ai/ideogram/v3">Ideogram V3</option>
                <option value="fal-ai/ideogram/v2a/turbo">Ideogram V2a Turbo</option>
                <option value="stable-diffusion-3.5">Stable Diffusion 3.5</option>
              </select>
              <p className="mt-2 text-xs text-white/50">Choose the AI model for image generation</p>
            </div>

            {/* Resolution Selection */}
            <div className="bg-black/20 rounded-lg p-4">
              <label className="block text-xs font-medium text-white/70 mb-2">Output Resolution</label>
              <div className="grid grid-cols-3 gap-2">
                {['512x512', '768x768', '1024x1024'].map((res) => (
                  <button
                    key={res}
                    onClick={(e) => handleSettingChange('resolution', res)}
                    className={`p-2 text-xs rounded-lg border transition-colors ${
                      nodeSettings.resolution === res
                        ? 'bg-white/20 border-white/30 text-white'
                        : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
                    }`}
                  >
                    {res}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-white/50">Select the output image dimensions</p>
            </div>

            {/* Style Selection */}
            <div className="bg-black/20 rounded-lg p-4">
              <label className="block text-xs font-medium text-white/70 mb-2">Image Style</label>
              <div className="grid grid-cols-2 gap-2">
                {['photorealistic', 'artistic', 'anime', 'digital-art'].map((style) => (
                  <button
                    key={style}
                    onClick={(e) => handleSettingChange('style', style)}
                    className={`p-2 text-xs rounded-lg border capitalize transition-colors ${
                      nodeSettings.style === style
                        ? 'bg-white/20 border-white/30 text-white'
                        : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
                    }`}
                  >
                    {style.replace('-', ' ')}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-white/50">Define the artistic style of the generated image</p>
            </div>

            {/* Generation Parameters */}
            <div className="bg-black/20 rounded-lg p-4 space-y-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-medium text-white/70">Steps</label>
                  <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                    {nodeSettings.steps}
                  </span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="150"
                  value={nodeSettings.steps}
                  onChange={(e) => handleSettingChange('steps', parseInt(e.target.value))}
                  className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
                />
                <p className="mt-2 text-xs text-white/50">Higher values produce more detailed results</p>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-medium text-white/70">Guidance Scale</label>
                  <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                    {nodeSettings.guidance}
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="20"
                  step="0.5"
                  value={nodeSettings.guidance}
                  onChange={(e) => handleSettingChange('guidance', parseFloat(e.target.value))}
                  className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
                />
                <p className="mt-2 text-xs text-white/50">Controls prompt adherence strength</p>
              </div>
            </div>
          </div>
        );
      
      case 'video':
        return (
          <div className="space-y-4">
            {/* Model Selection */}
            <div className="bg-black/20 rounded-lg p-4">
              <label className="block text-xs font-medium text-white/70 mb-2">Model Selection</label>
              <select 
                value={nodeSettings.model}
                onChange={(e) => handleSettingChange('model', e.target.value)}
                className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
              >
                <option value="hailuo-minimax">Hailuo Minimax</option>
                <option value="veo-2">Veo 2</option>
                <option value="kling-standard-1.6">Kling Standard 1.6</option>
                <option value="kling-pro-1.5">Kling Pro 1.5</option>
                <option value="luma-ray-2">Luma Ray 2</option>
                <option value="luma-dream-machine">Luma Dream Machine</option>
                <option value="pika">Pika</option>
                <option value="tencent-hunyuan">Tencent Hunyuan</option>
              </select>
              <p className="mt-2 text-xs text-white/50">Select the video generation model</p>
            </div>

            {/* Duration Control */}
            <div className="bg-black/20 rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-medium text-white/70">Duration</label>
                <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                  {nodeSettings.duration}s
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                value={nodeSettings.duration}
                onChange={(e) => handleSettingChange('duration', parseInt(e.target.value))}
                className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
              />
              <p className="mt-2 text-xs text-white/50">Set the output video duration in seconds</p>
            </div>

            {/* Frame Rate Selection */}
            <div className="bg-black/20 rounded-lg p-4">
              <label className="block text-xs font-medium text-white/70 mb-2">Frame Rate</label>
              <div className="grid grid-cols-3 gap-2">
                {[24, 30, 60].map((rate) => (
                  <button
                    key={rate}
                    onClick={(e) => handleSettingChange('fps', rate)}
                    className={`p-2 text-xs rounded-lg border transition-colors ${
                      nodeSettings.fps === rate
                        ? 'bg-white/20 border-white/30 text-white'
                        : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
                    }`}
                  >
                    {rate} FPS
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-white/50">Choose the video frame rate</p>
            </div>
          </div>
        );
        
      case 'upscale-image':
        return (
          <div className="space-y-4">
            {/* Model Selection */}
            <div className="bg-black/20 rounded-lg p-4">
              <label className="block text-xs font-medium text-white/70 mb-2">Model Selection</label>
              <select 
                value={nodeSettings.model}
                onChange={(e) => handleSettingChange('model', e.target.value)}
                className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
              >
                <option value="ximilar">Ximilar</option>
                <option value="deepai-image">DeepAI Image</option>
                <option value="upscale-media">Upscale.media</option>
                <option value="stability-ai">Stability AI</option>
                <option value="topaz-labs">Topaz Labs</option>
                <option value="magnific-ai">Magnific AI</option>
              </select>
              <p className="mt-2 text-xs text-white/50">Choose the image upscaling model</p>
            </div>

            {/* Upscale Factor */}
            <div className="bg-black/20 rounded-lg p-4">
              <label className="block text-xs font-medium text-white/70 mb-2">Upscale Factor</label>
              <div className="grid grid-cols-3 gap-2">
                {[2, 4, 6].map((factor) => (
                  <button
                    key={factor}
                    onClick={(e) => handleSettingChange('upscaleFactor', factor)}
                    className={`p-2 text-xs rounded-lg border transition-colors ${
                      nodeSettings.upscaleFactor === factor
                        ? 'bg-white/20 border-white/30 text-white'
                        : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
                    }`}
                  >
                    {factor}x
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-white/50">Select the upscaling factor</p>
            </div>
          </div>
        );
        
      case 'upscale-video':
        return (
          <div className="space-y-4">
            {/* Model Selection */}
            <div className="bg-black/20 rounded-lg p-4">
              <label className="block text-xs font-medium text-white/70 mb-2">Model Selection</label>
              <select 
                value={nodeSettings.model}
                onChange={(e) => handleSettingChange('model', e.target.value)}
                className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
              >
                <option value="topaz">Topaz</option>
              </select>
              <p className="mt-2 text-xs text-white/50">Choose the video upscaling model</p>
            </div>

            {/* Upscale Factor */}
            <div className="bg-black/20 rounded-lg p-4">
              <label className="block text-xs font-medium text-white/70 mb-2">Upscale Factor</label>
              <div className="grid grid-cols-3 gap-2">
                {[2, 4, 6].map((factor) => (
                  <button
                    key={factor}
                    onClick={(e) => handleSettingChange('upscaleFactor', factor)}
                    className={`p-2 text-xs rounded-lg border transition-colors ${
                      nodeSettings.upscaleFactor === factor
                        ? 'bg-white/20 border-white/30 text-white'
                        : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
                    }`}
                  >
                    {factor}x
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-white/50">Select the upscaling factor</p>
            </div>
          </div>
        );
      
      default:
        return null;
    }
  };

  return (
    <div
      ref={nodeRef}
      className={`absolute top-0 left-0 w-[300px] max-w-[300px] rounded-lg shadow-lg overflow-hidden transform transition-transform duration-150 ${currentTypeStyle.bgColor} ${currentTypeStyle.borderColor} ${currentTypeStyle.textColor} ${isSelected ? 'z-10' : 'z-1'}`}
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        boxShadow: isSelected ? `0 0 0 2px ${currentTypeStyle.glowColor}` : 'none'
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      {/* Node Header */}
      <div className="node-header flex items-center justify-between p-4 overflow-hidden">
        <div className="flex items-center space-x-2 min-w-0 flex-1">
          <div className="flex-shrink-0 w-6 h-6">{icon}</div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{title}</div>
            <div className="text-xs text-white/50 truncate">{description}</div>
          </div>
        </div>
        <div className="flex items-center space-x-2 flex-shrink-0 ml-2">
          <button
            className="p-1 rounded-md hover:bg-white/10 transition-colors"
            onClick={handleToggleExpand}
          >
            {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button className="p-1 rounded-md hover:bg-white/10 transition-colors">
            <Settings size={16} />
          </button>
        </div>
      </div>

      {/* Node Content */}
      <div className={`p-4 transition-all duration-150 ${isExpanded ? 'max-h-[1000px]' : 'max-h-0 overflow-hidden'}`}>
        {renderSettings()}
      </div>

      {/* Node Footer */}
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center space-x-2">
          {inputs?.map((input) => (
            <div
              key={input.id}
              className="flex items-center space-x-1 node-connector"
              onMouseDown={(e) => handleStartConnection(input.id, e)}
              onTouchStart={(e) => handleStartConnection(input.id, e)}
            >
              <div className={`w-2 h-2 rounded-full ${currentTypeStyle.inputColor}`} />
              <div className="text-xs">{input.label}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center space-x-2">
          {outputs?.map((output) => (
            <div
              key={output.id}
              className="flex items-center space-x-1 node-connector"
              onMouseDown={(e) => handleCompleteConnection(output.id, e)}
              onTouchStart={(e) => handleCompleteConnection(output.id, e)}
            >
              <div className="text-xs">{output.label}</div>
              <div className={`w-2 h-2 rounded-full ${currentTypeStyle.outputColor}`} />
            </div>
          ))}
        </div>
      </div>

      {/* Execution Progress */}
      {isExecuting && (
        <div className="absolute bottom-0 left-0 w-full h-1 bg-transparent">
          <div
            className={`h-full ${currentTypeStyle.progressColor}`}
            style={{ width: `${executionProgress}%` }}
          />
        </div>
      )}
    </div>
  );
};

export default BlockNode;