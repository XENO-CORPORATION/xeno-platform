import React, { useRef, useEffect, useState } from 'react';
import { SmartGuides } from './types';

interface SmartGuidesProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  guides: SmartGuides;
  onGuidesChange: (guides: SmartGuides) => void;
  scale: number;
  translateX: number;
  translateY: number;
  imageSize: { width: number; height: number };
}

interface GuideLines {
  x: number[];
  y: number[];
  temporary?: {
    x?: number;
    y?: number;
    showDistance?: boolean;
    distance?: number;
  };
}

const SmartGuidesComponent: React.FC<SmartGuidesProps> = ({
  canvasRef,
  guides,
  onGuidesChange,
  scale,
  translateX,
  translateY,
  imageSize
}) => {
  const guidesCanvasRef = useRef<HTMLCanvasElement>(null);
  const [guideLines, setGuideLines] = useState<GuideLines>({ x: [], y: [] });
  const [isDraggingObject, setIsDraggingObject] = useState(false);
  const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });

  // Default guide positions (rule of thirds, center lines, etc.)
  const getDefaultGuides = () => {
    if (!imageSize.width || !imageSize.height) return { x: [], y: [] };

    const guides: GuideLines = { x: [], y: [] };

    // Center lines
    guides.x.push(imageSize.width / 2);
    guides.y.push(imageSize.height / 2);

    // Rule of thirds
    guides.x.push(imageSize.width / 3, (imageSize.width * 2) / 3);
    guides.y.push(imageSize.height / 3, (imageSize.height * 2) / 3);

    // Edge guides
    guides.x.push(0, imageSize.width);
    guides.y.push(0, imageSize.height);

    // Grid lines (if enabled)
    // Note: Grid lines would be added here based on global guides settings
    // This is handled separately in the drawGuides function

    return guides;
  };

  // Convert canvas coordinates to image coordinates
  const canvasToImage = (canvasX: number, canvasY: number) => {
    return {
      x: (canvasX - translateX) / scale,
      y: (canvasY - translateY) / scale
    };
  };

  // Convert image coordinates to canvas coordinates
  const imageToCanvas = (imageX: number, imageY: number) => {
    return {
      x: imageX * scale + translateX,
      y: imageY * scale + translateY
    };
  };

  // Find nearest guide lines for snapping
  const findNearestGuides = (x: number, y: number, snapDistance: number = 10) => {
    const imagePos = canvasToImage(x, y);
    const defaultGuides = getDefaultGuides();
    
    const snapX = defaultGuides.x.find(guideX => 
      Math.abs(imagePos.x - guideX) <= snapDistance / scale
    );
    
    const snapY = defaultGuides.y.find(guideY => 
      Math.abs(imagePos.y - guideY) <= snapDistance / scale
    );

    return { snapX, snapY };
  };

  // Snap position to guides
  const snapToGuides = (x: number, y: number) => {
    if (!guides.enabled) return { x, y };

    const { snapX, snapY } = findNearestGuides(x, y, guides.snapDistance);
    
    let snappedX = x;
    let snappedY = y;

    if (snapX !== undefined) {
      const canvasSnapX = imageToCanvas(snapX, 0).x;
      snappedX = canvasSnapX;
    }

    if (snapY !== undefined) {
      const canvasSnapY = imageToCanvas(0, snapY).y;
      snappedY = canvasSnapY;
    }

    return { x: snappedX, y: snappedY };
  };

  // Draw guide lines on overlay canvas
  const drawGuides = () => {
    const canvas = guidesCanvasRef.current;
    const mainCanvas = canvasRef.current;
    if (!canvas || !mainCanvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Match overlay canvas size to main canvas
    canvas.width = mainCanvas.width;
    canvas.height = mainCanvas.height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw grid if enabled (independent of smart guides)
    if (guides.showGrid && guides.gridSize) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);

      for (let x = 0; x <= imageSize.width; x += guides.gridSize) {
        const canvasX = imageToCanvas(x, 0).x;
        if (canvasX >= 0 && canvasX <= canvas.width) {
          ctx.beginPath();
          ctx.moveTo(canvasX, 0);
          ctx.lineTo(canvasX, canvas.height);
          ctx.stroke();
        }
      }

      for (let y = 0; y <= imageSize.height; y += guides.gridSize) {
        const canvasY = imageToCanvas(0, y).y;
        if (canvasY >= 0 && canvasY <= canvas.height) {
          ctx.beginPath();
          ctx.moveTo(0, canvasY);
          ctx.lineTo(canvas.width, canvasY);
          ctx.stroke();
        }
      }
    }

    // Only draw smart guides if they are enabled
    if (!guides.enabled) return;

    const defaultGuides = getDefaultGuides();

    // Set guide line style
    ctx.strokeStyle = 'rgba(0, 150, 255, 0.8)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    // Draw vertical guides
    defaultGuides.x.forEach(x => {
      const canvasX = imageToCanvas(x, 0).x;
      if (canvasX >= 0 && canvasX <= canvas.width) {
        ctx.beginPath();
        ctx.moveTo(canvasX, 0);
        ctx.lineTo(canvasX, canvas.height);
        ctx.stroke();
      }
    });

    // Draw horizontal guides
    defaultGuides.y.forEach(y => {
      const canvasY = imageToCanvas(0, y).y;
      if (canvasY >= 0 && canvasY <= canvas.height) {
        ctx.beginPath();
        ctx.moveTo(0, canvasY);
        ctx.lineTo(canvas.width, canvasY);
        ctx.stroke();
      }
    });

    // Draw temporary guide lines during drag
    if (guideLines.temporary) {
      ctx.strokeStyle = 'rgba(255, 100, 100, 0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);

      if (guideLines.temporary.x !== undefined) {
        const canvasX = imageToCanvas(guideLines.temporary.x, 0).x;
        ctx.beginPath();
        ctx.moveTo(canvasX, 0);
        ctx.lineTo(canvasX, canvas.height);
        ctx.stroke();
      }

      if (guideLines.temporary.y !== undefined) {
        const canvasY = imageToCanvas(0, guideLines.temporary.y).y;
        ctx.beginPath();
        ctx.moveTo(0, canvasY);
        ctx.lineTo(canvas.width, canvasY);
        ctx.stroke();
      }

      // Draw distance indicator
      if (guideLines.temporary.showDistance && guideLines.temporary.distance !== undefined) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        ctx.fillRect(dragPosition.x + 10, dragPosition.y - 20, 60, 20);
        ctx.fillStyle = 'white';
        ctx.font = '12px monospace';
        ctx.fillText(`${Math.round(guideLines.temporary.distance)}px`, dragPosition.x + 15, dragPosition.y - 8);
      }
    }
  };

  // Update guides when canvas changes
  useEffect(() => {
    drawGuides();
  }, [guides, scale, translateX, translateY, imageSize, guideLines, dragPosition]);

  // Handle object dragging for smart snapping
  const handleDragStart = (e: MouseEvent) => {
    setIsDraggingObject(true);
    setDragPosition({ x: e.clientX, y: e.clientY });
  };

  const handleDragMove = (e: MouseEvent) => {
    if (!isDraggingObject) return;
    
    setDragPosition({ x: e.clientX, y: e.clientY });

    if (guides.enabled && guides.magneticAlignment) {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const canvasX = e.clientX - rect.left;
      const canvasY = e.clientY - rect.top;

      const { snapX, snapY } = findNearestGuides(canvasX, canvasY, guides.snapDistance);

      setGuideLines(prev => ({
        ...prev,
        temporary: {
          x: snapX,
          y: snapY,
          showDistance: guides.showDistances,
          distance: snapX !== undefined || snapY !== undefined ? 
            Math.sqrt(Math.pow(canvasX - (snapX ? imageToCanvas(snapX, 0).x : canvasX), 2) + 
                     Math.pow(canvasY - (snapY ? imageToCanvas(0, snapY).y : canvasY), 2)) : undefined
        }
      }));
    }
  };

  const handleDragEnd = () => {
    setIsDraggingObject(false);
    setGuideLines(prev => ({ ...prev, temporary: undefined }));
  };

  // Alignment functions (for future implementation)
  const alignObjects = (alignment: string) => {
    // This would be implemented to align selected objects
    console.log('Aligning objects:', alignment);
  };

  return (
    <>
      {/* Overlay canvas for guides */}
      <canvas
        ref={guidesCanvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ zIndex: 10 }}
      />
    </>
  );
};

export default SmartGuidesComponent; 