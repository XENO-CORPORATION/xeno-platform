import React, { useState, useEffect, useRef, createContext, useContext } from 'react';
import { Maximize2, Minimize2, Play, Trash2, ChevronUp, ChevronDown, X } from 'lucide-react';

export interface ConnectionPoint {
  id: string;
  type: string;
  label: string;
}

export interface BaseNodeProps {
  id: number;
  title: string;
  icon: React.ReactNode;
  description: string;
  type: string;
  initialPosition: { x: number; y: number };
  onPositionChange?: (id: number, position: { x: number; y: number }) => void;
  onNodeSelect?: (id: number) => void;
  onDragStateChange?: (isDragging: boolean) => void;
  isSelected?: boolean;
  isConnecting?: boolean;
  isConnectionSource?: boolean;
  isExecuting?: boolean;
  executionProgress?: number;
  inputs?: ConnectionPoint[];
  outputs?: ConnectionPoint[];
  onStartConnection?: (outputId: string, e: React.MouseEvent) => void;
  onCompleteConnection?: (inputId: string, e: React.MouseEvent) => void;
  onDelete?: () => void;
  onRun?: () => void;
  children?: React.ReactNode;
  defaultContent?: React.ReactNode;
  nodeState?: Record<string, any>;
}

// Create a context for node content to access layout information
interface NodeContentContextType {
  isExpanded: boolean;
  containerWidth: number;
  isWideLayout: boolean;
  showAdvancedSettings: boolean;
  toggleAdvancedSettings: () => void;
}

export const NodeContentContext = createContext<NodeContentContextType>({
  isExpanded: false,
  containerWidth: 230,
  isWideLayout: false,
  showAdvancedSettings: false,
  toggleAdvancedSettings: () => {}
});

// Custom hook to access node content context
export const useNodeContent = () => useContext(NodeContentContext);

// Wrapper component for node content items that can control their grid placement
export interface NodeContentItemProps {
  children: React.ReactNode;
  className?: string;
  colSpan?: 1 | 2 | 'auto'; // How many columns this item should span
  priority?: 'high' | 'medium' | 'low'; // Placement priority
  advanced?: boolean; // Whether this is an advanced setting
  basic?: boolean; // Whether this is a basic setting (takes precedence over advanced)
}

export const NodeContentItem: React.FC<NodeContentItemProps> = ({ 
  children, 
  className = '',
  colSpan = 1, 
  priority = 'medium',
  advanced = false,
  basic = false
}) => {
  const { isExpanded, showAdvancedSettings } = useNodeContent();
  
  // Basic takes precedence over advanced
  const isAdvancedSetting = advanced && !basic;
  
  // Hide advanced settings when not showing advanced
  if (isAdvancedSetting && !showAdvancedSettings) {
    return null;
  }
  
  // Determine column span based on expansion state and priority
  let gridColSpan = colSpan;
  if (!isExpanded || colSpan === 'auto') {
    gridColSpan = isExpanded ? 2 : 1;
  }
  
  // Calculate layout classes based on properties
  const colSpanClass = gridColSpan === 2 ? 'col-span-2' : 'col-span-1';
  const orderClass = priority === 'high' ? 'order-first' : 
                    priority === 'low' ? 'order-last' : '';
  const itemTypeClass = isAdvancedSetting ? 'advanced-item' : (basic ? 'basic-item' : '');
  
  return (
    <div className={`${colSpanClass} ${orderClass} ${itemTypeClass} ${className}`}>
      {children}
    </div>
  );
};

// Convenience component for basic settings
export const BasicNodeContentItem: React.FC<Omit<NodeContentItemProps, 'basic'>> = (props) => {
  return <NodeContentItem {...props} basic={true} />;
};

// Convenience component for advanced settings 
export const AdvancedNodeContentItem: React.FC<Omit<NodeContentItemProps, 'advanced'>> = (props) => {
  return <NodeContentItem {...props} advanced={true} />;
};

// Hook to monitor element size and determine if it should span multiple columns
export const useContentSize = (minWidthForFullSpan = 300): [React.RefObject<HTMLDivElement>, boolean] => {
  const ref = useRef<HTMLDivElement>(null);
  const [shouldSpanFull, setShouldSpanFull] = useState(false);
  const { isExpanded } = useNodeContent();
  
  useEffect(() => {
    if (!ref.current || !isExpanded) return;
    
    const checkSize = () => {
      if (!ref.current) return;
      const width = ref.current.scrollWidth;
      setShouldSpanFull(width > minWidthForFullSpan);
    };
    
    // Check initial size
    checkSize();
    
    // Set up resize observer to detect content size changes
    const resizeObserver = new ResizeObserver(checkSize);
    resizeObserver.observe(ref.current);
    
    return () => {
      if (ref.current) {
        resizeObserver.unobserve(ref.current);
      }
      resizeObserver.disconnect();
    };
  }, [minWidthForFullSpan, isExpanded]);
  
  return [ref as React.RefObject<HTMLDivElement>, shouldSpanFull];
};

// Auto-sizing content item that determines its own column span
export const AutoSizeNodeContent: React.FC<Omit<NodeContentItemProps, 'colSpan'>> = ({ 
  children, 
  className = '',
  priority = 'medium',
  advanced = false,
  basic = false
}) => {
  const [contentRef, shouldSpanFull] = useContentSize();
  
  return (
    <NodeContentItem 
      colSpan={shouldSpanFull ? 2 : 1}
      priority={priority}
      className={className}
      advanced={advanced}
      basic={basic}
    >
      <div ref={contentRef}>
        {children}
      </div>
    </NodeContentItem>
  );
};

// Auto-sizing basic content item
export const BasicAutoSizeNodeContent: React.FC<Omit<NodeContentItemProps, 'colSpan' | 'basic'>> = (props) => {
  return <AutoSizeNodeContent {...props} basic={true} />;
};

// Auto-sizing advanced content item
export const AdvancedAutoSizeNodeContent: React.FC<Omit<NodeContentItemProps, 'colSpan' | 'advanced'>> = (props) => {
  return <AutoSizeNodeContent {...props} advanced={true} />;
};

export const getTypeStyles = (type: string) => {
  const typeStyles: Record<string, any> = {
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
    },
    save: {
      bgColor: 'bg-[#1E1E1E]',
      textColor: 'text-white',
      borderColor: 'border-teal-500/40',
      glowColor: 'rgba(20, 184, 166, 0.3)',
      inputColor: 'bg-[#333333]',
      outputColor: 'bg-[#444444]',
      progressColor: 'bg-teal-500'
    },
    preview: {
      bgColor: 'bg-[#1E1E1E]',
      textColor: 'text-white',
      borderColor: 'border-orange-500/40',
      glowColor: 'rgba(249, 115, 22, 0.3)',
      inputColor: 'bg-[#333333]',
      outputColor: 'bg-[#444444]',
      progressColor: 'bg-orange-500'
    },
    bridge: {
      bgColor: 'bg-[#1E1E1E]',
      textColor: 'text-white',
      borderColor: 'border-indigo-500/40',
      glowColor: 'rgba(99, 102, 241, 0.3)',
      inputColor: 'bg-[#333333]',
      outputColor: 'bg-[#444444]',
      progressColor: 'bg-indigo-500'
    }
  };

  return typeStyles[type] || {
    bgColor: 'bg-[#1E1E1E]',
    textColor: 'text-white',
    borderColor: 'border-white/40',
    glowColor: 'rgba(255, 255, 255, 0.15)',
    inputColor: 'bg-[#333333]',
    outputColor: 'bg-[#444444]',
    progressColor: 'bg-white'
  };
};

