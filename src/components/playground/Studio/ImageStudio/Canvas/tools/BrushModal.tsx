import React, { useRef, useState } from 'react';
import { Brush, Save, RefreshCw, X, ChevronDown, ChevronRight, Palette, Zap, Sparkles, Layers, Settings, ExternalLink } from 'lucide-react';
import { AdvancedBrushSettings } from './types';

interface BrushModalProps {
  isVisible: boolean;
  position: { x: number; y: number };
  zIndex: number;
  isDragging: boolean;
  brushSettings: AdvancedBrushSettings;
  onPositionChange: (position: { x: number; y: number }) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onBrushSettingsChange: (settings: AdvancedBrushSettings) => void;
  onSave: () => void;
  onReset: () => void;
  onClose: () => void;
  onBringToFront: () => void;
  isOnTop: boolean;
  onHover?: (isHovering: boolean) => void;
}

const BrushModal: React.FC<BrushModalProps> = ({
  isVisible,
  position,
  zIndex,
  isDragging,
  brushSettings,
  onPositionChange,
  onDragStart,
  onDragEnd,
  onBrushSettingsChange,
  onSave,
  onReset,
  onClose,
  onBringToFront,
  isOnTop,
  onHover
}) => {
  const [openSettingModals, setOpenSettingModals] = useState<string[]>([]);
  const [modalPositions, setModalPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [draggingModal, setDraggingModal] = useState<string | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  // Check if brush settings have been changed from defaults
  const hasChanges = () => {
    return brushSettings.size !== 20 ||
           brushSettings.hardness !== 100 ||
           brushSettings.opacity !== 100;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    onBringToFront();
    onDragStart();
    
    const panelElement = e.currentTarget.closest('[style*="left:"]') as HTMLElement;
    if (!panelElement) {
      return;
    }
    
    const rect = panelElement.getBoundingClientRect();
    
    dragOffsetRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const panelWidth = 280;
    const panelHeight = 400;
    
    const centerX = (viewportWidth - panelWidth) / 2;
    const centerY = (viewportHeight - panelHeight) / 2;
    
    onPositionChange({ x: centerX, y: centerY });
  };

  // Global mouse events for dragging
  React.useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      
      const newX = e.clientX - dragOffsetRef.current.x;
      const newY = e.clientY - dragOffsetRef.current.y;
      
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const panelWidth = 280;
      const panelHeight = 400;
      
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

  if (!isVisible) return null;

  return (
    <>
      <div
        className="absolute pointer-events-auto"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
          transform: position.y === 0 ? 'translateY(50vh) translateY(-50%)' : 'none',
          zIndex: zIndex
        }}
      >
        <div 
          className={`bg-black/90 border rounded-lg w-70 shadow-2xl transition-all duration-200 brush-modal-ui ${
            isDragging ? 'cursor-grabbing' : ''
          } ${
            isOnTop 
              ? 'border-white/40' 
              : 'border-white/20'
          }`}
          data-brush-panel="true"
          data-ui-element="true"
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
            onDoubleClick={handleDoubleClick}
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
              <h3 className="text-white text-sm font-medium">Brush Settings</h3>
            </div>
            <div className="flex items-center gap-1">
              {/* Save Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSave();
                }}
                className={`p-1.5 rounded transition-colors ${
                  hasChanges()
                    ? 'text-blue-400 hover:text-blue-300 hover:bg-blue-400/10'
                    : 'text-white/30 cursor-not-allowed'
                }`}
                disabled={!hasChanges()}
                title="Save current brush settings"
              >
                <Save size={14} />
              </button>
              
              {/* Reset Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onReset();
                }}
                className={`p-1.5 rounded transition-colors ${
                  hasChanges()
                    ? 'text-orange-400 hover:text-orange-300 hover:bg-orange-400/10'
                    : 'text-white/30 cursor-not-allowed'
                }`}
                disabled={!hasChanges()}
                title="Reset to default settings"
              >
                <RefreshCw size={14} />
              </button>
              
              {/* Close Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenSettingModals([]); // Close all child modals
                  setModalPositions({}); // Clear all modal positions
                  onClose();
                }}
                className="p-1.5 text-white/60 hover:text-white hover:bg-white/10 rounded transition-colors"
                title="Close brush settings"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Brush Preview */}
          <div className="p-4 pb-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-white/80 text-xs font-medium">Brush Preview</span>
              <span className="text-white/60 text-xs">{brushSettings.size}px</span>
            </div>
            <div className="bg-white/10 rounded h-16 flex items-center justify-center">
              <div className="relative">
                {/* Brush preview circle */}
                <div 
                  className="border border-white/40"
                  style={{
                    width: `${Math.min(brushSettings.size * 0.5, 32)}px`,
                    height: `${Math.min(brushSettings.size * 0.5, 32)}px`,
                    borderRadius: brushSettings.shape?.roundness !== undefined ? 
                      `${50 * (brushSettings.shape.roundness / 100)}%` : '50%',
                    backgroundColor: brushSettings.hardness >= 100 ? brushSettings.color : 'transparent',
                    opacity: brushSettings.opacity / 100,
                    background: brushSettings.hardness < 100 ? 
                      `radial-gradient(circle, ${brushSettings.color} 0%, ${brushSettings.color} ${brushSettings.hardness}%, transparent 100%)` :
                      brushSettings.color,
                    transform: brushSettings.shape?.angle ? `rotate(${brushSettings.shape.angle}deg)` : 'none'
                  }}
                />
                {/* Inner hardness indicator for soft brushes */}
                {brushSettings.hardness < 100 && (
                  <div
                    className="absolute top-1/2 left-1/2 border border-white/40"
                    style={{
                      width: `${Math.max(2, Math.min(brushSettings.size * 0.5, 32) * brushSettings.hardness / 100)}px`,
                      height: `${Math.max(2, Math.min(brushSettings.size * 0.5, 32) * brushSettings.hardness / 100)}px`,
                      borderRadius: '50%',
                      transform: 'translate(-50%, -50%)',
                      backgroundColor: brushSettings.color,
                      opacity: brushSettings.opacity / 100
                    }}
                  />
                )}
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="px-4 pb-4 space-y-3 max-h-80 overflow-y-auto">
            <PhotoshopBrushPanel
            brushSettings={brushSettings}
            onBrushSettingsChange={onBrushSettingsChange}
            onOpenSettingModal={(modalType) => {
              setOpenSettingModals(prev => {
                if (!prev.includes(modalType)) {
                  // Set initial position for new modal
                  const modalIndex = prev.length;
                  setModalPositions(prevPositions => ({
                    ...prevPositions,
                    [modalType]: {
                      x: position.x + 320 + (modalIndex * 20),
                      y: position.y + (modalIndex * 20)
                    }
                  }));
                  return [...prev, modalType];
                }
                return prev;
              });
            }}
          />
          </div>
        </div>
      </div>

      {/* Custom Slider Styles */}
      <style jsx>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: white;
          cursor: pointer;
          border: 2px solid #374151;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
        
        .slider::-webkit-slider-thumb:hover {
          background: #f3f4f6;
          transform: scale(1.1);
        }
        
        .slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          background: white;
          cursor: pointer;
          border: 2px solid #374151;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
        
        .slider::-moz-range-thumb:hover {
          background: #f3f4f6;
          transform: scale(1.1);
        }
      `}</style>

      {/* Separate Setting Modals */}
      {openSettingModals.map((modalType, index) => {
        const modalPosition = modalPositions[modalType] || {
          x: position.x + 320 + (index * 20),
          y: position.y + (index * 20)
        };
        
        return (
          <BrushSettingModal
            key={modalType}
            type={modalType}
            position={modalPosition}
            zIndex={zIndex + 1 + index}
            brushSettings={brushSettings}
            onBrushSettingsChange={onBrushSettingsChange}
            onClose={() => {
              setOpenSettingModals(prev => prev.filter(modal => modal !== modalType));
              setModalPositions(prev => {
                const newPositions = { ...prev };
                delete newPositions[modalType];
                return newPositions;
              });
            }}
            onPositionChange={(newPosition) => {
              setModalPositions(prev => ({
                ...prev,
                [modalType]: newPosition
              }));
            }}
            onDragStart={() => {
              setDraggingModal(modalType);
            }}
            onDragEnd={() => {
              setDraggingModal(null);
            }}
          />
        );
      })}
    </>
  );
};

// Photoshop-style Brush Panel Component
interface BrushSettingModalProps {
  type: string;
  position: { x: number; y: number };
  zIndex: number;
  brushSettings: AdvancedBrushSettings;
  onBrushSettingsChange: (settings: AdvancedBrushSettings) => void;
  onClose: () => void;
  onPositionChange: (position: { x: number; y: number }) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

const BrushSettingModal: React.FC<BrushSettingModalProps> = ({
  type,
  position,
  zIndex,
  brushSettings,
  onBrushSettingsChange,
  onClose,
  onPositionChange,
  onDragStart,
  onDragEnd
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget || (e.target as HTMLElement).closest('.modal-header')) {
      const rect = e.currentTarget.getBoundingClientRect();
      dragOffsetRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };
      setIsDragging(true);
      onDragStart();
    }
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;
    onPositionChange({
      x: e.clientX - dragOffsetRef.current.x,
      y: e.clientY - dragOffsetRef.current.y
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    onDragEnd();
  };

  React.useEffect(() => {
    if (!isDragging) return;

    const handleGlobalMouseMove = (e: MouseEvent) => handleMouseMove(e);
    const handleGlobalMouseUp = () => handleMouseUp();

    document.addEventListener('mousemove', handleGlobalMouseMove);
    document.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging]);
  const renderSlider = (
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (value: number) => void,
    unit: string = '%',
    color: string = '#3b82f6'
  ) => (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <label className="text-white/80 text-xs font-medium">{label}</label>
        <span className="text-white/60 text-xs font-mono">{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer slider"
        style={{
          background: `linear-gradient(to right, ${color} 0%, ${color} ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.2) ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.2) 100%)`
        }}
      />
    </div>
  );

  const getModalTitle = () => {
    switch (type) {
      case 'brushTip': return 'Brush Tip Shape';
      case 'shapeDynamics': return 'Shape Dynamics';
      case 'scattering': return 'Scattering';
      case 'transfer': return 'Transfer';
      case 'advanced': return 'Advanced Settings';
      default: return 'Brush Settings';
    }
  };

  const getModalIcon = () => {
    switch (type) {
      case 'brushTip': return <Brush size={16} />;
      case 'shapeDynamics': return <Zap size={16} />;
      case 'scattering': return <Sparkles size={16} />;
      case 'transfer': return <Layers size={16} />;
      case 'advanced': return <Settings size={16} />;
      default: return <Brush size={16} />;
    }
  };

  const renderContent = () => {
    switch (type) {
      case 'brushTip':
        return (
          <div className="space-y-3">
            {/* Brush Type Selector */}
            <div>
              <label className="text-white/80 text-xs font-medium mb-2 block">Brush Type</label>
              <div className="grid grid-cols-2 gap-1">
                {[
                  { value: 'soft_round', label: 'Soft Round' },
                  { value: 'hard_round', label: 'Hard Round' },
                  { value: 'texture', label: 'Texture' },
                  { value: 'watercolor', label: 'Watercolor' }
                ].map((brushType) => (
                  <button
                    key={brushType.value}
                    onClick={() => onBrushSettingsChange({
                      ...brushSettings,
                      type: brushType.value as any
                    })}
                    className={`p-2 text-xs rounded transition-colors ${
                      brushSettings.type === brushType.value
                        ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40'
                        : 'bg-white/5 text-white/70 border border-white/10 hover:bg-white/10'
                    }`}
                  >
                    {brushType.label}
                  </button>
                ))}
              </div>
            </div>

            {renderSlider(
              'Size',
              brushSettings.size,
              1,
              200,
              (value) => onBrushSettingsChange({ ...brushSettings, size: value }),
              'px',
              '#3b82f6'
            )}

            {renderSlider(
              'Hardness',
              brushSettings.hardness,
              0,
              100,
              (value) => onBrushSettingsChange({ ...brushSettings, hardness: value }),
              '%',
              '#10b981'
            )}

            {renderSlider(
              'Spacing',
              brushSettings.spacing || 25,
              1,
              200,
              (value) => onBrushSettingsChange({ ...brushSettings, spacing: value }),
              '%',
              '#8b5cf6'
            )}

            {/* Shape Controls */}
            <div className="grid grid-cols-2 gap-2">
              {renderSlider(
                'Angle',
                brushSettings.shape?.angle || 0,
                0,
                360,
                (value) => onBrushSettingsChange({ 
                  ...brushSettings, 
                  shape: { ...brushSettings.shape, angle: value }
                }),
                '°',
                '#f59e0b'
              )}

              {renderSlider(
                'Roundness',
                brushSettings.shape?.roundness || 100,
                1,
                100,
                (value) => onBrushSettingsChange({ 
                  ...brushSettings, 
                  shape: { ...brushSettings.shape, roundness: value }
                }),
                '%',
                '#ef4444'
              )}
            </div>
          </div>
        );

      case 'shapeDynamics':
        return (
          <div className="space-y-3">
            {renderSlider(
              'Size Jitter',
              brushSettings.sizeJitter || 0,
              0,
              100,
              (value) => onBrushSettingsChange({ ...brushSettings, sizeJitter: value }),
              '%',
              '#06b6d4'
            )}

            {renderSlider(
              'Angle Jitter',
              brushSettings.angleJitter || 0,
              0,
              100,
              (value) => onBrushSettingsChange({ ...brushSettings, angleJitter: value }),
              '%',
              '#84cc16'
            )}

            {/* Pressure Sensitivity */}
            <div className="space-y-2">
              <label className="text-white/80 text-xs font-medium">Pressure Sensitivity</label>
              <div className="space-y-1">
                {[
                  { key: 'sizePressure', label: 'Size' },
                  { key: 'opacityPressure', label: 'Opacity' },
                  { key: 'flowPressure', label: 'Flow' }
                ].map((option) => (
                  <label key={option.key} className="flex items-center gap-2 text-xs text-white/70">
                    <input
                      type="checkbox"
                      checked={brushSettings.dynamics?.[option.key as keyof typeof brushSettings.dynamics] || false}
                      onChange={(e) => onBrushSettingsChange({
                        ...brushSettings,
                        dynamics: {
                          ...brushSettings.dynamics,
                          [option.key]: e.target.checked
                        }
                      })}
                      className="w-3 h-3 rounded border border-white/30 bg-white/10"
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        );

      case 'scattering':
        return (
          <div className="space-y-3">
            {renderSlider(
              'Scatter',
              brushSettings.scattering || 0,
              0,
              500,
              (value) => onBrushSettingsChange({ ...brushSettings, scattering: value }),
              '%',
              '#ec4899'
            )}
          </div>
        );

      case 'transfer':
        return (
          <div className="space-y-3">
            {renderSlider(
              'Opacity',
              brushSettings.opacity,
              1,
              100,
              (value) => onBrushSettingsChange({ ...brushSettings, opacity: value }),
              '%',
              '#f59e0b'
            )}

            {renderSlider(
              'Flow',
              brushSettings.flow,
              1,
              100,
              (value) => onBrushSettingsChange({ ...brushSettings, flow: value }),
              '%',
              '#06b6d4'
            )}

            {renderSlider(
              'Opacity Jitter',
              brushSettings.opacityJitter || 0,
              0,
              100,
              (value) => onBrushSettingsChange({ ...brushSettings, opacityJitter: value }),
              '%',
              '#8b5cf6'
            )}
          </div>
        );

      case 'advanced':
        return (
          <div className="space-y-3">
            {/* Blend Mode */}
            <div>
              <label className="text-white/80 text-xs font-medium mb-2 block">Blend Mode</label>
              <select
                value={brushSettings.blendMode || 'normal'}
                onChange={(e) => onBrushSettingsChange({
                  ...brushSettings,
                  blendMode: e.target.value as any
                })}
                className="w-full p-2 bg-white/10 border border-white/20 rounded text-white/90 text-xs"
              >
                <option value="normal">Normal</option>
                <option value="multiply">Multiply</option>
                <option value="screen">Screen</option>
                <option value="overlay">Overlay</option>
                <option value="soft-light">Soft Light</option>
                <option value="hard-light">Hard Light</option>
                <option value="color-dodge">Color Dodge</option>
              </select>
            </div>

            {renderSlider(
              'Smoothing',
              brushSettings.smoothing || 0,
              0,
              100,
              (value) => onBrushSettingsChange({ ...brushSettings, smoothing: value }),
              '%',
              '#10b981'
            )}

            {brushSettings.type === 'watercolor' && renderSlider(
              'Wetness',
              brushSettings.wetness || 50,
              0,
              100,
              (value) => onBrushSettingsChange({ ...brushSettings, wetness: value }),
              '%',
              '#06b6d4'
            )}
          </div>
        );

      default:
        return <div>Settings not available</div>;
    }
  };

  return (
    <div
      className="absolute bg-black/90 border border-white/40 rounded-lg shadow-2xl transition-all duration-200"
      style={{
        left: position.x,
        top: position.y,
        zIndex: zIndex,
        width: '280px'
      }}
      data-brush-panel="true"
      data-ui-element="true"
      onMouseDown={handleMouseDown}
    >
      {/* Header */}
      <div className="modal-header px-4 py-3 border-b border-white/10 flex items-center justify-between select-none cursor-move">
        <div className="flex items-center gap-2">
          <div className="text-white/60">{getModalIcon()}</div>
          <h3 className="text-white text-sm font-medium">{getModalTitle()}</h3>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded transition-colors text-white/40 hover:text-white/80 hover:bg-white/10"
          title="Close"
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="px-4 pb-4 space-y-3">
        {renderContent()}
      </div>

      <style jsx>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: white;
          cursor: pointer;
          border: 2px solid rgba(255, 255, 255, 0.3);
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
        .slider::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: white;
          cursor: pointer;
          border: 2px solid rgba(255, 255, 255, 0.3);
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
      `}</style>
    </div>
  );
};

