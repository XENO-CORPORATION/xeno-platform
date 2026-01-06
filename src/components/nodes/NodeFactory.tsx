import React from 'react';
import { BrainCircuit, Image, Video, ArrowUpRight, Zap, Layers, Save, Eye, Link } from 'lucide-react';
import { NodeTemplate } from '../canvas/AgentPanel';
import LLMNode from './LLMNode';
import { EnhancedLLMNode } from './llm-models';
import ImageNode from './ImageNode';
import { EnhancedImageNode } from './image-models';
import VideoNode from './VideoNode';
import { EnhancedVideoNode } from './video-models';
import UpscaleImageNode from './UpscaleImageNode';
import { EnhancedUpscaleImageNode } from './upscale-models';
import UpscaleVideoNode from './UpscaleVideoNode';
import UtilityNode from './UtilityNode';
import LoRANode from './LoRANode';
import SaveNode from './SaveNode';
import PreviewNode from './PreviewNode';
import BridgeNode from './BridgeNode';
import { EnhancedPreviewNode } from './preview-nodes';

interface NodeProps {
  key?: string;
  id: number;
  title: string;
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
  inputs?: Array<{ id: string; type: string; label: string }>;
  outputs?: Array<{ id: string; type: string; label: string }>;
  onStartConnection?: (outputId: string, e: React.MouseEvent) => void;
  onCompleteConnection?: (inputId: string, e: React.MouseEvent) => void;
  icon?: React.ReactNode;
}

// Helper function to get the appropriate icon based on node type
export const getNodeIcon = (type: string): React.ReactNode => {
  switch (type) {
    case 'llm':
      return <BrainCircuit size={16} />;
    case 'image':
      return <Image size={16} />;
    case 'video':
      return <Video size={16} />;
    case 'upscale-image':
    case 'upscale-video':
      return <ArrowUpRight size={16} />;
    case 'utility':
      return <Zap size={16} />;
    case 'lora':
      return <Layers size={16} />;
    case 'save':
      return <Save size={16} />;
    case 'preview':
      return <Eye size={16} />;
    case 'bridge':
      return <Link size={16} />;
    default:
      return <Zap size={16} />;
  }
};

// Factory function to create the appropriate node component
export const createNode = (props: NodeProps): JSX.Element => {
  const { type, key } = props;
  const { key: _, ...nodeProps } = props;
  // Add icon if not provided
  const propsWithIcon = {
    ...nodeProps,
    icon: props.icon || getNodeIcon(type)
  };
  
  switch (type) {
    case 'llm':
      return <EnhancedLLMNode key={key || `node-${props.id}`} {...propsWithIcon} />;
    case 'image':
      return <EnhancedImageNode key={key || `node-${props.id}`} {...propsWithIcon} />;
    case 'video':
      return <EnhancedVideoNode key={key || `node-${props.id}`} {...propsWithIcon} />;
    case 'upscale-image':
      return <EnhancedUpscaleImageNode key={key || `node-${props.id}`} {...propsWithIcon} />;
    case 'upscale-video':
      return <UpscaleVideoNode key={key || `node-${props.id}`} {...propsWithIcon} />;
    case 'utility':
      return <UtilityNode key={key || `node-${props.id}`} {...propsWithIcon} />;
    case 'lora':
      return <LoRANode key={key || `node-${props.id}`} {...propsWithIcon} />;
    case 'save':
      return <SaveNode 
        key={key || `node-${props.id}`}
        {...propsWithIcon}
      />;
    case 'preview':
      return <EnhancedPreviewNode key={key || `node-${props.id}`} {...propsWithIcon} />;
    case 'bridge':
      return <BridgeNode 
        key={key || `node-${props.id}`}
        {...propsWithIcon}
      />;
    default:
      return <UtilityNode key={key || `node-${props.id}`} {...propsWithIcon} />;
  }
};

// Function to create a node from a template
export const createNodeFromTemplate = (template: NodeTemplate, position: { x: number; y: number }, id: number) => {
  return {
    id,
    title: template.title,
    icon: getNodeIcon(template.type),
    description: template.description,
    type: template.type,
    position,
    inputs: template.inputs,
    outputs: template.outputs
  };
};