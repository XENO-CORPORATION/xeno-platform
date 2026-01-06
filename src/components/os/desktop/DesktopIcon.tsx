import * as React from 'react';
import { DesktopIconData } from './Desktop';

interface DesktopIconProps {
  icon: DesktopIconData;
  isSelected: boolean;
  onSelect: (event?: React.MouseEvent) => void;
  onOpen?: () => void;
  onDragStart?: (event: React.MouseEvent) => void;
  isDragging?: boolean;
  gridSize?: number;
}

// Calculate appropriate top padding for different grid sizes
const getTopPadding = (gridSize: number) => {
  if (gridSize <= 60) return 1; // Small grid: 1px
  if (gridSize <= 80) return 3; // Medium grid: 3px
  return 6; // Large grid: 6px
};

const DesktopIcon: React.FC<DesktopIconProps> = ({
  icon,
  isSelected,
  onSelect,
  onOpen,
  onDragStart,
  isDragging = false,
  gridSize = 80
}) => {
  const [clickCount, setClickCount] = React.useState(0);
  const [isOpening, setIsOpening] = React.useState(false);
  const clickTimeoutRef = React.useRef<NodeJS.Timeout>();
  const dragTimeoutRef = React.useRef<NodeJS.Timeout>();

  // Cleanup timeouts on unmount
  React.useEffect(() => {
    return () => {
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
      }
      if (dragTimeoutRef.current) {
        clearTimeout(dragTimeoutRef.current);
      }
    };
  }, []);

  // Consolidated click/double-click and drag handlers
  const handleOverlayMouseDown = React.useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    // Start drag timeout - if mouse is held for 150ms, start dragging
    dragTimeoutRef.current = setTimeout(() => {
      if (onDragStart) {
        onDragStart(event);
      }
    }, 150);
  }, [onDragStart]);

  const handleOverlayMouseUp = React.useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    // Clear drag timeout
    if (dragTimeoutRef.current) {
      clearTimeout(dragTimeoutRef.current);
    }

    // Handle click/double-click
    setClickCount(prev => {
      const newCount = prev + 1;

      // Clear any existing timeout
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
      }

      if (newCount === 1) {
        // First click - select the icon
        onSelect(event);

        // Set timeout for double-click detection
        clickTimeoutRef.current = setTimeout(() => {
          setClickCount(0);
        }, 300); // 300ms window for double-click
      } else if (newCount === 2) {
        // Second click within time window - open the application
        setClickCount(0);

        if (onOpen && !isOpening) {
          setIsOpening(true);
          onOpen();

          // Reset opening state after animation
          setTimeout(() => {
            setIsOpening(false);
          }, 200);
        }
      }

      return newCount;
    });
  }, [onSelect, onOpen, isOpening]);



  return (
    <div
      className={`absolute flex flex-col items-center justify-start cursor-pointer select-none group ${
        isDragging ? 'pointer-events-none' : ''
      }`}
      style={{
        left: icon.position.x,
        top: icon.position.y,
        width: `${gridSize}px`,
        height: `${gridSize}px`
      }}

      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect(e);
        console.log('Icon context menu for:', icon.name);
      }}
    >
      {/* Grid Selection Rectangle - exactly matches dynamic grid cell */}
      {isSelected && (
        <div
          className="absolute border-2 border-blue-400 border-dashed rounded pointer-events-none"
          style={{
            top: `${-8}px`, // Offset back by 8px to align with grid cell boundary
            left: `${-8}px`, // Offset back by 8px to align with grid cell boundary
            width: `${gridSize}px`,
            height: `${gridSize}px`,
            backgroundColor: 'rgba(59, 130, 246, 0.08)',
            zIndex: 1,
            boxSizing: 'border-box'
          }}
        />
      )}

      {/* Clickable Overlay - covers entire grid square */}
      <div
        className="absolute inset-0 cursor-pointer z-20"
        onMouseDown={handleOverlayMouseDown}
        onMouseUp={handleOverlayMouseUp}
      />

      {/* Icon and Label Container - uses full grid space with built-in margins */}
      <div className="relative w-full h-full z-10">
        {/* Icon + Label Unit Container - move this to reposition entire unit */}
        <div
          className="absolute"
          style={{
            left: `${((gridSize - gridSize * 0.875) / 2 - 8)}px`, // Center the entire unit horizontally
            top: `${getTopPadding(gridSize)}px`, // Adaptive top padding per grid size
            width: `${gridSize * 0.875}px`, // Unit width (same as label)
            height: `${gridSize * 0.8}px` // Taller unit for better proportions
          }}
        >
          {/* Icon - positioned relative to unit container */}
          <div
            className="absolute flex items-center justify-center transition-all duration-150"
            style={{
              left: '50%', // Center horizontally within unit
              top: '0px', // At top of unit container
              width: `${gridSize * 0.5}px`, // 50% of grid size
              height: `${gridSize * 0.5}px`,
              transform: 'translateX(-50%)', // Center horizontally
              color: isSelected ? '#3b82f6' : '#9ca3af',
              opacity: isSelected ? 0.9 : 1
            }}
          >
            {icon.icon}
          </div>

          {/* Label - positioned relative to unit container */}
          <div
            className="absolute flex items-center justify-center transition-all duration-150"
            style={{
              left: '50%', // Center horizontally within unit
              top: `${gridSize * 0.52}px`, // Better vertical spacing within unit
              width: '100%', // Full width of unit container
              height: `${gridSize * 0.25}px`, // 25% of grid size
              transform: 'translateX(-50%)', // Center horizontally
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: `${gridSize * 0.0875}px`, // 8.75% of grid size
              fontWeight: isSelected ? '500' : '400',
              color: isSelected ? '#93c5fd' : 'rgba(255, 255, 255, 0.8)',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis'
            }}
            title={icon.name}
          >
            <span style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              width: '100%',
              textAlign: 'center'
            }}>
              {icon.name}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DesktopIcon;