interface PhotoshopBrushPanelProps {
  brushSettings: AdvancedBrushSettings;
  onBrushSettingsChange: (settings: AdvancedBrushSettings) => void;
  onOpenSettingModal: (modalType: string) => void;
}

const PhotoshopBrushPanel: React.FC<PhotoshopBrushPanelProps> = ({
  brushSettings,
  onBrushSettingsChange,
  onOpenSettingModal
}) => {

  const renderSlider = (
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (value: number) => void,
    unit: string = '%',
    color: string = '#3b82f6'
  ) => (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <label className="text-white/80 text-xs font-medium">{label}</label>
        <span className="text-white/60 text-xs font-mono">{value}{unit}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value))}
        className="w-full h-1.5 bg-white/20 rounded-full appearance-none cursor-pointer slider"
        style={{
          background: `linear-gradient(to right, ${color} 0%, ${color} ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.2) ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.2) 100%)`
        }}
      />
    </div>
  );

  const renderSectionHeader = (
    title: string,
    icon: React.ReactNode,
    modalType: string,
    hasSettings: boolean = true
  ) => (
    <div 
      className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${
        hasSettings ? 'hover:bg-white/5' : 'bg-white/5'
      }`}
      onClick={() => hasSettings && onOpenSettingModal(modalType)}
    >
      <div className="flex items-center gap-2">
        <div className="text-white/60">{icon}</div>
        <span className="text-white/90 text-sm font-medium">{title}</span>
      </div>
      {hasSettings && (
        <div className="text-white/40">
          <ExternalLink size={14} />
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-2">

      {/* Brush Tip Shape */}
      <div className="bg-white/5 rounded-lg border border-white/10">
        {renderSectionHeader('Brush Tip Shape', <Brush size={14} />, 'brushTip')}
      </div>

      {/* Shape Dynamics */}
      <div className="bg-white/5 rounded-lg border border-white/10">
        {renderSectionHeader('Shape Dynamics', <Zap size={14} />, 'shapeDynamics')}
      </div>

      {/* Scattering */}
      <div className="bg-white/5 rounded-lg border border-white/10">
        {renderSectionHeader('Scattering', <Sparkles size={14} />, 'scattering')}
      </div>

      {/* Transfer (Opacity & Flow) */}
      <div className="bg-white/5 rounded-lg border border-white/10">
        {renderSectionHeader('Transfer', <Layers size={14} />, 'transfer')}
      </div>

      {/* Advanced Settings */}
      <div className="bg-white/5 rounded-lg border border-white/10">
        {renderSectionHeader('Advanced', <Settings size={14} />, 'advanced')}
      </div>
    </div>
  )
};

export default BrushModal;
