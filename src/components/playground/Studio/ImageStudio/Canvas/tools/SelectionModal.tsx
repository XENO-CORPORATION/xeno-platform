import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Square, Circle, Lasso, Wand2, Save, RefreshCw } from 'lucide-react';
import { Selection, SelectionArea, SelectionTool } from './types';

interface SelectionModalProps {
  isVisible: boolean;
  position: { x: number; y: number };
  zIndex: number;
  isDragging: boolean;
  onPositionChange: (position: { x: number; y: number }) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onClose: () => void;
  onBringToFront: () => void;
  onHover?: (isHovering: boolean) => void;
  isOnTop: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  imageObj: HTMLImageElement | null;
  scale: number;
  translateX: number;
  translateY: number;
  onSelectionChange: (selection: Selection | null) => void;
  currentSelection: Selection | null;
}

// Professional multi-canvas selection system
export default function SelectionModal({
  isVisible,
  position,
  zIndex,
  isDragging,
  onPositionChange,
  onDragStart,
  onDragEnd,
  onClose,
  onBringToFront,
  onHover,
  isOnTop,
  canvasRef,
  imageObj,
  scale,
  translateX,
  translateY,
  onSelectionChange,
  currentSelection
}: SelectionModalProps) {

  // ARCHITECTURE: Separate overlay canvas for selections
  const selectionOverlayRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isAnimating = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const isOverlaySetup = useRef(false);

  // Selection state management
  const [selectedTool, setSelectedTool] = useState<SelectionTool>({ type: 'rectangular' });
  const [selectionMode, setSelectionMode] = useState<'new' | 'add' | 'subtract' | 'intersect'>('new');
  const [isCreatingSelection, setIsCreatingSelection] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionCurrent, setSelectionCurrent] = useState<{ x: number; y: number } | null>(null);

  // Dragging functionality
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

  // CORE FIX: Initialize overlay canvas system with better state management
  const setupOverlayCanvas = useCallback(() => {
    if (!isVisible || !canvasRef?.current || !imageObj) return false;

    const mainCanvas = canvasRef.current;
    const overlay = selectionOverlayRef.current;
    if (!overlay) return false;

    // ARCHITECTURE: Match overlay to main canvas exactly
    const rect = mainCanvas.getBoundingClientRect();
    overlay.width = mainCanvas.width;
    overlay.height = mainCanvas.height;
    overlay.style.position = 'absolute';
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.pointerEvents = 'auto';
    overlay.style.zIndex = '1001';
    overlay.style.cursor = 'crosshair';

    console.log('🎯 OVERLAY: Setup complete', {
      width: overlay.width,
      height: overlay.height,
      position: { left: rect.left, top: rect.top }
    });

    return true;
  }, [isVisible, canvasRef, imageObj, scale, translateX, translateY]);

  useEffect(() => {
    if (setupOverlayCanvas()) {
      isOverlaySetup.current = true;
    } else {
      isOverlaySetup.current = false;
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      isAnimating.current = false;
    };
  }, [setupOverlayCanvas]);

  // ARCHITECTURE: Professional selection preview system
  const renderSelectionPreview = useCallback(() => {
    if (!isCreatingSelection || !selectionStart || !selectionCurrent) return;

    const overlay = selectionOverlayRef.current;
    if (!overlay) return;

    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    // Clear overlay canvas
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    // PROFESSIONAL: Render existing selection with reduced opacity during preview
    if (currentSelection && selectionMode !== 'new') {
      ctx.save();
      ctx.globalAlpha = 0.3;
      renderStaticSelection(ctx, currentSelection);
      ctx.restore();
    }

    // PROFESSIONAL: Render preview with dashed outline
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.8;

    const startX = selectionStart.x * scale + translateX;
    const startY = selectionStart.y * scale + translateY;
    const currentX = selectionCurrent.x * scale + translateX;
    const currentY = selectionCurrent.y * scale + translateY;

    switch (selectedTool.type) {
      case 'rectangular':
        const width = currentX - startX;
        const height = currentY - startY;
        ctx.strokeRect(startX, startY, width, height);
        break;
      case 'elliptical':
        const centerX = (startX + currentX) / 2;
        const centerY = (startY + currentY) / 2;
        const radiusX = Math.abs(currentX - startX) / 2;
        const radiusY = Math.abs(currentY - startY) / 2;
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
        ctx.stroke();
        break;
    }

    ctx.restore();
  }, [isCreatingSelection, selectionStart, selectionCurrent, currentSelection, selectedTool.type, scale, translateX, translateY, selectionMode]);

  // ARCHITECTURE: Professional marching ants animation
  const renderMarchingAnts = useCallback((selection: Selection) => {
    const overlay = selectionOverlayRef.current;
    if (!overlay || !selection) return;

    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    // Stop any existing animation
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    isAnimating.current = true;
    let dashOffset = 0;

    const animate = () => {
      if (!isAnimating.current || !overlay) return;

      // Clear and redraw
      ctx.clearRect(0, 0, overlay.width, overlay.height);

      // PROFESSIONAL: Marching ants effect
      ctx.save();
      ctx.strokeStyle = '#000000';
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = dashOffset;
      ctx.lineWidth = 1;

      renderStaticSelection(ctx, selection);

      // White outline for contrast
      ctx.strokeStyle = '#ffffff';
      ctx.lineDashOffset = dashOffset + 4;
      renderStaticSelection(ctx, selection);

      ctx.restore();

      // Animate dash offset for marching effect
      dashOffset = (dashOffset + 0.5) % 8;
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animate();
  }, [scale, translateX, translateY]);

  // Helper function to render selection outline for a single area
  const renderSelectionArea = (ctx: CanvasRenderingContext2D, area: SelectionArea) => {
    const x = area.bounds.x * scale + translateX;
    const y = area.bounds.y * scale + translateY;
    const width = area.bounds.width * scale;
    const height = area.bounds.height * scale;

    switch (area.type) {
      case 'rectangular':
        ctx.strokeRect(x, y, width, height);
        break;
      case 'elliptical':
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const radiusX = width / 2;
        const radiusY = height / 2;
        ctx.beginPath();
        ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, 2 * Math.PI);
        ctx.stroke();
        break;
      case 'complex':
        // Simplified outline for complex selections
        ctx.strokeRect(x, y, width, height);
        break;
    }
  };

  // Helper function to render all selection areas with outer boundary only
  const renderStaticSelection = (ctx: CanvasRenderingContext2D, selection: Selection) => {
    if (selection.areas.length === 1) {
      // Single area - render normally
      renderSelectionArea(ctx, selection.areas[0]);
    } else {
      // Multiple areas - render only outer boundary
      renderOuterBoundary(ctx, selection.areas);
    }
  };

  // Calculate and render only the outer boundary of overlapping rectangular selections
  const renderOuterBoundary = (ctx: CanvasRenderingContext2D, areas: SelectionArea[]) => {
    // For now, focus on rectangular selections
    const rectangularAreas = areas.filter(area => area.type === 'rectangular');
    
    if (rectangularAreas.length === 0) {
      // Fallback to normal rendering for non-rectangular
      areas.forEach(area => renderSelectionArea(ctx, area));
      return;
    }

    // Calculate the outer boundary using geometric union
    const outerBoundarySegments = calculateOuterBoundary(rectangularAreas);
    
    // Render the boundary segments
    ctx.beginPath();
    outerBoundarySegments.forEach(segment => {
      const startX = segment.start.x * scale + translateX;
      const startY = segment.start.y * scale + translateY;
      const endX = segment.end.x * scale + translateX;
      const endY = segment.end.y * scale + translateY;
      
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
    });
    ctx.stroke();
  };

  // Calculate outer boundary segments for rectangular areas
  const calculateOuterBoundary = (areas: SelectionArea[]): Array<{start: {x: number, y: number}, end: {x: number, y: number}}> => {
    if (areas.length === 0) return [];
    if (areas.length === 1) {
      // Single rectangle - return all four edges
      const rect = areas[0].bounds;
      return [
        { start: { x: rect.x, y: rect.y }, end: { x: rect.x + rect.width, y: rect.y } }, // top
        { start: { x: rect.x + rect.width, y: rect.y }, end: { x: rect.x + rect.width, y: rect.y + rect.height } }, // right
        { start: { x: rect.x + rect.width, y: rect.y + rect.height }, end: { x: rect.x, y: rect.y + rect.height } }, // bottom
        { start: { x: rect.x, y: rect.y + rect.height }, end: { x: rect.x, y: rect.y } } // left
      ];
    }

    // For multiple rectangles, use scanline algorithm to find outer boundary
    return calculateRectangleUnionBoundary(areas.map(area => area.bounds));
  };

  // Advanced algorithm to calculate the outer boundary of overlapping rectangles
  const calculateRectangleUnionBoundary = (rectangles: Array<{x: number, y: number, width: number, height: number}>): Array<{start: {x: number, y: number}, end: {x: number, y: number}}> => {
    if (rectangles.length === 0) return [];
    if (rectangles.length === 1) {
      const rect = rectangles[0];
      return [
        { start: { x: rect.x, y: rect.y }, end: { x: rect.x + rect.width, y: rect.y } },
        { start: { x: rect.x + rect.width, y: rect.y }, end: { x: rect.x + rect.width, y: rect.y + rect.height } },
        { start: { x: rect.x + rect.width, y: rect.y + rect.height }, end: { x: rect.x, y: rect.y + rect.height } },
        { start: { x: rect.x, y: rect.y + rect.height }, end: { x: rect.x, y: rect.y } }
      ];
    }

    // Collect all unique X and Y coordinates to create a grid
    const xCoords = new Set<number>();
    const yCoords = new Set<number>();
    
    rectangles.forEach(rect => {
      xCoords.add(rect.x);
      xCoords.add(rect.x + rect.width);
      yCoords.add(rect.y);
      yCoords.add(rect.y + rect.height);
    });
    
    const sortedX = Array.from(xCoords).sort((a, b) => a - b);
    const sortedY = Array.from(yCoords).sort((a, b) => a - b);
    
    // Create a grid and mark which cells are covered
    const grid: boolean[][] = [];
    for (let i = 0; i < sortedY.length - 1; i++) {
      grid[i] = [];
      for (let j = 0; j < sortedX.length - 1; j++) {
        const cellX = sortedX[j];
        const cellY = sortedY[i];
        const cellWidth = sortedX[j + 1] - sortedX[j];
        const cellHeight = sortedY[i + 1] - sortedY[i];
        
        // Check if this cell is covered by any rectangle
        grid[i][j] = rectangles.some(rect => 
          rect.x <= cellX && 
          rect.y <= cellY && 
          rect.x + rect.width >= cellX + cellWidth && 
          rect.y + rect.height >= cellY + cellHeight
        );
      }
    }
    
    // Extract boundary segments from the grid
    const segments: Array<{start: {x: number, y: number}, end: {x: number, y: number}}> = [];
    
    // Horizontal segments (top and bottom edges of cells)
    for (let i = 0; i < grid.length; i++) {
      for (let j = 0; j < grid[i].length; j++) {
        if (grid[i][j]) {
          // Check top edge
          if (i === 0 || !grid[i - 1][j]) {
            segments.push({
              start: { x: sortedX[j], y: sortedY[i] },
              end: { x: sortedX[j + 1], y: sortedY[i] }
            });
          }
          // Check bottom edge
          if (i === grid.length - 1 || !grid[i + 1][j]) {
            segments.push({
              start: { x: sortedX[j], y: sortedY[i + 1] },
              end: { x: sortedX[j + 1], y: sortedY[i + 1] }
            });
          }
        }
      }
    }
    
    // Vertical segments (left and right edges of cells)
    for (let i = 0; i < grid.length; i++) {
      for (let j = 0; j < grid[i].length; j++) {
        if (grid[i][j]) {
          // Check left edge
          if (j === 0 || !grid[i][j - 1]) {
            segments.push({
              start: { x: sortedX[j], y: sortedY[i] },
              end: { x: sortedX[j], y: sortedY[i + 1] }
            });
          }
          // Check right edge
          if (j === grid[i].length - 1 || !grid[i][j + 1]) {
            segments.push({
              start: { x: sortedX[j + 1], y: sortedY[i] },
              end: { x: sortedX[j + 1], y: sortedY[i + 1] }
            });
          }
        }
      }
    }
    
    return segments;
  };

  // FIXED: Clean event handling system with proper cleanup
  useEffect(() => {
    if (!isVisible || !isOverlaySetup.current) return;

    const overlay = selectionOverlayRef.current;
    if (!overlay) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (!imageObj) return;

      const rect = overlay.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;

      const imageX = (canvasX - translateX) / scale;
      const imageY = (canvasY - translateY) / scale;

      if (imageX < 0 || imageY < 0 || imageX > imageObj.width || imageY > imageObj.height) {
        return;
      }

      console.log('🎯 OVERLAY: Starting selection', { imageX, imageY, tool: selectedTool.type });
      setIsCreatingSelection(true);
      setSelectionStart({ x: imageX, y: imageY });
      setSelectionCurrent({ x: imageX, y: imageY });
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isCreatingSelection || !selectionStart || !imageObj) return;

      const rect = overlay.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;

      const imageX = (canvasX - translateX) / scale;
      const imageY = (canvasY - translateY) / scale;

      setSelectionCurrent({ x: imageX, y: imageY });
    };

    const handleMouseUp = () => {
      if (!isCreatingSelection || !selectionStart || !selectionCurrent) return;

      console.log('🎯 OVERLAY: Completing selection', { start: selectionStart, current: selectionCurrent });
      createFinalSelection();
      
      // Reset creation state
      setIsCreatingSelection(false);
      setSelectionStart(null);
      setSelectionCurrent(null);
    };

    // Add event listeners
    overlay.addEventListener('mousedown', handleMouseDown);
    overlay.addEventListener('mousemove', handleMouseMove);
    overlay.addEventListener('mouseup', handleMouseUp);

    console.log('🎯 OVERLAY: Event listeners attached');

    return () => {
      // Clean up event listeners
      overlay.removeEventListener('mousedown', handleMouseDown);
      overlay.removeEventListener('mousemove', handleMouseMove);
      overlay.removeEventListener('mouseup', handleMouseUp);
      console.log('🎯 OVERLAY: Event listeners cleaned up');
    };
  }, [isVisible, isOverlaySetup.current, isCreatingSelection, selectionStart, selectionCurrent, imageObj, scale, translateX, translateY, selectedTool.type]);

  // Render preview during creation
  useEffect(() => {
    if (isCreatingSelection) {
      renderSelectionPreview();
    }
  }, [isCreatingSelection, renderSelectionPreview]);

  // FIXED: Proper selection and animation management
  useEffect(() => {
    if (currentSelection && !isCreatingSelection) {
      console.log('🎯 OVERLAY: Starting marching ants for selection');
      renderMarchingAnts(currentSelection);
    } else {
      // Stop animation and clear overlay
      console.log('🎯 OVERLAY: Stopping animation and clearing overlay');
      isAnimating.current = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      const overlay = selectionOverlayRef.current;
      if (overlay) {
        const ctx = overlay.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, overlay.width, overlay.height);
        }
      }
    }
  }, [currentSelection, isCreatingSelection, renderMarchingAnts]);

  // Helper function to check if two areas overlap
  const areasOverlap = (area1: SelectionArea, area2: SelectionArea): boolean => {
    // First check bounding box overlap
    const a1 = area1.bounds;
    const a2 = area2.bounds;
    
    const boundingBoxOverlap = !(
      a1.x + a1.width <= a2.x ||  // area1 is to the left of area2
      a2.x + a2.width <= a1.x ||  // area2 is to the left of area1
      a1.y + a1.height <= a2.y || // area1 is above area2
      a2.y + a2.height <= a1.y    // area2 is above area1
    );

    if (!boundingBoxOverlap) return false;

    // For same-type shapes, do more precise overlap detection
    if (area1.type === area2.type) {
      if (area1.type === 'rectangular') {
        // Rectangles overlap if bounding boxes overlap
        return true;
      } else if (area1.type === 'elliptical') {
        // Ellipse overlap detection
        const center1 = { x: a1.x + a1.width / 2, y: a1.y + a1.height / 2 };
        const center2 = { x: a2.x + a2.width / 2, y: a2.y + a2.height / 2 };
        const rx1 = a1.width / 2, ry1 = a1.height / 2;
        const rx2 = a2.width / 2, ry2 = a2.height / 2;
        
        const dx = center2.x - center1.x;
        const dy = center2.y - center1.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        const avgRadius1 = (rx1 + ry1) / 2;
        const avgRadius2 = (rx2 + ry2) / 2;
        return distance < (avgRadius1 + avgRadius2) * 0.9; // 90% threshold for ellipse overlap
      }
    }

    // For mixed types, use bounding box overlap
    return true;
  };

  // Helper function to calculate intersection of two rectangular areas
  const getRectangleIntersection = (area1: SelectionArea, area2: SelectionArea): SelectionArea | null => {
    const a1 = area1.bounds;
    const a2 = area2.bounds;
    
    const left = Math.max(a1.x, a2.x);
    const right = Math.min(a1.x + a1.width, a2.x + a2.width);
    const top = Math.max(a1.y, a2.y);
    const bottom = Math.min(a1.y + a1.height, a2.y + a2.height);
    
    // No intersection if invalid bounds
    if (left >= right || top >= bottom) return null;
    
    return {
      id: `intersection-${Date.now()}`,
      type: 'rectangular',
      points: [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom }
      ],
      bounds: {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top
      },
      feather: Math.max(area1.feather, area2.feather),
      antiAlias: area1.antiAlias || area2.antiAlias
    };
  };

  // Helper function to subtract one rectangle from another (returns array of remaining pieces)
  const subtractRectangles = (area1: SelectionArea, intersection: SelectionArea): SelectionArea[] => {
    const a1 = area1.bounds;
    const inter = intersection.bounds;
    const result: SelectionArea[] = [];
    
    // Top piece
    if (a1.y < inter.y) {
      result.push({
        id: `remainder-top-${Date.now()}`,
        type: 'rectangular',
        points: [
          { x: a1.x, y: a1.y },
          { x: a1.x + a1.width, y: a1.y },
          { x: a1.x + a1.width, y: inter.y },
          { x: a1.x, y: inter.y }
        ],
        bounds: {
          x: a1.x,
          y: a1.y,
          width: a1.width,
          height: inter.y - a1.y
        },
        feather: area1.feather,
        antiAlias: area1.antiAlias
      });
    }
    
    // Bottom piece
    if (a1.y + a1.height > inter.y + inter.height) {
      result.push({
        id: `remainder-bottom-${Date.now()}`,
        type: 'rectangular',
        points: [
          { x: a1.x, y: inter.y + inter.height },
          { x: a1.x + a1.width, y: inter.y + inter.height },
          { x: a1.x + a1.width, y: a1.y + a1.height },
          { x: a1.x, y: a1.y + a1.height }
        ],
        bounds: {
          x: a1.x,
          y: inter.y + inter.height,
          width: a1.width,
          height: (a1.y + a1.height) - (inter.y + inter.height)
        },
        feather: area1.feather,
        antiAlias: area1.antiAlias
      });
    }
    
    // Left piece
    if (a1.x < inter.x) {
      result.push({
        id: `remainder-left-${Date.now()}`,
        type: 'rectangular',
        points: [
          { x: a1.x, y: Math.max(a1.y, inter.y) },
          { x: inter.x, y: Math.max(a1.y, inter.y) },
          { x: inter.x, y: Math.min(a1.y + a1.height, inter.y + inter.height) },
          { x: a1.x, y: Math.min(a1.y + a1.height, inter.y + inter.height) }
        ],
        bounds: {
          x: a1.x,
          y: Math.max(a1.y, inter.y),
          width: inter.x - a1.x,
          height: Math.min(a1.y + a1.height, inter.y + inter.height) - Math.max(a1.y, inter.y)
        },
        feather: area1.feather,
        antiAlias: area1.antiAlias
      });
    }
    
    // Right piece
    if (a1.x + a1.width > inter.x + inter.width) {
      result.push({
        id: `remainder-right-${Date.now()}`,
        type: 'rectangular',
        points: [
          { x: inter.x + inter.width, y: Math.max(a1.y, inter.y) },
          { x: a1.x + a1.width, y: Math.max(a1.y, inter.y) },
          { x: a1.x + a1.width, y: Math.min(a1.y + a1.height, inter.y + inter.height) },
          { x: inter.x + inter.width, y: Math.min(a1.y + a1.height, inter.y + inter.height) }
        ],
        bounds: {
          x: inter.x + inter.width,
          y: Math.max(a1.y, inter.y),
          width: (a1.x + a1.width) - (inter.x + inter.width),
          height: Math.min(a1.y + a1.height, inter.y + inter.height) - Math.max(a1.y, inter.y)
        },
        feather: area1.feather,
        antiAlias: area1.antiAlias
      });
    }
    
    // Filter out any invalid pieces (zero area)
    return result.filter(piece => piece.bounds.width > 0 && piece.bounds.height > 0);
  };

  // Helper function to merge overlapping areas using proper intersection/union logic
  const mergeOverlappingAreas = (areas: SelectionArea[]): SelectionArea[] => {
    if (areas.length <= 1) return areas;

    const result: SelectionArea[] = [];
    const processed = new Set<number>();

    for (let i = 0; i < areas.length; i++) {
      if (processed.has(i)) continue;

      let currentArea = areas[i];
      let foundOverlap = false;

      // Look for overlapping areas
      for (let j = i + 1; j < areas.length; j++) {
        if (processed.has(j)) continue;

        if (areasOverlap(currentArea, areas[j])) {
          foundOverlap = true;
          const area2 = areas[j];
          
          console.log('🔄 GEOMETRIC MERGE: Merging overlapping areas', currentArea.id, 'with', area2.id);

          // For rectangular areas, do proper geometric union
          if (currentArea.type === 'rectangular' && area2.type === 'rectangular') {
            // Find intersection
            const intersection = getRectangleIntersection(currentArea, area2);
            
            if (intersection) {
              // Add the intersection as a unified area
              result.push({
                ...intersection,
                id: `merged-intersection-${Date.now()}`
              });
              
              // Add non-overlapping parts of area1
              const area1Remainders = subtractRectangles(currentArea, intersection);
              result.push(...area1Remainders);
              
              // Add non-overlapping parts of area2
              const area2Remainders = subtractRectangles(area2, intersection);
              result.push(...area2Remainders);
              
              processed.add(i);
              processed.add(j);
              break; // Process next unprocessed area
            }
          } else {
            // For non-rectangular or mixed types, fall back to bounding box merge
            const a1 = currentArea.bounds;
            const a2 = area2.bounds;
            
            const minX = Math.min(a1.x, a2.x);
            const minY = Math.min(a1.y, a2.y);
            const maxX = Math.max(a1.x + a1.width, a2.x + a2.width);
            const maxY = Math.max(a1.y + a1.height, a2.y + a2.height);
            
            currentArea = {
              id: `merged-bounds-${Date.now()}`,
              type: 'rectangular', // Convert to rectangular for simplicity
              points: [
                { x: minX, y: minY },
                { x: maxX, y: minY },
                { x: maxX, y: maxY },
                { x: minX, y: maxY }
              ],
              bounds: {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY
              },
              feather: Math.max(currentArea.feather, area2.feather),
              antiAlias: currentArea.antiAlias || area2.antiAlias
            };
            
            processed.add(j);
          }
        }
      }

      // If no overlap found, add the area as-is
      if (!foundOverlap) {
        result.push(currentArea);
        processed.add(i);
      } else if (!processed.has(i)) {
        // If we merged with bounding box, add the merged result
        result.push(currentArea);
        processed.add(i);
      }
    }

    console.log('🔄 GEOMETRIC MERGE: Processed', areas.length, 'areas into', result.length, 'result areas');
    return result;
  };

  // Helper function to subtract a new area from existing selection areas
  const subtractAreaFromSelection = (existingAreas: SelectionArea[], subtractArea: SelectionArea): SelectionArea[] => {
    const resultAreas: SelectionArea[] = [];

    existingAreas.forEach(existingArea => {
      if (!areasOverlap(existingArea, subtractArea)) {
        // No overlap - keep the existing area as-is
        resultAreas.push(existingArea);
      } else {
        // There's overlap - subtract the overlapping portion
        const intersection = getRectangleIntersection(existingArea, subtractArea);
        if (intersection) {
          // Use the existing subtractRectangles function to get the remaining pieces
          const remainingPieces = subtractRectangles(existingArea, intersection);
          resultAreas.push(...remainingPieces);
        } else {
          // No intersection found, keep original area
          resultAreas.push(existingArea);
        }
      }
    });

    console.log('🔪 SUBTRACT: Processed', existingAreas.length, 'areas with subtraction, resulting in', resultAreas.length, 'areas');
    return resultAreas;
  };

  const createFinalSelection = () => {
    if (!selectionStart || !selectionCurrent || !imageObj) return;

    const minX = Math.min(selectionStart.x, selectionCurrent.x);
    const minY = Math.min(selectionStart.y, selectionCurrent.y);
    const maxX = Math.max(selectionStart.x, selectionCurrent.x);
    const maxY = Math.max(selectionStart.y, selectionCurrent.y);

    // Don't create tiny selections
    if (Math.abs(maxX - minX) < 5 || Math.abs(maxY - minY) < 5) {
      console.log('🎯 OVERLAY: Selection too small, ignoring');
      return;
    }

    // Create new selection area
    const newArea: SelectionArea = {
      id: `selection-area-${Date.now()}`,
      type: selectedTool.type,
      points: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY }
      ],
      bounds: {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
      },
      feather: 0,
      antiAlias: true
    };

    let newSelection: Selection;

    if (selectionMode === 'new' || !currentSelection) {
      // New selection - replace all existing areas
      newSelection = {
        areas: [newArea],
        totalBounds: newArea.bounds,
        feather: 0,
        antiAlias: true
      };
    } else if (selectionMode === 'add') {
      // Add mode - combine areas and merge overlapping ones
      const allAreas = [...currentSelection.areas, newArea];
      
      // 🔄 AUTOMATIC OVERLAP MERGING: Merge any overlapping areas
      const mergedAreas = mergeOverlappingAreas(allAreas);
      
      // Calculate total bounds that encompasses all merged areas
      let minTotalX = mergedAreas[0].bounds.x;
      let minTotalY = mergedAreas[0].bounds.y;
      let maxTotalX = mergedAreas[0].bounds.x + mergedAreas[0].bounds.width;
      let maxTotalY = mergedAreas[0].bounds.y + mergedAreas[0].bounds.height;

      mergedAreas.forEach(area => {
        minTotalX = Math.min(minTotalX, area.bounds.x);
        minTotalY = Math.min(minTotalY, area.bounds.y);
        maxTotalX = Math.max(maxTotalX, area.bounds.x + area.bounds.width);
        maxTotalY = Math.max(maxTotalY, area.bounds.y + area.bounds.height);
      });

      newSelection = {
        areas: mergedAreas,
        totalBounds: {
          x: minTotalX,
          y: minTotalY,
          width: maxTotalX - minTotalX,
          height: maxTotalY - minTotalY
        },
        feather: 0,
        antiAlias: true
      };
    } else if (selectionMode === 'subtract') {
      // Subtract mode - remove the new area from existing areas
      const subtractedAreas = subtractAreaFromSelection(currentSelection.areas, newArea);
      
      if (subtractedAreas.length === 0) {
        // If subtraction results in no areas, clear the selection
        console.log('🎯 SUBTRACT: All areas removed, clearing selection');
        onSelectionChange(null);
        return;
      }
      
      // Calculate total bounds for remaining areas
      let minTotalX = subtractedAreas[0].bounds.x;
      let minTotalY = subtractedAreas[0].bounds.y;
      let maxTotalX = subtractedAreas[0].bounds.x + subtractedAreas[0].bounds.width;
      let maxTotalY = subtractedAreas[0].bounds.y + subtractedAreas[0].bounds.height;

      subtractedAreas.forEach((area: SelectionArea) => {
        minTotalX = Math.min(minTotalX, area.bounds.x);
        minTotalY = Math.min(minTotalY, area.bounds.y);
        maxTotalX = Math.max(maxTotalX, area.bounds.x + area.bounds.width);
        maxTotalY = Math.max(maxTotalY, area.bounds.y + area.bounds.height);
      });

      newSelection = {
        areas: subtractedAreas,
        totalBounds: {
          x: minTotalX,
          y: minTotalY,
          width: maxTotalX - minTotalX,
          height: maxTotalY - minTotalY
        },
        feather: 0,
        antiAlias: true
      };
    } else if (selectionMode === 'intersect') {
      // Intersect mode - keep only overlapping areas
      const intersectionAreas: SelectionArea[] = [];
      
      currentSelection.areas.forEach(existingArea => {
        if (areasOverlap(existingArea, newArea)) {
          // Calculate intersection between existing area and new area
          const intersection = getRectangleIntersection(existingArea, newArea);
          if (intersection) {
            intersectionAreas.push(intersection);
          }
        }
      });
      
      if (intersectionAreas.length === 0) {
        // No intersections found - clear selection
        console.log('🎯 INTERSECT: No overlapping areas found, clearing selection');
        onSelectionChange(null);
        return;
      }
      
      // Calculate total bounds for intersection areas
      let minTotalX = intersectionAreas[0].bounds.x;
      let minTotalY = intersectionAreas[0].bounds.y;
      let maxTotalX = intersectionAreas[0].bounds.x + intersectionAreas[0].bounds.width;
      let maxTotalY = intersectionAreas[0].bounds.y + intersectionAreas[0].bounds.height;

      intersectionAreas.forEach(area => {
        minTotalX = Math.min(minTotalX, area.bounds.x);
        minTotalY = Math.min(minTotalY, area.bounds.y);
        maxTotalX = Math.max(maxTotalX, area.bounds.x + area.bounds.width);
        maxTotalY = Math.max(maxTotalY, area.bounds.y + area.bounds.height);
      });

      newSelection = {
        areas: intersectionAreas,
        totalBounds: {
          x: minTotalX,
          y: minTotalY,
          width: maxTotalX - minTotalX,
          height: maxTotalY - minTotalY
        },
        feather: 0,
        antiAlias: true
      };
      
      console.log('🎯 INTERSECT: Created', intersectionAreas.length, 'intersection area(s)');
    } else {
      // Fallback for any undefined modes
      newSelection = {
        areas: [newArea],
        totalBounds: newArea.bounds,
        feather: 0,
        antiAlias: true
      };
    }

    console.log('🎯 OVERLAY: Created selection with mode:', selectionMode, newSelection);
    onSelectionChange(newSelection);
  };

  const handleSave = () => {
    console.log('🎯 Selection settings saved');
    // Add any save logic here
  };

  const handleReset = () => {
    console.log('🎯 OVERLAY: Resetting selection system');
    
    // Stop any ongoing animation
    isAnimating.current = false;
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Clear overlay canvas
    const overlay = selectionOverlayRef.current;
    if (overlay) {
      const ctx = overlay.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, overlay.width, overlay.height);
      }
    }
    
    // Reset all states
    setSelectedTool({ type: 'rectangular' });
    setSelectionMode('new');
    setIsCreatingSelection(false);
    setSelectionStart(null);
    setSelectionCurrent(null);
    onSelectionChange(null);
    
    console.log('🎯 Selection system reset complete');
  };

  const handleClearSelection = () => {
    console.log('🎯 OVERLAY: Clearing selection');
    
    // Stop animation
    isAnimating.current = false;
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // Clear overlay
    const overlay = selectionOverlayRef.current;
    if (overlay) {
      const ctx = overlay.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, overlay.width, overlay.height);
      }
    }
    
    // Clear selection
    onSelectionChange(null);
    console.log('🎯 Selection cleared - ready for new selection');
  };

  if (!isVisible) {
    return null;
  }

  return (
    <>
      {/* ARCHITECTURE: Overlay canvas for selection rendering */}
      <canvas
        ref={selectionOverlayRef}
        className="selection-overlay"
        style={{
          position: 'absolute',
          pointerEvents: 'auto', // Always allow interaction for selection creation
          zIndex: 1001,
          cursor: 'crosshair'
        }}
      />

      {/* Main Modal Panel */}
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
              <h3 className="text-white text-sm font-medium">Selection Tools</h3>
            </div>
            <div className="flex items-center gap-1">
              {/* Save Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleSave();
                }}
                className="text-white/60 hover:text-white transition-colors p-1.5 rounded-md hover:bg-white/10"
                title="Save selection settings"
              >
                <Save size={14} />
              </button>
              
              {/* Reset Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleReset();
                }}
                className="text-white/60 hover:text-white transition-colors p-1.5 rounded-md hover:bg-white/10"
                title="Reset selections"
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
                title="Close selection tools"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Content - Scrollable */}
          <div 
            className="p-4 space-y-4 overflow-y-auto max-h-[calc(70vh-80px)] scrollbar-hide" 
            style={{
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
            }}
          >
            {/* Tool Selection */}
            <div className="space-y-2">
              <label className="text-white/70 text-xs block">Selection Tool</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setSelectedTool({ type: 'rectangular' as const })}
                  className={`p-3 rounded-lg border transition-all ${
                    selectedTool.type === 'rectangular'
                      ? 'border-blue-400 bg-blue-500/20 text-white'
                      : 'border-white/20 text-white/70 hover:border-white/40'
                  }`}
                >
                  <Square size={20} className="mx-auto mb-1" />
                  <div className="text-xs">Rectangle</div>
                </button>
                <button
                  onClick={() => setSelectedTool({ type: 'elliptical' as const })}
                  className={`p-3 rounded-lg border transition-all ${
                    selectedTool.type === 'elliptical'
                      ? 'border-blue-400 bg-blue-500/20 text-white'
                      : 'border-white/20 text-white/70 hover:border-white/40'
                  }`}
                >
                  <Circle size={20} className="mx-auto mb-1" />
                  <div className="text-xs">Ellipse</div>
                </button>
                <button
                  onClick={() => setSelectedTool({ type: 'lasso' as const })}
                  className={`p-3 rounded-lg border transition-all ${
                    selectedTool.type === 'lasso'
                      ? 'border-blue-400 bg-blue-500/20 text-white'
                      : 'border-white/20 text-white/70 hover:border-white/40'
                  }`}
                >
                  <Lasso size={20} className="mx-auto mb-1" />
                  <div className="text-xs">Lasso</div>
                </button>
                <button
                  onClick={() => setSelectedTool({ type: 'magic' as const })}
                  className={`p-3 rounded-lg border transition-all ${
                    selectedTool.type === 'magic'
                      ? 'border-blue-400 bg-blue-500/20 text-white'
                      : 'border-white/20 text-white/70 hover:border-white/40'
                  }`}
                >
                  <Wand2 size={20} className="mx-auto mb-1" />
                  <div className="text-xs">Magic Wand</div>
                </button>
              </div>
            </div>

            {/* Selection Mode */}
            <div className="space-y-2">
              <label className="text-white/70 text-xs block">Selection Mode</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setSelectionMode('new')}
                  className={`p-2 text-xs rounded border transition-all ${
                    selectionMode === 'new'
                      ? 'border-yellow-400 bg-yellow-500/20 text-yellow-300'
                      : 'border-white/20 text-white/70 hover:border-yellow-400/50'
                  }`}
                  title="Replace all existing selections"
                >
                  🆕 New
                </button>
                <button
                  onClick={() => setSelectionMode('add')}
                  className={`p-2 text-xs rounded border transition-all ${
                    selectionMode === 'add'
                      ? 'border-green-400 bg-green-500/20 text-green-300'
                      : 'border-white/20 text-white/70 hover:border-green-400/50'
                  }`}
                  title="Add new selection area to existing ones"
                >
                  ➕ Add
                </button>
                <button
                  onClick={() => setSelectionMode('subtract')}
                  className={`p-2 text-xs rounded border transition-all ${
                    selectionMode === 'subtract'
                      ? 'border-red-400 bg-red-500/20 text-red-300'
                      : 'border-white/20 text-white/70 hover:border-red-400/50'
                  }`}
                  title="Remove from existing selections"
                >
                  ➖ Subtract
                </button>
                <button
                  onClick={() => setSelectionMode('intersect')}
                  className={`p-2 text-xs rounded border transition-all ${
                    selectionMode === 'intersect'
                      ? 'border-purple-400 bg-purple-500/20 text-purple-300'
                      : 'border-white/20 text-white/70 hover:border-purple-400/50'
                  }`}
                  title="Keep only overlapping areas"
                >
                  ⚡ Intersect
                </button>
              </div>
            </div>

            {/* Clear Selection Button */}
            {currentSelection && (
              <div className="space-y-2">
                <button
                  onClick={handleClearSelection}
                  className="w-full p-2 text-sm bg-red-500/20 border border-red-500/30 text-red-300 rounded-lg hover:bg-red-500/30 transition-all"
                >
                  Clear Selection
                </button>
              </div>
            )}

            {/* Status */}
            <div className="bg-black/30 border border-white/10 rounded-lg p-3">
              <div className="text-white/70 text-xs mb-1 font-medium">Status</div>
              {isCreatingSelection ? (
                <div className="text-green-400 text-xs">✨ Creating selection...</div>
              ) : currentSelection ? (
                <div className="text-blue-400 text-xs">
                  🎯 Selection active ({currentSelection.areas.length} area{currentSelection.areas.length !== 1 ? 's' : ''})
                  <br />
                  📐 Total: {Math.round(currentSelection.totalBounds.width)} × {Math.round(currentSelection.totalBounds.height)}px
                </div>
              ) : (
                <div className="text-white/60 text-xs">📋 Click and drag to create selection</div>
              )}
              {isOverlaySetup.current && (
                <div className="text-green-400 text-xs mt-1">✅ Ready for selection</div>
              )}
            </div>

            {/* Instructions */}
            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
              <div className="text-blue-200 text-xs mb-1 font-medium">💡 How to Use:</div>
              <div className="space-y-1 text-xs text-blue-200/70">
                <div>• Click and drag on the image to create selection</div>
                <div>• Use different tools for various shapes</div>
                <div>• <span className="text-yellow-300">NEW mode:</span> Replaces all existing selections</div>
                <div>• <span className="text-green-300">ADD mode:</span> Adds new selection area to existing ones</div>
                <div>• <span className="text-cyan-300">AUTO-MERGE:</span> Overlapping areas automatically combine</div>
                <div>• <span className="text-red-300">SUBTRACT mode:</span> Removes from existing selections</div>
                <div>• <span className="text-purple-300">INTERSECT mode:</span> Keeps only the overlapping portions</div>
                <div>• If no overlap exists, selection is cleared automatically</div>
                <div>• All selection areas show marching ants when active</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
} 