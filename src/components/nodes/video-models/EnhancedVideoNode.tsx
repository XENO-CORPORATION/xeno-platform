import React, { useState, useEffect } from 'react';
import { Video } from 'lucide-react';
import BaseNode, { BaseNodeProps } from '../BaseNode';
import { VideoModelInterface, VideoModelSettings } from './VideoModelInterface';
import { getModelImplementation } from './ModelRegistry';

interface EnhancedVideoNodeProps extends BaseNodeProps {
  initialModel?: string;
}

const EnhancedVideoNode: React.FC<EnhancedVideoNodeProps> = (props) => {
  // Get the initial model from props or default to Luma Ray 2
  const initialModelName = props.initialModel || 'luma-ray-2';
  
  // State for the selected model and settings
  const [selectedModelName, setSelectedModelName] = useState(initialModelName);
  const [modelImplementation, setModelImplementation] = useState<VideoModelInterface | null>(null);
  const [settings, setSettings] = useState<VideoModelSettings>({
    duration: 3,
    fps: 24,
    motionStrength: 50
  });
  
  // Load the model implementation when the selected model changes
  useEffect(() => {
    const implementation = getModelImplementation(selectedModelName);
    setModelImplementation(implementation);
    
    // Update settings with model-specific defaults
    if (implementation) {
      setSettings(prev => ({
        ...implementation.defaultSettings,
        // Preserve user values if they exist
        ...(prev.duration ? { duration: prev.duration } : {}),
        ...(prev.fps ? { fps: prev.fps } : {})
      }));
    }
  }, [selectedModelName]);
  
  // Handle setting changes
  const handleSettingChange = (key: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };
  
  // Handle model selection change
  const handleModelChange = (modelName: string) => {
    setSelectedModelName(modelName);
  };
  
  // Render the node settings
  const renderSettings = () => (
    <div className="space-y-4">
      {/* Model Selection */}
      <div className="bg-black/20 rounded-lg p-4">
        <label className="block text-xs font-medium text-white/70 mb-2">Model Selection</label>
        <select 
          value={selectedModelName}
          onChange={(e) => handleModelChange(e.target.value)}
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
          <option value="wan-2.1-1.3b">Wan 2.1</option>
          <option value="minimax-video-01">Minimax Video 01</option>
        </select>
        <p className="mt-2 text-xs text-white/50">Select the video generation model</p>
      </div>
      
      {/* Model capabilities info */}
      {modelImplementation && (
        <div className="bg-black/20 rounded-lg p-4">
          <p className="text-xs text-white/70 leading-relaxed">
            {modelImplementation.description}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {modelImplementation.supportsTextToVideo && (
              <span className="text-[10px] bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">Text-to-Video</span>
            )}
            {modelImplementation.supportsImageToVideo && (
              <span className="text-[10px] bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">Image-to-Video</span>
            )}
            {modelImplementation.supportsVideoToVideo && (
              <span className="text-[10px] bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded-full">Video-to-Video</span>
            )}
            {modelImplementation.supportsMusicGeneration && (
              <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full">Music Gen</span>
            )}
            {modelImplementation.supportsExtendedDuration && (
              <span className="text-[10px] bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full">Extended Duration</span>
            )}
          </div>
        </div>
      )}
      
      {/* Model-specific settings */}
      {modelImplementation && (
        modelImplementation.renderModelSettings(settings, handleSettingChange)
      )}
    </div>
  );
  
  return (
    <BaseNode {...props} icon={props.icon || <Video size={16} />}>
      {renderSettings()}
    </BaseNode>
  );
};

export default EnhancedVideoNode; 