const BaseNode: React.FC<BaseNodeProps> = ({
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
  inputs = [],
  outputs = [],
  onStartConnection,
  onCompleteConnection,
  onDelete,
  onRun,
  children,
  defaultContent,
  nodeState
}) => {
  const nodeRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(initialPosition);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, nodeX: 0, nodeY: 0 });
  const lastPositionRef = useRef({ x: initialPosition.x, y: initialPosition.y });
  const [isExpanded, setIsExpanded] = useState(false);
  const lastUpdateTimeRef = useRef(0);
  const requestRef = useRef<number | null>(null);
  const throttleTimeRef = useRef(16); // Added for throttling
  const expandedContentRef = useRef<HTMLDivElement>(null);
  const [expandedContentWidth, setExpandedContentWidth] = useState(0);
  const [isWideEnough, setIsWideEnough] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);

  // Update position when initialPosition changes
  useEffect(() => {
    if (initialPosition !== position && !isDraggingRef.current) {
      setPosition(initialPosition);
      lastPositionRef.current = initialPosition;
    }
  }, [initialPosition]);
  
  // Monitor the expanded content width for responsive layout
  useEffect(() => {
    if (!expandedContentRef.current || !isExpanded) return;
    
    const updateWidth = () => {
      if (!expandedContentRef.current) return;
      
      const width = expandedContentRef.current.clientWidth;
      setExpandedContentWidth(width);
      setIsWideEnough(width >= 450); // Use 450px as breakpoint for two columns
    };
    
    // Initial measurement
    updateWidth();
    
    // Set up resize observer
    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(expandedContentRef.current);
    
    return () => {
      if (expandedContentRef.current) {
        resizeObserver.unobserve(expandedContentRef.current);
      }
      resizeObserver.disconnect();
    };
  }, [isExpanded]);

  // Get canvas container and current zoom level
  const getCanvasInfo = () => {
    // Try different possible selectors for the canvas container
    const canvasContainer = 
      nodeRef.current?.closest('.node-canvas-container') || 
      nodeRef.current?.closest('.canvas-container');
    
    if (!canvasContainer) {
      // Last resort: try to find any parent with a rect
      const parentElement = nodeRef.current?.parentElement;
      
      if (parentElement) {
        const scale = 1; // Default scale if no container found
        const canvasRect = parentElement.getBoundingClientRect();
        return { scale, canvasRect, canvasElement: parentElement };
      }
      
      return { scale: 1, canvasRect: null };
    }
    
    // Get canvas scale from the data attribute
    const scale = parseFloat(canvasContainer.getAttribute('data-scale') || '1');
    
    // Get canvas rect for coordinate conversion
    const canvasRect = canvasContainer.getBoundingClientRect();
    
    return { scale, canvasRect, canvasElement: canvasContainer };
  };

  // Add a simpler direct drag method for debugging
  const handleDirectDrag = (e: MouseEvent) => {
    if (!isDraggingRef.current || !nodeRef.current) return;
    
    // Get current canvas info
    const { scale } = getCanvasInfo();
    
    // If we don't have scale, use a simple 1:1 mapping
    const effectiveScale = scale || 1;
    
    // Calculate delta in screen coordinates with fallback
    const dx = (e.clientX - dragStartRef.current.x) / effectiveScale;
    const dy = (e.clientY - dragStartRef.current.y) / effectiveScale;
    
    // Apply delta to initial node position
    const newX = dragStartRef.current.nodeX + dx;
    const newY = dragStartRef.current.nodeY + dy;
    
    // Direct DOM update without animation frame
    nodeRef.current.style.transform = `translate3d(${newX}px, ${newY}px, 0)`;
    nodeRef.current.classList.add('dragging-node');
    nodeRef.current.classList.add('debugging-active');
    
    // Find connected nodes and highlight them
    const connectionsContainer = document.querySelector('svg.absolute');
    if (connectionsContainer) {
      // Find all connections related to this node
      const connections = connectionsContainer.querySelectorAll(`path[id^="conn-"]`);
      connections.forEach(conn => {
        const connId = conn.id;
        // Check if this connection involves the current node
        if (connId.includes(`-${id}-`) || connId.includes(`-to-${id}-`)) {
          conn.classList.add('active-connection');
        }
      });
    }
    
    // Store position
    const newPosition = { x: newX, y: newY };
    lastPositionRef.current = newPosition;
    
    // Notify parent on every move (will be used to update connections in real-time)
    if (onPositionChange) {
      // Update the parent component about position change during drag
      onPositionChange(id, newPosition);
    }
    
    // If we're throttling, use that instead of constantly calling setPosition
    if (Date.now() - lastUpdateTimeRef.current > throttleTimeRef.current) {
      lastUpdateTimeRef.current = Date.now();
      setPosition(newPosition);
    }
  };

  // Handle mouse down - initiate dragging if not on connector
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
    
    if (!nodeRef.current) {
      return;
    }

    // Get current canvas info - we only need canvasRect here
    // But we'll proceed even if canvasRect is null
    const { canvasRect } = getCanvasInfo();
    if (!canvasRect) {
      // Continue anyway
    }

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
    document.addEventListener('mousemove', handleDirectDrag); // Try direct drag method
    document.addEventListener('mouseup', handleMouseUp);
    
    // Apply grabbing cursor and set will-change property
    if (nodeRef.current) {
      nodeRef.current.style.cursor = 'grabbing';
      nodeRef.current.style.zIndex = '30';
      nodeRef.current.style.willChange = 'transform';
      nodeRef.current.classList.add('debugging-active'); // Add debug class to see it's set up for dragging
    }
  };

  // Handle mouse up - cleanup after dragging
  const handleMouseUp = () => {
    if (!isDraggingRef.current) {
      return;
    }
    
    // Reset dragging state
    isDraggingRef.current = false;
    if (onDragStateChange) onDragStateChange(false);
    
    // Remove event listeners
    document.removeEventListener('mousemove', handleDirectDrag); // Remove both handlers
    document.removeEventListener('mouseup', handleMouseUp);
    
    // Cancel any pending animation frames
    if (requestRef.current) {
      cancelAnimationFrame(requestRef.current);
      requestRef.current = null;
    }
    
    // Reset cursor and will-change property
    if (nodeRef.current) {
      nodeRef.current.style.cursor = 'grab';
      nodeRef.current.style.zIndex = isSelected ? '5' : '1';
      nodeRef.current.style.willChange = 'auto';
      nodeRef.current.classList.remove('dragging-node');
      nodeRef.current.classList.remove('debugging-active');
    }
    
    // Remove active connection classes
    const connections = document.querySelectorAll('.active-connection');
    connections.forEach(conn => conn.classList.remove('active-connection'));
    
    // Update React state with final position
    const newPosition = lastPositionRef.current;
    setPosition(newPosition);
    
    // Notify parent
    if (onPositionChange) {
      onPositionChange(id, newPosition);
    }
  };

  // Handle touch start - initiate dragging if not on connector
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
    
    // Always select the node when touching
    if (onNodeSelect) onNodeSelect(id);
    
    if (!nodeRef.current || e.touches.length !== 1) return;

    const touch = e.touches[0];

    // Get current canvas info - we only need canvasRect here
    // But we'll proceed even if canvasRect is null
    const { canvasRect } = getCanvasInfo();
    if (!canvasRect) {
      // Continue anyway
    }

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
    
    // Add touch event listeners
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleTouchEnd);
    document.addEventListener('touchcancel', handleTouchEnd);
    
    // Apply dragging styles
    if (nodeRef.current) {
      nodeRef.current.classList.add('dragging-node');
      nodeRef.current.classList.add('debugging-active');
      nodeRef.current.style.zIndex = '30';
      nodeRef.current.style.willChange = 'transform';
    }
  };

  // Handle touch movement - with zoom and pan support
  const handleTouchMove = (e: TouchEvent) => {
    if (!isDraggingRef.current || !nodeRef.current || e.touches.length !== 1) return;
    e.preventDefault(); // Prevent scrolling

    const touch = e.touches[0];

    // Get current canvas info
    const { scale } = getCanvasInfo();
    
    // If we don't have scale, use a simple 1:1 mapping
    const effectiveScale = scale || 1;

    // Calculate delta in screen coordinates
    const dx = (touch.clientX - dragStartRef.current.x) / effectiveScale;
    const dy = (touch.clientY - dragStartRef.current.y) / effectiveScale;

    // Apply delta to initial node position
    const newX = dragStartRef.current.nodeX + dx;
    const newY = dragStartRef.current.nodeY + dy;

    // Update DOM directly for better performance
    nodeRef.current.style.transform = `translate3d(${newX}px, ${newY}px, 0)`;
    nodeRef.current.classList.add('dragging-node');
    nodeRef.current.classList.add('debugging-active');
    
    // Find connected nodes and highlight them
    const connectionsContainer = document.querySelector('svg.absolute');
    if (connectionsContainer) {
      // Find all connections related to this node
      const connections = connectionsContainer.querySelectorAll(`path[id^="conn-"]`);
      connections.forEach(conn => {
        const connId = conn.id;
        // Check if this connection involves the current node
        if (connId.includes(`-${id}-`) || connId.includes(`-to-${id}-`)) {
          conn.classList.add('active-connection');
        }
      });
    }
    
    // Store position
    const newPosition = { x: newX, y: newY };
    lastPositionRef.current = newPosition;
    
    // Notify parent on every move for real-time connection updates
    if (onPositionChange) {
      onPositionChange(id, newPosition);
    }
    
    // If we're throttling, use that instead of constantly calling setPosition
    if (Date.now() - lastUpdateTimeRef.current > throttleTimeRef.current) {
      lastUpdateTimeRef.current = Date.now();
      setPosition(newPosition);
    }
  };

  // End touch dragging
  const handleTouchEnd = () => {
    if (!isDraggingRef.current || !nodeRef.current) return;
    
    // Reset dragging state
    isDraggingRef.current = false;
    if (onDragStateChange) onDragStateChange(false);
    
    // Remove event listeners
    document.removeEventListener('touchmove', handleTouchMove, { passive: false } as EventListenerOptions);
    document.removeEventListener('touchend', handleTouchEnd);
    document.removeEventListener('touchcancel', handleTouchEnd);
    
    // Reset will-change property
    nodeRef.current.style.willChange = 'auto';
    nodeRef.current.style.zIndex = isSelected ? '5' : '1';
    nodeRef.current.classList.remove('dragging-node');
    nodeRef.current.classList.remove('debugging-active');
    
    // Remove active connection classes
    const connections = document.querySelectorAll('.active-connection');
    connections.forEach(conn => conn.classList.remove('active-connection'));
    
    // Update React state with final position
    const newPosition = lastPositionRef.current;
    setPosition(newPosition);
    
    // Notify parent
    if (onPositionChange) {
      onPositionChange(id, newPosition);
    }
  };

  // Handle starting a connection from an output
  const handleStartConnection = (outputId: string, e: React.MouseEvent) => {
    if (onStartConnection) {
      onStartConnection(outputId, e);
    }
  };

  // Handle completing a connection to an input
  const handleCompleteConnection = (inputId: string, e: React.MouseEvent) => {
    if (onCompleteConnection) {
      onCompleteConnection(inputId, e);
    }
  };

  // Toggle node expansion
  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  // Handle node deletion
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDelete) {
      onDelete();
    }
  };

  // Handle node execution
  const handleRun = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onRun) {
      onRun();
    }
  };

  // Toggle function for advanced settings
  const toggleAdvancedSettings = () => {
    setShowAdvancedSettings(prev => !prev);
  };

  // Compute styles - updated for colored borders based on node type
  const nodeClasses = `
    absolute backdrop-blur-[10px] rounded-2xl border
    cursor-grab transition-shadow duration-300
    ${getTypeStyles(type).borderColor}
    ${isSelected ? 'ring-2 ring-white/20 ring-opacity-30' : ''}
    ${isConnectionSource ? 'ring-2 ring-white/20 ring-opacity-30' : ''}
    ${isExecuting ? 'animate-pulse-slow' : ''}
    hover:border-[rgba(255,255,255,0.2)]
    will-change-transform transform-gpu
  `;
  
  const nodeStyles = {
    transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
    boxShadow: isSelected 
      ? `0 0 10px ${getTypeStyles(type).glowColor}` 
      : `0 4px 30px rgba(0, 0, 0, 0.1)`,
    width: isExpanded ? '640px' : '380px',
    zIndex: isExpanded ? '40' : isDraggingRef.current ? '30' : 'auto',
  };
  
  // Add CSS for highlighting advanced settings
  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = `
      .advanced-item {
        position: relative;
      }
      .advanced-item::before {
        content: '';
        position: absolute;
        left: -6px;
        top: 0;
        bottom: 0;
        width: 2px;
        background-color: rgba(255, 255, 255, 0.15);
        border-radius: 1px;
      }
      .basic-item {
        position: relative;
      }
      .basic-item::before {
        content: '';
        position: absolute;
        left: -6px;
        top: 0;
        bottom: 0;
        width: 2px;
        background-color: rgba(255, 255, 255, 0.05);
        border-radius: 1px;
      }
      /* Style for advanced settings section */
      .advanced-settings {
        position: relative;
      }
      .advanced-settings::before {
        content: '';
        position: absolute;
        left: -10px;
        top: 0;
        bottom: 0;
        width: 2px;
        background-color: rgba(255, 255, 255, 0.1);
        border-radius: 1px;
      }
    `;
    document.head.appendChild(style);
    
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  return (
    <div 
      ref={nodeRef}
      id={`node-${id}`}
      className={nodeClasses}
      style={nodeStyles}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      role="button"
      aria-pressed={isSelected}
      tabIndex={0}
    >
      {/* Node Header */}
      <div className="node-header flex items-center justify-between p-4 overflow-hidden">
        <div className="flex items-center space-x-2 min-w-0 flex-1">
          <div className={`flex-shrink-0 p-1.5 rounded ${getTypeStyles(type).bgColor} ${getTypeStyles(type).textColor}`}>
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-medium text-white text-sm truncate">{title}</h3>
            <div className="text-xs text-white/50 truncate">{description}</div>
          </div>
        </div>
        
        {/* Node controls */}
        <div className="flex-shrink-0 flex items-center space-x-1 ml-2">
          {onRun && (
            <button
              onClick={handleRun}
              className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors node-control"
              title="Run node"
            >
              <Play size={14} />
            </button>
          )}

          {onDelete && (
            <button
              onClick={handleDelete}
              className="p-1.5 rounded-lg text-white/70 hover:text-red-400 hover:bg-white/10 transition-colors node-control"
              title="Delete node"
            >
              <Trash2 size={14} />
            </button>
          )}

          {/* Expand/collapse button */}
          <button
            className="p-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors node-control"
            onClick={handleToggleExpand}
            title={isExpanded ? "Collapse node" : "Expand node"}
          >
            {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          
          {/* AI Intelligence indicator */}
          {isExecuting && (
            <div className="ml-1">
              <div className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center animate-pulse">
                <div className="w-2 h-2 rounded-full bg-white"></div>
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Node Content */}
      <div className="p-4">
        <p className="text-xs text-text-secondary leading-relaxed">
          {description}
        </p>
        
        {/* Execution progress bar */}
        {isExecuting && (
          <div className="mt-2 w-full h-1 bg-white/10 rounded-full overflow-hidden">
            <div 
              className={`h-full ${getTypeStyles(type).progressColor} rounded-full transition-all duration-300`} 
              style={{ width: `${executionProgress}%` }}
            ></div>
          </div>
        )}

        {/* DIRECT IMPLEMENTATION: If we're not expanded, show minimal UI */}
        {!isExpanded && (
          <div className="mt-4 border border-white/10 rounded-lg p-5 bg-black/20 dropdown-container relative">
            {type === 'llm' && (
              <div className="space-y-4">
                <div className="node-select-wrapper">
                  <label className="block text-xs font-medium text-white/70 mb-2.5">Model</label>
                  <select 
                    id={`node-${id}-default-model-select`}
                    className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
                    value={nodeState?.model || 'gpt-4o'}
                    onChange={(e) => {
                      // Dispatch a custom event that can be caught by the specific node component
                      const event = new CustomEvent('llm-model-change', { 
                        detail: { value: e.target.value, nodeId: id } 
                      });
                      window.dispatchEvent(event);
                    }}
                  >
                    <option value="gpt-4o">GPT-4o</option>
                    <option value="claude-3-sonnet">Claude 3 Sonnet</option>
                    <option value="gemini">Gemini</option>
                    <option value="grok-3">Grok 3</option>
                    <option value="ollama">Ollama</option>
                  </select>
                  <p className="mt-2 text-xs text-white/50">Select the language model to use for text generation</p>
                </div>
                
                {/* Add input prompt textarea */}
                <div>
                  <label className="block text-xs font-medium text-white/70 mb-2.5">Prompt Input</label>
                  <textarea
                    id={`node-${id}-default-prompt-input`}
                    className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-3 text-sm min-h-[80px] focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20 resize-none"
                    placeholder="Enter text prompt here..."
                    value={nodeState?.prompt || ''}
                    onChange={(e) => {
                      // Dispatch a custom event that can be caught by the specific node component
                      const event = new CustomEvent('llm-prompt-change', { 
                        detail: { value: e.target.value, nodeId: id } 
                      });
                      window.dispatchEvent(event);
                    }}
                  ></textarea>
                  <p className="mt-2 text-xs text-white/50">Input text that will be used by the LLM or passed to generators</p>
                </div>
                
                <div className="pt-3 border-t border-white/10">
                  <button 
                    className="w-full py-2.5 px-4 text-sm text-white/80 bg-white/5 border border-white/10 rounded-md hover:bg-white/10 transition-colors flex items-center justify-center"
                    onClick={handleToggleExpand}
                  >
                    <span>Configure Settings</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-2">
                      <polyline points="7 13 12 18 17 13"></polyline>
                      <polyline points="7 6 12 11 17 6"></polyline>
                    </svg>
                  </button>
                </div>
              </div>
            )}
            
            {type === 'image' && (
              <div className="space-y-4">
                <div className="node-select-wrapper">
                  <label className="block text-xs font-medium text-white/70 mb-2.5">Image Model</label>
                  <select 
                    id={`node-${id}-default-model-select`}
                    className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
                    value={nodeState?.model || 'dalle-3'}
                    onChange={(e) => {
                      // Dispatch a custom event that can be caught by the specific node component
                      const event = new CustomEvent('image-model-change', { 
                        detail: { value: e.target.value, nodeId: id } 
                      });
                      window.dispatchEvent(event);
                    }}
                  >
                    <option value="dalle-3">DALL·E 3</option>
                    <option value="sdxl">Stable Diffusion XL</option>
                    <option value="midjourney">Midjourney</option>
                  </select>
                  <p className="mt-2 text-xs text-white/50">Select the image generation model to use</p>
                </div>
                
                {/* Add aspect ratio options */}
                <div>
                  <label className="block text-xs font-medium text-white/70 mb-2.5">Aspect Ratio</label>
                  <div className="grid grid-cols-3 gap-2">
                    {['1:1', '16:9', '4:3', '3:2', '9:16', 'Custom'].map((ratio) => (
                      <button
                        key={ratio}
                        className={`py-2 px-1 text-sm rounded-md border focus:outline-none transition-colors
                          ${(nodeState?.aspectRatio || '1:1') === ratio 
                            ? 'bg-white/10 border-white/30 text-white' 
                            : 'bg-black/30 border-white/10 text-white/70 hover:bg-white/5'}`}
                        onClick={() => {
                          // Dispatch a custom event for aspect ratio change
                          const event = new CustomEvent('image-ratio-change', { 
                            detail: { value: ratio, nodeId: id } 
                          });
                          window.dispatchEvent(event);
                        }}
                      >
                        {ratio}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-white/50">Choose the aspect ratio for the generated image</p>
                </div>
                
                <div className="pt-3 border-t border-white/10">
                  <button 
                    className="w-full py-2.5 px-4 text-sm text-white/80 bg-white/5 border border-white/10 rounded-md hover:bg-white/10 transition-colors flex items-center justify-center"
                    onClick={handleToggleExpand}
                  >
                    <span>Configure Settings</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-2">
                      <polyline points="7 13 12 18 17 13"></polyline>
                      <polyline points="7 6 12 11 17 6"></polyline>
                    </svg>
                  </button>
                </div>
              </div>
            )}
            
            {type === 'video' && (
              <div className="space-y-4">
                <div className="node-select-wrapper">
                  <label className="block text-xs font-medium text-white/70 mb-2.5">Video Model</label>
                  <select 
                    id={`node-${id}-default-model-select`}
                    className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
                    value={nodeState?.model || 'sora-1.0'}
                    onChange={(e) => {
                      // Dispatch a custom event for model change
                      const event = new CustomEvent('video-model-change', { 
                        detail: { value: e.target.value, nodeId: id } 
                      });
                      window.dispatchEvent(event);
                    }}
                  >
                    <option value="sora-1.0">Sora</option>
                    <option value="gen-2">Gen-2</option>
                    <option value="lumadreamachine">Luma Dream Machine</option>
                    <option value="pika-1.0">Pika</option>
                  </select>
                  <p className="mt-2 text-xs text-white/50">Select the video generation model to use</p>
                </div>
                
                {/* Duration and resolution settings */}
                <div>
                  <div className="flex justify-between items-center mb-2.5">
                    <label className="block text-xs font-medium text-white/70">Duration (seconds)</label>
                    <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                      {nodeState?.duration || '4'}s
                    </span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="60"
                    step="1"
                    value={nodeState?.duration || 4}
                    onChange={(e) => {
                      // Dispatch a custom event for duration change
                      const event = new CustomEvent('video-duration-change', { 
                        detail: { value: parseInt(e.target.value), nodeId: id } 
                      });
                      window.dispatchEvent(event);
                    }}
                    className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
                  />
                  <p className="mt-2 text-xs text-white/50">Set the length of the generated video clip</p>
                </div>
                
                <div className="pt-3 border-t border-white/10">
                  <button 
                    className="w-full py-2.5 px-4 text-sm text-white/80 bg-white/5 border border-white/10 rounded-md hover:bg-white/10 transition-colors flex items-center justify-center"
                    onClick={handleToggleExpand}
                  >
                    <span>Configure Settings</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-2">
                      <polyline points="7 13 12 18 17 13"></polyline>
                      <polyline points="7 6 12 11 17 6"></polyline>
                    </svg>
                  </button>
                </div>
              </div>
            )}
            
            {type === 'upscale-image' && (
              <div className="space-y-4">
                <div className="node-select-wrapper">
                  <label className="block text-xs font-medium text-white/70 mb-2.5">Upscale Model</label>
                  <select 
                    id={`node-${id}-default-model-select`}
                    className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
                    value={nodeState?.model || 'magnificai'}
                    onChange={(e) => {
                      // Dispatch a custom event for model change
                      const event = new CustomEvent('upscale-model-change', { 
                        detail: { value: e.target.value, nodeId: id } 
                      });
                      window.dispatchEvent(event);
                    }}
                  >
                    <option value="magnificai">MagnificAI</option>
                    <option value="esrgan">ESRGAN</option>
                    <option value="real-esrgan">Real-ESRGAN</option>
                  </select>
                  <p className="mt-2 text-xs text-white/50">Select the image upscaling model to use</p>
                </div>
                
                {/* Scale factor options */}
                <div>
                  <label className="block text-xs font-medium text-white/70 mb-2.5">Scale Factor</label>
                  <div className="grid grid-cols-4 gap-2">
                    {['2x', '4x', '8x', '16x'].map((scale) => (
                      <button
                        key={scale}
                        className={`py-2 px-1 text-sm rounded-md border focus:outline-none transition-colors
                          ${(nodeState?.scaleFactor || '4x') === scale 
                            ? 'bg-white/10 border-white/30 text-white' 
                            : 'bg-black/30 border-white/10 text-white/70 hover:bg-white/5'}`}
                        onClick={() => {
                          // Dispatch a custom event for scale factor change
                          const event = new CustomEvent('upscale-factor-change', { 
                            detail: { value: scale, nodeId: id } 
                          });
                          window.dispatchEvent(event);
                        }}
                      >
                        {scale}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-white/50">Amount to enlarge the image</p>
                </div>
                
                <div className="pt-3 border-t border-white/10">
                  <button 
                    className="w-full py-2.5 px-4 text-sm text-white/80 bg-white/5 border border-white/10 rounded-md hover:bg-white/10 transition-colors flex items-center justify-center"
                    onClick={handleToggleExpand}
                  >
                    <span>Configure Settings</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-2">
                      <polyline points="7 13 12 18 17 13"></polyline>
                      <polyline points="7 6 12 11 17 6"></polyline>
                    </svg>
                  </button>
                </div>
              </div>
            )}
            
            {type === 'upscale-video' && (
              <div className="space-y-4">
                <div className="node-select-wrapper">
                  <label className="block text-xs font-medium text-white/70 mb-2.5">Video Upscaler</label>
                  <select 
                    id={`node-${id}-default-model-select`}
                    className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
                    value={nodeState?.model || 'dainc'}
                    onChange={(e) => {
                      // Dispatch a custom event for model change
                      const event = new CustomEvent('video-upscale-model-change', { 
                        detail: { value: e.target.value, nodeId: id } 
                      });
                      window.dispatchEvent(event);
                    }}
                  >
                    <option value="dainc">DAIN-App</option>
                    <option value="enhancerai">Enhancer AI</option>
                    <option value="topaz">Topaz Video AI</option>
                  </select>
                  <p className="mt-2 text-xs text-white/50">Select the video upscaling model to use</p>
                </div>
                
                {/* Resolution boost option */}
                <div>
                  <div className="flex justify-between items-center mb-2.5">
                    <label className="block text-xs font-medium text-white/70">Resolution Boost</label>
                    <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                      {nodeState?.resolutionFactor || '2'}x
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {['1.5x', '2x', '4x'].map((factor) => (
                      <button
                        key={factor}
                        className={`py-2 px-1 text-sm rounded-md border focus:outline-none transition-colors
                          ${(nodeState?.resolutionFactor || '2x') === factor 
                            ? 'bg-white/10 border-white/30 text-white' 
                            : 'bg-black/30 border-white/10 text-white/70 hover:bg-white/5'}`}
                        onClick={() => {
                          // Dispatch a custom event for resolution change
                          const event = new CustomEvent('video-resolution-change', { 
                            detail: { value: factor, nodeId: id } 
                          });
                          window.dispatchEvent(event);
                        }}
                      >
                        {factor}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-white/50">Amount to increase the video resolution</p>
                </div>
                
                <div className="pt-3 border-t border-white/10">
                  <button 
                    className="w-full py-2.5 px-4 text-sm text-white/80 bg-white/5 border border-white/10 rounded-md hover:bg-white/10 transition-colors flex items-center justify-center"
                    onClick={handleToggleExpand}
                  >
                    <span>Configure Settings</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-2">
                      <polyline points="7 13 12 18 17 13"></polyline>
                      <polyline points="7 6 12 11 17 6"></polyline>
                    </svg>
                  </button>
                </div>
              </div>
            )}
            
            {type === 'utility' && (
              <div className="space-y-4">
                <div className="node-select-wrapper">
                  <label className="block text-xs font-medium text-white/70 mb-2.5">Utility Type</label>
                  <select 
                    id={`node-${id}-default-utility-select`}
                    className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
                    value={nodeState?.utilityType || 'format-converter'}
                    onChange={(e) => {
                      // Dispatch a custom event for utility type change
                      const event = new CustomEvent('utility-type-change', { 
                        detail: { value: e.target.value, nodeId: id } 
                      });
                      window.dispatchEvent(event);
                    }}
                  >
                    <option value="format-converter">Format Converter</option>
                    <option value="text-extractor">Text Extractor</option>
                    <option value="image-combiner">Image Combiner</option>
                    <option value="text-formatter">Text Formatter</option>
                  </select>
                  <p className="mt-2 text-xs text-white/50">Select the utility function to perform</p>
                </div>
                
                {/* Operation Mode */}
                <div>
                  <label className="block text-xs font-medium text-white/70 mb-2.5">Operation Mode</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['Basic', 'Advanced'].map((mode) => (
                      <button
                        key={mode}
                        className={`py-2 px-1 text-sm rounded-md border focus:outline-none transition-colors
                          ${(nodeState?.operationMode || 'Basic') === mode 
                            ? 'bg-white/10 border-white/30 text-white' 
                            : 'bg-black/30 border-white/10 text-white/70 hover:bg-white/5'}`}
                        onClick={() => {
                          // Dispatch a custom event for operation mode change
                          const event = new CustomEvent('utility-mode-change', { 
                            detail: { value: mode, nodeId: id } 
                          });
                          window.dispatchEvent(event);
                        }}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-white/50">Select the complexity level of the operation</p>
                </div>
                
                <div className="pt-3 border-t border-white/10">
                  <button 
                    className="w-full py-2.5 px-4 text-sm text-white/80 bg-white/5 border border-white/10 rounded-md hover:bg-white/10 transition-colors flex items-center justify-center"
                    onClick={handleToggleExpand}
                  >
                    <span>Configure Settings</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-2">
                      <polyline points="7 13 12 18 17 13"></polyline>
                      <polyline points="7 6 12 11 17 6"></polyline>
                    </svg>
                  </button>
                </div>
              </div>
            )}
            
            {type === 'save' && (
              <div className="space-y-4">
                {/* Action button with format dropdown */}
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <button 
                      className="flex-1 py-3 px-4 bg-teal-500/90 hover:bg-teal-500 text-white flex items-center justify-center gap-2 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      disabled={!nodeState?.inputConnected}
                      onClick={() => {
                        // Dispatch save action event
                        const event = new CustomEvent('save-action', { 
                          detail: { nodeId: id } 
                        });
                        window.dispatchEvent(event);
                      }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                        <polyline points="17 21 17 13 7 13 7 21"></polyline>
                        <polyline points="7 3 7 8 15 8"></polyline>
                      </svg>
                      <span className="font-medium">Save Output</span>
                    </button>
                    
                    <div className="flex-initial">
                      <select 
                        className="h-full bg-black/30 text-white border border-white/10 rounded-lg p-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
                        value={nodeState?.format || 'auto'}
                        onChange={(e) => {
                          const event = new CustomEvent('save-format-change', { 
                            detail: { value: e.target.value, nodeId: id } 
                          });
                          window.dispatchEvent(event);
                        }}
                      >
                        <option value="auto">Auto</option>
                        <option value="png">PNG</option>
                        <option value="jpg">JPG</option>
                        <option value="mp4">MP4</option>
                        <option value="txt">TXT</option>
                        <option value="json">JSON</option>
                      </select>
                    </div>
                  </div>
                  
                  {/* Auto-save toggle */}
                  <div className="flex items-center justify-between mt-3">
                    <div className="text-sm text-white/80">Auto-save when changed</div>
                    <div className="relative inline-block w-10 align-middle select-none">
                      <input 
                        type="checkbox"
                        id={`autosave-toggle-${id}`}
                        className="sr-only"
                        checked={nodeState?.autoSave || false}
                        onChange={(e) => {
                          // Dispatch event for auto-save toggle
                          const event = new CustomEvent('save-auto-toggle', { 
                            detail: { nodeId: id, value: e.target.checked } 
                          });
                          window.dispatchEvent(event);
                        }}
                      />
                      <label 
                        htmlFor={`autosave-toggle-${id}`}
                        className={`block overflow-hidden h-5 rounded-full cursor-pointer transition-colors ${(nodeState?.autoSave || false) ? 'bg-teal-500' : 'bg-white/20'}`}
                      >
                        <span 
                          className={`block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${(nodeState?.autoSave || false) ? 'translate-x-5' : 'translate-x-0'}`}
                        ></span>
                      </label>
                    </div>
                  </div>
                </div>
                
                {/* Save status */}
                <div className="mt-4 bg-black/30 rounded-lg p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="text-white/60">Save location:</div>
                    <button
                      className="text-teal-400 hover:text-teal-300 transition-colors focus:outline-none"
                      onClick={() => {
                        // Dispatch event to trigger file browser
                        const event = new CustomEvent('save-browse-path', { 
                          detail: { nodeId: id } 
                        });
                        window.dispatchEvent(event);
                      }}
                    >
                      Browse...
                    </button>
                  </div>
                  <div className="mt-1 text-white font-mono text-xs truncate">
                    {nodeState?.savePath || 'No path selected'}
                  </div>
                  
                  {/* Status and count */}
                  {nodeState?.saveCount && nodeState.saveCount > 0 && (
                    <div className="mt-2 pt-2 border-t border-white/10 flex items-center text-xs text-teal-400">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                      </svg>
                      <span>
                        {nodeState.saveCount} file{nodeState.saveCount > 1 ? 's' : ''} saved 
                        {nodeState.lastSaved && ` (Last: ${nodeState.lastSaved})`}
                      </span>
                    </div>
                  )}
                </div>
                
                <div className="pt-3 border-t border-white/10">
                  <button 
                    className="w-full py-2.5 px-4 text-sm text-white/80 bg-white/5 border border-white/10 rounded-md hover:bg-white/10 transition-colors flex items-center justify-center"
                    onClick={handleToggleExpand}
                  >
                    <span>Configure Settings</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-2">
                      <polyline points="7 13 12 18 17 13"></polyline>
                      <polyline points="7 6 12 11 17 6"></polyline>
                    </svg>
                  </button>
                </div>
              </div>
            )}
            
            {type === 'preview' && (
              <div className="space-y-4">
                {/* Preview container - solely focused on the 16:9 preview area */}
                <div>
                  <div className="relative w-full bg-black/40 border border-white/10 rounded-lg overflow-hidden" style={{ paddingBottom: '56.25%' /* 16:9 aspect ratio */ }}>
                    {/* Empty state */}
                    {!nodeState?.previewUrl && !nodeState?.previewContent && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-white/40">
                        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                          <circle cx="8.5" cy="8.5" r="1.5"></circle>
                          <polyline points="21 15 16 10 5 21"></polyline>
                        </svg>
                        <span className="mt-3 text-sm font-medium">Content Preview</span>
                        <span className="mt-1 text-xs opacity-70">Connect an input to preview content</span>
                      </div>
                    )}
                    
                    {/* Image preview */}
                    {nodeState?.previewUrl && nodeState?.contentType === 'image' && (
                      <img 
                        src={nodeState.previewUrl} 
                        className="absolute inset-0 w-full h-full object-contain"
                        alt="Preview" 
                      />
                    )}
                    
                    {/* Video preview */}
                    {nodeState?.previewUrl && nodeState?.contentType === 'video' && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="relative w-full h-full">
                          <video 
                            src={nodeState.previewUrl}
                            className="absolute inset-0 w-full h-full object-contain"
                            controls={false}
                            autoPlay={false}
                            loop
                            muted
                          />
                          {/* Play button overlay */}
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                            <button className="w-16 h-16 rounded-full bg-white/10 hover:bg-white/20 transition-colors flex items-center justify-center">
                              <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                                <polygon points="5 3 19 12 5 21 5 3"></polygon>
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* Text preview - simplified */}
                    {nodeState?.previewContent && nodeState?.contentType === 'text' && (
                      <div className="absolute inset-0 p-3 overflow-auto text-white text-sm bg-black/60">
                        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed max-h-full overflow-hidden">
                          {nodeState.previewContent.length > 300 
                            ? `${nodeState.previewContent.substring(0, 300)}...` 
                            : nodeState.previewContent}
                        </pre>
                      </div>
                    )}
                    
                    {/* Content type indicator */}
                    {(nodeState?.previewUrl || nodeState?.previewContent) && (
                      <div className="absolute top-2 right-2 bg-black/60 text-white/70 text-xs px-2 py-1 rounded-full flex items-center gap-1.5">
                        {nodeState?.contentType === 'image' && (
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                            <circle cx="8.5" cy="8.5" r="1.5"></circle>
                            <polyline points="21 15 16 10 5 21"></polyline>
                          </svg>
                        )}
                        {nodeState?.contentType === 'video' && (
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="23 7 16 12 23 17 23 7"></polygon>
                            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                          </svg>
                        )}
                        {nodeState?.contentType === 'text' && (
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                            <line x1="16" y1="13" x2="8" y2="13"></line>
                            <line x1="16" y1="17" x2="8" y2="17"></line>
                            <polyline points="10 9 9 9 8 9"></polyline>
                          </svg>
                        )}
                        <span className="capitalize">{nodeState?.contentType || 'Content'}</span>
                      </div>
                    )}
                    
                    {/* Quick actions overlay that appears on hover */}
                    <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 to-transparent opacity-0 hover:opacity-100 transition-opacity flex justify-center gap-2">
                      {/* Download button */}
                      <button className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white/90">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                          <polyline points="7 10 12 15 17 10"></polyline>
                          <line x1="12" y1="15" x2="12" y2="3"></line>
                        </svg>
                      </button>
                      
                      {/* Copy button */}
                      <button className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white/90">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                      </button>
                      
                      {/* Fullscreen button */}
                      <button className="p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-white/90">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M15 3h6v6"></path>
                          <path d="M9 21H3v-6"></path>
                          <path d="M21 3l-7 7"></path>
                          <path d="M3 21l7-7"></path>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
                
                <div className="pt-3 border-t border-white/10">
                  <button 
                    className="w-full py-2.5 px-4 text-sm text-white/80 bg-white/5 border border-white/10 rounded-md hover:bg-white/10 transition-colors flex items-center justify-center"
                    onClick={handleToggleExpand}
                  >
                    <span>Configure Settings</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-2">
                      <polyline points="7 13 12 18 17 13"></polyline>
                      <polyline points="7 6 12 11 17 6"></polyline>
                    </svg>
                  </button>
                </div>
              </div>
            )}
            
            {type === 'bridge' && (
              <div className="space-y-4">
                {/* Visual representation of the bridge connection */}
                <div className="relative h-32 flex items-center justify-center">
                  {/* Connection line with animated dots to represent data flow */}
                  <div className="w-full h-2 bg-gradient-to-r from-indigo-600/20 via-indigo-500/30 to-indigo-600/20 rounded-full relative overflow-hidden">
                    {nodeState?.isActive && (
                      <div className="absolute inset-0 flex items-center">
                        <div className="h-1.5 w-8 bg-indigo-500 rounded-full animate-[move-right_1.5s_linear_infinite]"></div>
                      </div>
                    )}
                  </div>
                  
                  {/* Connection nodes */}
                  <div className="absolute inset-y-0 left-0 flex flex-col items-center justify-center">
                    <div className={`h-6 w-6 rounded-full mb-1 flex items-center justify-center ${nodeState?.isConnected ? 'bg-indigo-600' : 'bg-white/10'}`}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                      </svg>
                    </div>
                    <div className="text-xs font-medium text-white/60">Input</div>
                  </div>
                  
                  <div className="absolute inset-y-0 right-0 flex flex-col items-center justify-center">
                    <div className={`h-6 w-6 rounded-full mb-1 flex items-center justify-center ${nodeState?.isConnected ? 'bg-indigo-600' : 'bg-white/10'}`}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polygon points="10 8 16 12 10 16 10 8"></polygon>
                      </svg>
                    </div>
                    <div className="text-xs font-medium text-white/60">Output</div>
                  </div>
                  
                  {/* Mode indicator in center */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="bg-black/60 text-white px-3 py-1.5 rounded-full text-xs font-medium">
                      {nodeState?.bridgeMode || 'Pass-through'}
                    </div>
                  </div>
                </div>
                
                {/* Bridge label with type indicator */}
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <input
                      type="text"
                      className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-3 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
                      placeholder="Bridge label (optional)"
                      value={nodeState?.bridgeLabel || ''}
                      onChange={(e) => {
                        // Dispatch label change event
                        const event = new CustomEvent('bridge-label-change', { 
                          detail: { nodeId: id, value: e.target.value } 
                        });
                        window.dispatchEvent(event);
                      }}
                    />
                  </div>
                  
                  {nodeState?.isConnected && nodeState?.dataType && (
                    <div className="flex-initial px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-xs text-white/70 font-medium">
                      {nodeState.dataType}
                    </div>
                  )}
                </div>
                
                {/* Mode switcher */}
                <div className="pt-3 border-t border-white/10">
                  <div className="grid grid-cols-2 gap-2">
                    {['Pass-through', 'Reroute'].map((mode) => (
                      <button
                        key={mode}
                        className={`py-2 px-1 text-sm rounded-md border focus:outline-none transition-colors
                          ${(nodeState?.bridgeMode || 'Pass-through') === mode 
                            ? 'bg-indigo-500/30 border-indigo-400/50 text-white' 
                            : 'bg-black/30 border-white/10 text-white/70 hover:bg-white/5'}`}
                        onClick={() => {
                          // Dispatch mode change event
                          const event = new CustomEvent('bridge-mode-change', { 
                            detail: { nodeId: id, value: mode } 
                          });
                          window.dispatchEvent(event);
                        }}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                  <button 
                    className="w-full mt-3 py-2.5 px-4 text-sm text-white/80 bg-white/5 border border-white/10 rounded-md hover:bg-white/10 transition-colors flex items-center justify-center"
                    onClick={handleToggleExpand}
                  >
                    <span>Configure Settings</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-2">
                      <polyline points="7 13 12 18 17 13"></polyline>
                      <polyline points="7 6 12 11 17 6"></polyline>
                    </svg>
                  </button>
                </div>
              </div>
            )}

            {type !== 'llm' && type !== 'image' && type !== 'video' && 
             type !== 'upscale-image' && type !== 'upscale-video' && 
             type !== 'utility' && type !== 'save' && type !== 'preview' && 
             type !== 'bridge' && defaultContent && (
              defaultContent
            )}
            
            {type !== 'llm' && type !== 'image' && type !== 'video' && 
             type !== 'upscale-image' && type !== 'upscale-video' && 
             type !== 'utility' && type !== 'save' && type !== 'preview' && 
             type !== 'bridge' && !defaultContent && (
              <div className="space-y-4">
                <div className="text-sm text-white/60 italic text-center py-3 px-4 bg-black/20 rounded-lg">
                  Configure this node by clicking the settings button below
                </div>
                <div className="pt-3">
                  <button 
                    className="w-full py-2.5 px-4 text-sm text-white/80 bg-white/5 border border-white/10 rounded-md hover:bg-white/10 transition-colors flex items-center justify-center"
                    onClick={handleToggleExpand}
                  >
                    <span>Configure Settings</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-2">
                      <polyline points="7 13 12 18 17 13"></polyline>
                      <polyline points="7 6 12 11 17 6"></polyline>
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
        
        {/* Expanded settings */}
        {isExpanded && (
          <div className="mt-4 border-t border-white/10 pt-4 overflow-hidden">
            {/* Container with dynamic width monitoring */}
            <div className="relative" ref={expandedContentRef}>
              <div className="grid auto-rows-auto gap-4 content-start"
                style={{ 
                  gridTemplateColumns: isWideEnough 
                    ? 'repeat(auto-fit, minmax(250px, 1fr))'  // Multi-column for wide content
                    : 'minmax(0, 1fr)',                       // Single column for narrow content
                  minHeight: '100px',
                  maxHeight: showAdvancedSettings ? '400px' : '250px',
                  overflowY: 'auto'
                }}>
                {/* Wrap children in a context provider that gives placement hints */}
                <NodeContentContext.Provider value={{ 
                  isExpanded, 
                  containerWidth: expandedContentWidth,
                  isWideLayout: isWideEnough,
                  showAdvancedSettings,
                  toggleAdvancedSettings
                }}>
                  {/* If children are not wrapped in BasicSettings/AdvancedSettings,
                      use this fallback wrapper to handle them appropriately */}
                  <SettingsWrapper>
                    {children}
                  </SettingsWrapper>
                </NodeContentContext.Provider>
              </div>
              
              {/* Advanced settings toggle button */}
              <div className="mt-4 flex justify-center">
                <button
                  className="text-xs text-white/60 hover:text-white flex items-center gap-1.5 px-3 py-1.5 rounded-md hover:bg-white/10 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleAdvancedSettings();
                  }}
                >
                  {showAdvancedSettings ? (
                    <>
                      <span>Hide Advanced Settings</span>
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="18 15 12 9 6 15"></polyline>
                      </svg>
                    </>
                  ) : (
                    <>
                      <span>Show Advanced Settings</span>
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9"></polyline>
                      </svg>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Input connection points - positioned on the left side with optimized hover effects */}
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-center items-start">
        {inputs.map((input) => {
          // Color-code the input based on type
          const inputTypeColor = 
            input.type === 'text' ? 'bg-yellow-500/50' :
            input.type === 'image' ? 'bg-green-500/50' :
            input.type === 'video' ? 'bg-blue-500/50' :
            input.type === 'parameter' ? 'bg-purple-500/50' :
            input.type === 'any' ? 'bg-white/50' :
            'bg-white/50';
          
          return (
            <div 
              key={`input-${input.id}`}
              className="relative -ml-2.5 my-2 group"
            >
              <div
                id={`node-${id}-input-${input.id}`}
                className={`w-5 h-5 rounded-full flex items-center justify-center ${getTypeStyles(type).inputColor} shadow-md cursor-pointer z-20 node-connector
                  transition-all duration-300 transform-gpu hover:scale-110 hover:brightness-110 ${isConnecting ? 'animate-pulse' : ''}`}
                onClick={(e) => handleCompleteConnection(input.id, e)}
                title={`${input.label} (${input.type})`}
                role="button"
                aria-label={`Input: ${input.label} (${input.type})`}
              >
                <div className={`w-2.5 h-2.5 ${inputTypeColor} rounded-full`}></div>
              </div>
              <div className="absolute left-5 top-1/2 -translate-y-1/2 bg-[#121212] text-white text-xs rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap pointer-events-none z-30">
                <span>{input.label}</span>
                <span className="ml-1 opacity-70">({input.type})</span>
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Output connection points - positioned on the right side with optimized hover effects */}
      <div className="absolute right-0 top-0 bottom-0 flex flex-col justify-center items-end">
        {outputs.map((output) => {
          // Color-code the output based on type
          const outputTypeColor = 
            output.type === 'text' ? 'bg-yellow-500/50' :
            output.type === 'image' ? 'bg-green-500/50' :
            output.type === 'video' ? 'bg-blue-500/50' : 
            'bg-white/50';
          
          return (
            <div 
              key={`output-${output.id}`}
              className="relative -mr-2.5 my-2 group"
            >
              <div
                id={`node-${id}-output-${output.id}`}
                className={`w-5 h-5 rounded-full flex items-center justify-center ${getTypeStyles(type).outputColor} shadow-md cursor-pointer z-20 node-connector
                  transition-all duration-300 transform-gpu hover:scale-110 hover:brightness-110 ${isConnectionSource ? 'animate-pulse' : ''}`}
                onClick={(e) => handleStartConnection(output.id, e)}
                title={`${output.label} (${output.type})`}
                role="button"
                aria-label={`Output: ${output.label} (${output.type})`}
              >
                <div className={`w-2.5 h-2.5 ${outputTypeColor} rounded-full`}></div>
              </div>
              <div className="absolute right-5 top-1/2 -translate-y-1/2 bg-[#121212] text-white text-xs rounded px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300 whitespace-nowrap pointer-events-none z-30">
                <span>{output.label}</span>
                <span className="ml-1 opacity-70">({output.type})</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Wrapper for basic settings that are always shown
export const BasicSettings: React.FC<{children: React.ReactNode, className?: string}> = ({ 
  children, 
  className = '' 
}) => {
  return (
    <div className={`grid grid-cols-2 gap-2 mt-2 ${className}`}>
      {React.Children.map(children, child => {
        if (
          React.isValidElement(child) &&
          (child.type === NodeContentItem || 
           child.type === AutoSizeNodeContent)
        ) {
          // Type assertion for child.props
          const childProps = child.props as Partial<NodeContentItemProps>;
          return React.cloneElement(child, { 
            ...childProps,
            basic: true, 
            advanced: false 
          } as React.HTMLAttributes<HTMLElement> & Partial<NodeContentItemProps>);
        }
        
        return child;
      })}
    </div>
  );
};

// Wrapper for advanced settings that are only shown when toggled
export const AdvancedSettings: React.FC<{children: React.ReactNode, className?: string}> = ({ 
  children, 
  className = '' 
}) => {
  return (
    <div className={`grid grid-cols-2 gap-2 mt-2 ${className}`}>
      {React.Children.map(children, child => {
        if (
          React.isValidElement(child) && 
          (child.type === NodeContentItem || 
           child.type === AutoSizeNodeContent)
        ) {
          // Type assertion for child.props
          const childProps = child.props as Partial<NodeContentItemProps>;
          return React.cloneElement(child, { 
            ...childProps,
            advanced: true, 
            basic: false 
          } as React.HTMLAttributes<HTMLElement> & Partial<NodeContentItemProps>);
        }
        
        return child;
      })}
    </div>
  );
};

// Wrapper that automatically categorizes settings into basic and advanced
const SettingsWrapper: React.FC<{children: React.ReactNode}> = ({ children }) => {
  const { showAdvancedSettings } = useNodeContent();
  
  // Check if children is already using BasicSettings/AdvancedSettings
  const childArray = React.Children.toArray(children);
  const hasWrappedSettings = childArray.some(
    child => React.isValidElement(child) && 
             (child.type === BasicSettings || child.type === AdvancedSettings)
  );
  
  // If already using wrappers, just pass children through
  if (hasWrappedSettings) {
    return <>{children}</>;
  }
  
  // Deep check for the advanced property on any nested NodeContentItem
  const isAdvancedItem = (child: React.ReactNode): boolean => {
    if (!React.isValidElement(child)) return false;
    
    const props = child.props as Partial<NodeContentItemProps> & { children?: React.ReactNode };
    
    // Direct check for advanced prop
    if (props.advanced === true) return true;
    
    // Check if this is a NodeContentItem or derived component
    if (
      child.type === NodeContentItem || 
      child.type === AdvancedNodeContentItem || 
      child.type === AutoSizeNodeContent || 
      child.type === BasicAutoSizeNodeContent ||
      child.type === AdvancedAutoSizeNodeContent
    ) {
      // Fix the comparison
      return props.advanced ? true : false;
    }
    
    // Check for advanced property in children
    if (props.children) {
      return React.Children.toArray(props.children).some(isAdvancedItem);
    }
    
    return false;
  };
  
  // Otherwise, automatically categorize children based on advanced props or position
  const basicCount = Math.min(childArray.length, 3);
  
  return (
    <>
      {/* Show only first 3 items or items explicitly marked as basic when not showing advanced */}
      {React.Children.map(children, (child, index) => {
        if (!React.isValidElement(child)) return null;
        
        const isAdvanced = isAdvancedItem(child) || (index >= basicCount && !isBasicItem(child));
        
        if (isAdvanced && !showAdvancedSettings) {
          // Don't render advanced settings if hidden
          return null;
        }
        
        return child;
      })}
    </>
  );
};

// Helper function to check if an item is explicitly marked as basic
const isBasicItem = (child: React.ReactElement): boolean => {
  const props = child.props as Partial<NodeContentItemProps> & { children?: React.ReactNode };
  
  if (props.basic === true) return true;
  
  // Check if this is a BasicSettings component
  if (child.type === BasicSettings) return true;
  
  // Check for basic property in children
  if (props.children) {
    return React.Children.toArray(props.children).some(
      c => React.isValidElement(c) && isBasicItem(c as React.ReactElement)
    );
  }
  
  return false;
};

export default BaseNode;