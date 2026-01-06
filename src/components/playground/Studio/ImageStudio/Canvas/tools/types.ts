export interface ImageAdjustments {
  brightness: number;      // 0-200 (100 = normal)
  contrast: number;        // 0-200 (100 = normal)
  saturation: number;      // 0-200 (100 = normal)
  hue: number;            // -180 to 180 (0 = normal)
  exposure: number;        // -100 to 100 (0 = normal)
  highlights: number;      // -100 to 100 (0 = normal)
  shadows: number;         // -100 to 100 (0 = normal)
  vibrance: number;        // -100 to 100 (0 = normal)
  warmth: number;          // -100 to 100 (0 = normal)
  tint: number;           // -100 to 100 (0 = normal)
}

export interface UpscaleModel {
  id: string;
  name: string;
  defaultScale: number;
  category: string;
}

export interface BrushSettings {
  size: number;           // 1-200px
  hardness: number;       // 0-100%
  opacity: number;        // 1-100%
  flow: number;          // 1-100%
  type: 'soft_round' | 'hard_round' | 'soft_square' | 'texture' | 'bristle' | 'chalk' | 'marker' | 'watercolor';
  color: string;          // Hex color code
} 

// NEW: Enhanced Layer System Types
export interface LayerEffects {
  dropShadow?: {
    enabled: boolean;
    x: number;
    y: number;
    blur: number;
    spread: number;
    color: string;
    opacity: number;
  };
  innerGlow?: {
    enabled: boolean;
    size: number;
    color: string;
    opacity: number;
    blend: 'normal' | 'screen' | 'multiply';
  };
  stroke?: {
    enabled: boolean;
    size: number;
    color: string;
    position: 'inside' | 'outside' | 'center';
    opacity: number;
  };
  blur?: {
    enabled: boolean;
    radius: number;
    type: 'gaussian' | 'motion' | 'radial';
    angle?: number; // for motion blur
  };
}

export interface LayerGroup {
  id: string;
  name: string;
  layers: string[]; // layer IDs
  collapsed: boolean;
  parent?: string; // for nested groups
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
}

export interface EnhancedLayer {
  id: string;
  name: string;
  type: 'raster' | 'text' | 'shape' | 'adjustment' | 'group' | 'smart';
  visible: boolean;
  opacity: number;
  canvas?: HTMLCanvasElement;
  position: { x: number; y: number };
  size?: { width: number; height: number };
  rotation?: number;
  blendMode: BlendMode;
  locked?: boolean;
  effects?: LayerEffects;
  mask?: HTMLCanvasElement;
  clippingMask?: boolean;
  adjustments?: ImageAdjustments; // per-layer adjustments
  parent?: string; // for layer hierarchy
}

export type BlendMode = 
  | 'normal' 
  | 'multiply' 
  | 'screen' 
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'color-dodge'
  | 'color-burn'
  | 'darken'
  | 'lighten'
  | 'difference'
  | 'exclusion';

// NEW: Selection System Types
export interface SelectionArea {
  id: string;
  type: 'rectangular' | 'elliptical' | 'lasso' | 'polygonal' | 'magic' | 'quick' | 'complex';
  points: Array<{ x: number; y: number }>;
  bounds: { x: number; y: number; width: number; height: number };
  feather: number;
  antiAlias: boolean;
  maskCanvas?: HTMLCanvasElement;
}

export interface Selection {
  areas: SelectionArea[];
  totalBounds: { x: number; y: number; width: number; height: number };
  feather: number;
  antiAlias: boolean;
}

export interface SelectionTool {
  type: 'rectangular' | 'elliptical' | 'lasso' | 'polygonal' | 'magic' | 'quick' | 'complex';
  tolerance?: number; // for magic wand
  contiguous?: boolean; // for magic wand
  sampleAllLayers?: boolean;
}

// NEW: Advanced Brush Engine Types
export interface AdvancedBrushSettings extends BrushSettings {
  spacing: number; // % of brush diameter
  angleJitter: number; // 0-100%
  sizeJitter: number; // 0-100%
  opacityJitter: number; // 0-100%
  scattering: number; // 0-500%
  wetness: number; // 0-100% for watercolor effect
  blendMode: BlendMode; // Blend mode for the brush
  texture?: {
    pattern?: string | ImageData;
    scale?: number;
    depth?: number;
    strength?: number;
  };
  dynamics?: {
    sizePressure?: boolean;
    opacityPressure?: boolean;
    flowPressure?: boolean;
    tiltAngle?: number;
    tiltElevation?: number;
  };
  smoothing: number; // 0-100%
  shape?: {
    angle?: number;
    roundness?: number;
    flipX?: boolean;
    flipY?: boolean;
  };
}

