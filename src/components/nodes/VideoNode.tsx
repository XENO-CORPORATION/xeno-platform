import React, { useState } from 'react';
import { Video } from 'lucide-react';
import BaseNode, { BaseNodeProps } from './BaseNode';

const VideoNode: React.FC<BaseNodeProps> = (props) => {
  const [nodeSettings, setNodeSettings] = useState({
    model: 'luma-ray-2',
    duration: 3,
    fps: 24
  });

  const handleSettingChange = (key: string, value: any) => {
    setNodeSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  const renderSettings = () => (
    <div className="space-y-4">
      {/* Model Selection */}
      <div className="bg-black/20 rounded-lg p-4">
        <label className="block text-xs font-medium text-white/70 mb-2">Model Selection</label>
        <select 
          value={nodeSettings.model}
          onChange={(e) => handleSettingChange('model', e.target.value)}
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

      {/* Duration Control */}
      <div className="bg-black/20 rounded-lg p-4">
        <div className="flex justify-between items-center mb-2">
          <label className="text-xs font-medium text-white/70">Duration</label>
          <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
            {nodeSettings.duration}s
          </span>
        </div>
        <input
          type="range"
          min="1"
          max="10"
          value={nodeSettings.duration}
          onChange={(e) => handleSettingChange('duration', parseInt(e.target.value))}
          className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
        />
        <p className="mt-2 text-xs text-white/50">Set the output video duration in seconds</p>
      </div>

      {/* Frame Rate Selection */}
      <div className="bg-black/20 rounded-lg p-4">
        <label className="block text-xs font-medium text-white/70 mb-2">Frame Rate</label>
        <div className="grid grid-cols-3 gap-2">
          {[24, 30, 60].map((rate) => (
            <button
              key={rate}
              onClick={() => handleSettingChange('fps', rate)}
              className={`p-2 text-xs rounded-lg border transition-colors ${
                nodeSettings.fps === rate
                  ? 'bg-white/20 border-white/30 text-white'
                  : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
              }`}
            >
              {rate} FPS
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-white/50">Choose the video frame rate</p>
      </div>
    </div>
  );

  return (
    <BaseNode {...props} icon={props.icon || <Video size={16} />}>
      {renderSettings()}
    </BaseNode>
  );
};

export default VideoNode;