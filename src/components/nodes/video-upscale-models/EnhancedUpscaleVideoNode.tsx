import React, { useState, useEffect } from 'react';
import BaseNode, { BaseNodeProps } from '../BaseNode';
import { ArrowUpRight } from 'lucide-react';
import { getModelImplementation, getAvailableModelNames } from './ModelRegistry';
import { VideoUpscaleModelInterface, VideoUpscaleModelSettings } from './VideoUpscaleModelInterface';

interface EnhancedUpscaleVideoNodeProps extends BaseNodeProps {
  initialModel?: string;
}

const EnhancedUpscaleVideoNode: React.FC<EnhancedUpscaleVideoNodeProps> = (props) => {
  const { initialModel, ...nodeProps } = props;
  const availableModels = getAvailableModelNames();
  const [selectedModelName, setSelectedModelName] = useState<string>(
    initialModel && availableModels.includes(initialModel) 
      ? initialModel 
      : availableModels[0] || ''
  );
  const [modelImplementation, setModelImplementation] = useState<VideoUpscaleModelInterface | null>(null);
  const [settings, setSettings] = useState<VideoUpscaleModelSettings>({
    upscaleFactor: 2,
    denoise: 50,
    enhanceDetails: true,
    preserveColors: true,
    frameConsistency: 0.7
  });

  // Load the model implementation when the selected model changes
  useEffect(() => {
    if (selectedModelName) {
      const implementation = getModelImplementation(selectedModelName);
      setModelImplementation(implementation);
      
      // Reset settings to the default for the newly selected model
      if (implementation) {
        setSettings(implementation.defaultSettings);
      }
    }
  }, [selectedModelName]);

  const handleSettingChange = (key: string, value: any) => {
    setSettings((prev: VideoUpscaleModelSettings) => ({
      ...prev,
      [key]: value
    }));
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedModelName(e.target.value);
  };

  return (
    <BaseNode {...nodeProps} icon={props.icon || <ArrowUpRight size={16} />}>
      <div className="space-y-4">
        {/* Model Selection */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Model Selection</label>
          <select 
            value={selectedModelName}
            onChange={handleModelChange}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
          >
            {availableModels.map(model => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
          <p className="mt-2 text-xs text-white/70">
            {modelImplementation?.description || 'Choose a video upscaler model'}
          </p>
        </div>

        {/* Model Capabilities */}
        {modelImplementation && (
          <div className="bg-black/20 rounded-lg p-4">
            <h4 className="text-xs font-medium text-white/70 mb-3">Model Capabilities</h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${modelImplementation.supportsFaceEnhancement ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <span className="text-white/70">Face Enhancement</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${modelImplementation.supportsDenoising ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <span className="text-white/70">Denoising</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${modelImplementation.supportsArtifactRemoval ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <span className="text-white/70">Artifact Removal</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${modelImplementation.supportsFrameInterpolation ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <span className="text-white/70">Frame Interpolation</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${modelImplementation.supportsSlowMotion ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <span className="text-white/70">Slow Motion</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className={`w-2 h-2 rounded-full ${modelImplementation.supportsHDREnhancement ? 'bg-green-500' : 'bg-red-500'}`}></div>
                <span className="text-white/70">HDR Enhancement</span>
              </div>
            </div>
          </div>
        )}

        {/* Upscale Factor */}
        {modelImplementation && (
          <div className="bg-black/20 rounded-lg p-4">
            <label className="block text-xs font-medium text-white/70 mb-2">Upscale Factor</label>
            <div className="grid grid-cols-4 gap-2">
              {modelImplementation.supportedUpscaleFactors.map((factor) => (
                <button
                  key={factor}
                  onClick={() => handleSettingChange('upscaleFactor', factor)}
                  className={`p-2 text-xs rounded-lg border transition-colors ${
                    settings.upscaleFactor === factor
                      ? 'bg-white/20 border-white/30 text-white'
                      : 'bg-black/30 border-white/10 text-white/70 hover:border-white/20'
                  }`}
                >
                  {factor}x
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-white/50">Maximum supported: {modelImplementation.maxUpscaleFactor}x</p>
          </div>
        )}

        {/* Common Settings */}
        {modelImplementation && settings && (
          <>
            {/* Denoise Level */}
            <div className="bg-black/20 rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-medium text-white/70">Denoise Level</label>
                <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                  {settings.denoise}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={settings.denoise}
                onChange={(e) => handleSettingChange('denoise', parseInt(e.target.value))}
                className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
              />
              <p className="mt-2 text-xs text-white/50">Amount of noise reduction to apply</p>
            </div>

            {/* Detail Enhancement Toggle */}
            <div className="bg-black/20 rounded-lg p-4">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-white/70">Enhance Details</label>
                <div className="relative inline-block w-10 align-middle select-none">
                  <input
                    type="checkbox"
                    id="enhanceDetails"
                    checked={settings.enhanceDetails === true}
                    onChange={(e) => handleSettingChange('enhanceDetails', e.target.checked)}
                    className="sr-only"
                  />
                  <div className="block h-6 bg-black/30 rounded-full w-10"></div>
                  <div 
                    className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                      settings.enhanceDetails === true ? 'transform translate-x-4 bg-blue-500' : 'bg-white/50'
                    }`}
                  ></div>
                </div>
              </div>
              <p className="mt-2 text-xs text-white/50">Improve sharpness and detail clarity</p>
            </div>

            {/* Preserve Colors Toggle */}
            <div className="bg-black/20 rounded-lg p-4">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-white/70">Preserve Colors</label>
                <div className="relative inline-block w-10 align-middle select-none">
                  <input
                    type="checkbox"
                    id="preserveColors"
                    checked={settings.preserveColors === true}
                    onChange={(e) => handleSettingChange('preserveColors', e.target.checked)}
                    className="sr-only"
                  />
                  <div className="block h-6 bg-black/30 rounded-full w-10"></div>
                  <div 
                    className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                      settings.preserveColors === true ? 'transform translate-x-4 bg-blue-500' : 'bg-white/50'
                    }`}
                  ></div>
                </div>
              </div>
              <p className="mt-2 text-xs text-white/50">Maintain original color balance</p>
            </div>

            {/* Frame Consistency */}
            <div className="bg-black/20 rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-medium text-white/70">Frame Consistency</label>
                <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                  {(settings.frameConsistency * 100).toFixed()}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={settings.frameConsistency}
                onChange={(e) => handleSettingChange('frameConsistency', parseFloat(e.target.value))}
                className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
              />
              <p className="mt-2 text-xs text-white/50">Temporal consistency between frames</p>
            </div>
          </>
        )}

        {/* Model-specific Settings */}
        {modelImplementation && settings && (
          <div className="space-y-4">
            {modelImplementation.renderModelSettings(settings, handleSettingChange)}
          </div>
        )}
      </div>
    </BaseNode>
  );
};

export default EnhancedUpscaleVideoNode; 