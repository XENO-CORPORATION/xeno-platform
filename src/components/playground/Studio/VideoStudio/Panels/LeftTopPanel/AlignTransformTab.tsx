import React, { useState, useRef, useEffect } from 'react';
import { Grid, AlignLeft, AlignCenter, AlignRight, AlignHorizontalSpaceAround, AlignVerticalSpaceAround, FlipHorizontal, FlipVertical, RotateCcw, ChevronDown } from 'lucide-react';

interface AlignTransformTabProps {
  selectedClipId?: string;
  clipName?: string;
  onAlign?: (alignment: string) => void;
  onDistribute?: (distribution: string) => void;
  onFlip?: (direction: 'horizontal' | 'vertical') => void;
}

const AlignTransformTab: React.FC<AlignTransformTabProps> = ({
  selectedClipId,
  clipName = 'No Clip Selected',
  onAlign,
  onDistribute,
  onFlip
}) => {
  const [gridEnabled, setGridEnabled] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [gridSize, setGridSize] = useState(20);
  const [alignTo, setAlignTo] = useState('canvas');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['horizontal', 'vertical', 'distribute', 'flip', 'rotate', 'grid'])
  );

  // Drag state for grid size input
  const [isDragging, setIsDragging] = useState(false);
  const dragStartX = useRef(0);
  const dragStartValue = useRef(0);
  const dragMin = useRef(1);
  const dragMax = useRef(100);

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  const handleAlign = (alignment: string) => {
    onAlign?.(alignment);
  };

  const handleDistribute = (distribution: string) => {
    onDistribute?.(distribution);
  };

  const handleFlip = (direction: 'horizontal' | 'vertical') => {
    onFlip?.(direction);
  };

  // Handle drag-to-adjust for grid size
  const handleInputMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left mouse button
    e.preventDefault();
    setIsDragging(true);
    dragStartX.current = e.clientX;
    dragStartValue.current = gridSize;
    dragMin.current = 1;
    dragMax.current = 100;
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - dragStartX.current;
      const sensitivity = 0.5;
      let newValue = dragStartValue.current + (deltaX * sensitivity);

      // Apply constraints
      newValue = Math.max(dragMin.current, Math.min(dragMax.current, newValue));
      newValue = Math.round(newValue);

      setGridSize(newValue);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const renderSection = (title: string, sectionId: string, children: React.ReactNode) => {
    const isExpanded = expandedSections.has(sectionId);

    return (
      <div className="border-t border-white/10">
        <button
          onClick={() => toggleSection(sectionId)}
          className="w-full flex items-center gap-2 px-3 py-2 bg-black/50 hover:bg-white/10 transition-all"
        >
          <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}>
            <ChevronDown className="w-3 h-3 text-white/60" />
          </div>
          <span className="text-[10px] uppercase tracking-wider font-semibold text-white/90">
            {title}
          </span>
        </button>
        {isExpanded && (
          <div className="bg-black/40 p-3">
            {children}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-black/40">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-white/10 bg-black/50">
        <div className="text-[11px] font-medium text-white truncate">{clipName}</div>
        <div className="text-[10px] text-white/60 mt-0.5">Align & Transform</div>
      </div>

      {/* Alignment Tools */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {/* Horizontal Alignment */}
        {renderSection('HORIZONTAL ALIGNMENT', 'horizontal', (
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => handleAlign('left')}
              className="group flex flex-col items-center justify-center gap-1.5 px-2 py-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded transition-all"
              title="Align Left"
            >
              <AlignLeft className="w-4 h-4 text-white/60 group-hover:text-white transition-colors" />
              <span className="text-[10px] text-white/70 group-hover:text-white transition-colors">Left</span>
            </button>
            <button
              onClick={() => handleAlign('center')}
              className="group flex flex-col items-center justify-center gap-1.5 px-2 py-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded transition-all"
              title="Align Center"
            >
              <AlignCenter className="w-4 h-4 text-white/60 group-hover:text-white transition-colors" />
              <span className="text-[10px] text-white/70 group-hover:text-white transition-colors">Center</span>
            </button>
            <button
              onClick={() => handleAlign('right')}
              className="group flex flex-col items-center justify-center gap-1.5 px-2 py-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded transition-all"
              title="Align Right"
            >
              <AlignRight className="w-4 h-4 text-white/60 group-hover:text-white transition-colors" />
              <span className="text-[10px] text-white/70 group-hover:text-white transition-colors">Right</span>
            </button>
          </div>
        ))}

        {/* Vertical Alignment */}
        {renderSection('VERTICAL ALIGNMENT', 'vertical', (
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => handleAlign('top')}
              className="group flex flex-col items-center justify-center gap-1.5 px-2 py-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded transition-all"
              title="Align Top"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16">
                <line x1="2" y1="3" x2="14" y2="3" stroke="currentColor" strokeWidth="2" className="text-white/60 group-hover:text-white transition-colors" />
                <rect x="6" y="5" width="4" height="6" fill="currentColor" className="text-white/60 group-hover:text-white transition-colors" opacity="0.5" />
              </svg>
              <span className="text-[10px] text-white/70 group-hover:text-white transition-colors">Top</span>
            </button>
            <button
              onClick={() => handleAlign('middle')}
              className="group flex flex-col items-center justify-center gap-1.5 px-2 py-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded transition-all"
              title="Align Middle"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16">
                <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="2" className="text-white/60 group-hover:text-white transition-colors" />
                <rect x="6" y="5" width="4" height="6" fill="currentColor" className="text-white/60 group-hover:text-white transition-colors" opacity="0.5" />
              </svg>
              <span className="text-[10px] text-white/70 group-hover:text-white transition-colors">Middle</span>
            </button>
            <button
              onClick={() => handleAlign('bottom')}
              className="group flex flex-col items-center justify-center gap-1.5 px-2 py-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded transition-all"
              title="Align Bottom"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16">
                <line x1="2" y1="13" x2="14" y2="13" stroke="currentColor" strokeWidth="2" className="text-white/60 group-hover:text-white transition-colors" />
                <rect x="6" y="5" width="4" height="6" fill="currentColor" className="text-white/60 group-hover:text-white transition-colors" opacity="0.5" />
              </svg>
              <span className="text-[10px] text-white/70 group-hover:text-white transition-colors">Bottom</span>
            </button>
          </div>
        ))}

        {/* Distribution */}
        {renderSection('DISTRIBUTION', 'distribute', (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleDistribute('horizontal')}
              className="group flex flex-col items-center justify-center gap-1.5 px-2 py-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded transition-all"
              title="Distribute Horizontally"
            >
              <AlignHorizontalSpaceAround className="w-4 h-4 text-white/60 group-hover:text-white transition-colors" />
              <span className="text-[10px] text-white/70 group-hover:text-white transition-colors">Horizontal</span>
            </button>
            <button
              onClick={() => handleDistribute('vertical')}
              className="group flex flex-col items-center justify-center gap-1.5 px-2 py-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded transition-all"
              title="Distribute Vertically"
            >
              <AlignVerticalSpaceAround className="w-4 h-4 text-white/60 group-hover:text-white transition-colors" />
              <span className="text-[10px] text-white/70 group-hover:text-white transition-colors">Vertical</span>
            </button>
          </div>
        ))}

        {/* Flip */}
        {renderSection('FLIP', 'flip', (
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleFlip('horizontal')}
              className="group flex flex-col items-center justify-center gap-1.5 px-2 py-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded transition-all"
              title="Flip Horizontal"
            >
              <FlipHorizontal className="w-4 h-4 text-white/60 group-hover:text-white transition-colors" />
              <span className="text-[10px] text-white/70 group-hover:text-white transition-colors">Horizontal</span>
            </button>
            <button
              onClick={() => handleFlip('vertical')}
              className="group flex flex-col items-center justify-center gap-1.5 px-2 py-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded transition-all"
              title="Flip Vertical"
            >
              <FlipVertical className="w-4 h-4 text-white/60 group-hover:text-white transition-colors" />
              <span className="text-[10px] text-white/70 group-hover:text-white transition-colors">Vertical</span>
            </button>
          </div>
        ))}

        {/* Quick Rotations */}
        {renderSection('QUICK ROTATE', 'rotate', (
          <div className="grid grid-cols-4 gap-2">
            <button
              onClick={() => handleAlign('rotate-90-ccw')}
              className="group flex flex-col items-center justify-center gap-1 px-2 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded transition-all"
              title="Rotate 90° CCW"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16">
                <path d="M8 3 L5 6 L8 9" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/60 group-hover:text-white transition-colors" />
                <path d="M8 6 A4 4 0 0 1 12 10" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/60 group-hover:text-white transition-colors" />
              </svg>
              <span className="text-[9px] text-white/70 group-hover:text-white transition-colors">90° CCW</span>
            </button>
            <button
              onClick={() => handleAlign('rotate-180')}
              className="group flex flex-col items-center justify-center gap-1 px-2 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded transition-all"
              title="Rotate 180°"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16">
                <circle cx="8" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/60 group-hover:text-white transition-colors" />
                <path d="M8 4 L10 2 M8 4 L6 2" stroke="currentColor" strokeWidth="1.5" className="text-white/60 group-hover:text-white transition-colors" />
              </svg>
              <span className="text-[9px] text-white/70 group-hover:text-white transition-colors">180°</span>
            </button>
            <button
              onClick={() => handleAlign('rotate-90-cw')}
              className="group flex flex-col items-center justify-center gap-1 px-2 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded transition-all"
              title="Rotate 90° CW"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16">
                <path d="M8 3 L11 6 L8 9" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/60 group-hover:text-white transition-colors" />
                <path d="M8 6 A4 4 0 0 0 4 10" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/60 group-hover:text-white transition-colors" />
              </svg>
              <span className="text-[9px] text-white/70 group-hover:text-white transition-colors">90° CW</span>
            </button>
            <button
              onClick={() => handleAlign('rotate-360')}
              className="group flex flex-col items-center justify-center gap-1 px-2 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded transition-all"
              title="Reset Rotation"
            >
              <RotateCcw className="w-4 h-4 text-white/60 group-hover:text-white transition-colors" />
              <span className="text-[9px] text-white/70 group-hover:text-white transition-colors">Reset</span>
            </button>
          </div>
        ))}

        {/* Grid Settings */}
        {renderSection('GRID & SNAPPING', 'grid', (
          <div className="space-y-3">
            {/* Show Grid */}
            <div className="flex items-center justify-between px-2 py-1.5 hover:bg-white/5 rounded transition-colors">
              <label className="text-[11px] text-white/70 cursor-pointer">Show Grid</label>
              <button
                onClick={() => setGridEnabled(!gridEnabled)}
                className={`w-9 h-5 rounded-full transition-all ${
                  gridEnabled ? 'bg-blue-400' : 'bg-white/10'
                }`}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                    gridEnabled ? 'translate-x-[18px]' : 'translate-x-[2px]'
                  }`}
                />
              </button>
            </div>

            {/* Snap to Grid */}
            <div className="flex items-center justify-between px-2 py-1.5 hover:bg-white/5 rounded transition-colors">
              <label className="text-[11px] text-white/70 cursor-pointer">Snap to Grid</label>
              <button
                onClick={() => setSnapToGrid(!snapToGrid)}
                className={`w-9 h-5 rounded-full transition-all ${
                  snapToGrid ? 'bg-blue-400' : 'bg-white/10'
                }`}
              >
                <div
                  className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                    snapToGrid ? 'translate-x-[18px]' : 'translate-x-[2px]'
                  }`}
                />
              </button>
            </div>

            {/* Grid Size */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 px-2 py-1">
                <label className="text-[11px] font-normal text-white/70 flex-shrink-0">Grid Size</label>
                <div className="flex items-center gap-1 flex-1">
                  <input
                    type="number"
                    value={gridSize}
                    onChange={(e) => setGridSize(parseInt(e.target.value) || 20)}
                    onMouseDown={handleInputMouseDown}
                    className="w-full h-[20px] px-1.5 text-[11px] font-mono bg-white/5 border border-white/10 rounded text-white text-right
                             focus:outline-none focus:border-blue-400 focus:bg-white/10 hover:border-white/20 transition-colors cursor-ew-resize
                             [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    step={1}
                    min={1}
                    max={100}
                  />
                  <span className="text-[10px] text-white/40 w-[18px] text-left flex-shrink-0">px</span>
                </div>
              </div>
              <div className="px-2">
                <div className="relative h-2 bg-white/5 rounded border border-white/10">
                  <div
                    className="absolute inset-y-0 left-0 bg-blue-400 rounded transition-all"
                    style={{ width: `${gridSize}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Grid Preview */}
            <div className="mt-3 p-3 bg-white/5 border border-white/10 rounded">
              <div className="text-[10px] text-white/40 mb-2">Preview</div>
              <div
                className="w-full h-24 bg-black/20 rounded"
                style={{
                  backgroundImage: `
                    linear-gradient(to right, rgba(255,255,255,0.1) 1px, transparent 1px),
                    linear-gradient(to bottom, rgba(255,255,255,0.1) 1px, transparent 1px)
                  `,
                  backgroundSize: `${gridSize}px ${gridSize}px`,
                  opacity: gridEnabled ? 1 : 0.3
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Footer - Align To Selector */}
      <div className="px-3 py-2.5 border-t border-white/10 bg-black/50">
        <div className="flex items-center justify-between">
          <label className="text-[10px] uppercase tracking-wider font-semibold text-white/90">Align To</label>
          <select
            value={alignTo}
            onChange={(e) => setAlignTo(e.target.value)}
            className="h-[22px] px-2 text-[11px] bg-white/5 border border-white/10 rounded text-white
                     focus:outline-none focus:border-blue-400 cursor-pointer hover:border-white/20 transition-colors"
          >
            <option value="canvas">Canvas</option>
            <option value="selection">Selection</option>
            <option value="clip">Active Clip</option>
          </select>
        </div>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(0,0,0,0.3);
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255,255,255,0.1);
          border-radius: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255,255,255,0.2);
        }
      `}</style>
    </div>
  );
};

export default AlignTransformTab;
