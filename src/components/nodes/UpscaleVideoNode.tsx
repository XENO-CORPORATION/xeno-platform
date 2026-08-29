import React from 'react';
import { EnhancedUpscaleVideoNode } from './video-upscale-models';
import { BaseNodeProps } from './BaseNode';

const UpscaleVideoNode: React.FC<BaseNodeProps> = (props) => {
  return <EnhancedUpscaleVideoNode {...props} initialModel="Topaz Video AI" />;
};

export default UpscaleVideoNode;