export interface BrushStroke {
  points: Array<{
    x: number;
    y: number;
    pressure?: number;
    tiltX?: number;
    tiltY?: number;
    timestamp: number;
  }>;
  brush: AdvancedBrushSettings;
}

// NEW: Text Tool Types
export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'bold' | '100' | '200' | '300' | '400' | '500' | '600' | '700' | '800' | '900';
  fontStyle: 'normal' | 'italic';
  textAlign: 'left' | 'center' | 'right' | 'justify';
  lineHeight: number;
  letterSpacing: number;
  textDecoration: 'none' | 'underline' | 'overline' | 'line-through';
  textTransform: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  color: string;
  backgroundColor?: string;
  textShadow?: {
    x: number;
    y: number;
    blur: number;
    color: string;
  };
  outline?: {
    width: number;
    color: string;
  };
  warpStyle?: 'none' | 'arc' | 'wave' | 'flag' | 'fish' | 'inflate' | 'squeeze';
  warpAmount?: number;
}

export interface TextLayer extends EnhancedLayer {
  type: 'text';
  text: string;
  style: TextStyle;
  boundingBox: { x: number; y: number; width: number; height: number };
  isEditing?: boolean;
}

// NEW: Shape Tool Types
export interface ShapeStyle {
  fill: boolean;
  fillColor: string;
  fillOpacity: number;
  stroke: boolean;
  strokeColor: string;
  strokeWidth: number;
  strokeOpacity: number;
  strokeDashArray?: number[];
  cornerRadius?: number;
}

export interface Shape {
  type: 'rectangle' | 'ellipse' | 'polygon' | 'star' | 'line' | 'arrow' | 'custom';
  points: Array<{ x: number; y: number }>;
  style: ShapeStyle;
  // Shape-specific properties
  sides?: number; // for polygon/star
  innerRadius?: number; // for star
  arrowHead?: 'none' | 'start' | 'end' | 'both';
}

export interface ShapeLayer extends EnhancedLayer {
  type: 'shape';
  shape: Shape;
}

// NEW: Transform Types
export interface Transform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  skewX: number;
  skewY: number;
  originX: number; // 0-1 (0 = left, 0.5 = center, 1 = right)
  originY: number; // 0-1 (0 = top, 0.5 = center, 1 = bottom)
}

export interface Transform3D extends Transform {
  perspective: number;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  translateZ: number;
}

// NEW: History System Types
export interface HistoryState {
  id: string;
  timestamp: number;
  type: 'full' | 'diff' | 'command';
  data: ImageData | DiffPatch | Command;
  memorySize: number;
  description: string;
}

export interface DiffPatch {
  layerId: string;
  changes: Array<{
    property: string;
    oldValue: any;
    newValue: any;
  }>;
}

export interface Command {
  type: string;
  execute: () => void;
  undo: () => void;
  redo: () => void;
  serialize: () => string;
}

// NEW: Gradient Types
export interface Gradient {
  type: 'linear' | 'radial' | 'angular' | 'diamond';
  stops: Array<{
    offset: number; // 0-1
    color: string;
    opacity: number;
  }>;
  angle?: number; // for linear
  center?: { x: number; y: number }; // for radial
  radius?: number; // for radial
}

// NEW: Filter Types
export interface Filter {
  type: 'blur' | 'sharpen' | 'noise' | 'custom';
  settings: Record<string, any>;
}

// NEW: Smart Guide Types
export interface SmartGuides {
  enabled: boolean;
  snapDistance: number;
  showDistances: boolean;
  showAlignment: boolean;
  magneticAlignment: boolean;
  gridSize?: number;
  showGrid?: boolean;
}

// NEW: Pen/Tablet Input Types
export interface PenInput {
  pressure: number; // 0-1
  tiltX: number; // -90 to 90
  tiltY: number; // -90 to 90
  rotation: number; // 0-360
  barrel: boolean; // side button pressed
  eraser: boolean; // using eraser end
  pointerType: 'mouse' | 'pen' | 'touch';
} 