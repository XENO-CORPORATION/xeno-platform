import React from 'react'; // Keep React import for JSX in renderModelSpecificSettings
import { BaseLLMModel } from '../BaseLLMModel';
import { LLMModelSettings, LLMModelResponse } from '../LLMModelInterface';

export class GeminiModel extends BaseLLMModel {
  name = 'Gemini';
  description = 'Google\'s most capable and general multimodal model, with advanced reasoning and language understanding.';
  maxContextLength = 32768;
  
  // Gemini specific capabilities
  supportsStreaming = true;
  supportsFunctionCalling = true;
  supportsVision = true;
  
  defaultSettings: LLMModelSettings = {
    temperature: 0.7,
    maxTokens: 1000,
    prompt: '',
    topK: 40,
    topP: 0.95,
    safetySettings: {
      harassment: 'block_medium_and_above',
      hateSpeech: 'block_medium_and_above',
      sexuallyExplicit: 'block_medium_and_above',
      dangerous: 'block_medium_and_above'
    },
    visionEnabled: false
  };
  
  async generateText(prompt: string, settings: LLMModelSettings): Promise<LLMModelResponse> {
    // In a real implementation, this would call the Google AI API
    console.log(`Generating text with Gemini: ${prompt}`);
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 600));
    
    // Return mock response
    return {
      text: `This is a response from Gemini with temperature ${settings.temperature}.\n\nPrompt: ${prompt}\n\nGemini is Google's most capable and general multimodal model, with advanced reasoning and language understanding.`,
      usage: {
        promptTokens: prompt.length / 4,
        completionTokens: 130,
        totalTokens: prompt.length / 4 + 130
      }
    };
  }
  
  async streamText(
    prompt: string, 
    settings: LLMModelSettings, 
    onChunk: (chunk: string) => void
  ): Promise<LLMModelResponse> {
    // In a real implementation, this would stream from the Google AI API
    console.log(`Streaming text with Gemini: ${prompt}`);
    
    const response = `This is a response from Gemini with temperature ${settings.temperature}.\n\nPrompt: ${prompt}\n\nGemini is Google's most capable and general multimodal model, with advanced reasoning and language understanding.`;
    
    // Simulate streaming by sending chunks of the response
    const chunks = response.split(' ');
    for (const chunk of chunks) {
      await new Promise(resolve => setTimeout(resolve, 70));
      onChunk(chunk + ' ');
    }
    
    return {
      text: response,
      usage: {
        promptTokens: prompt.length / 4,
        completionTokens: 130,
        totalTokens: prompt.length / 4 + 130
      }
    };
  }
  
  renderModelSpecificSettings(
    settings: LLMModelSettings, 
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    return (
      <>
        {/* Vision Toggle */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-white/70">Vision</label>
            <div className="relative inline-block w-10 align-middle select-none">
              <input
                type="checkbox"
                name="visionEnabled"
                id="geminiVisionEnabled"
                checked={settings.visionEnabled}
                onChange={(e) => handleSettingChange('visionEnabled', e.target.checked)}
                className="sr-only"
              />
              <div className="block h-6 bg-black/30 rounded-full w-10"></div>
              <div 
                className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                  settings.visionEnabled ? 'transform translate-x-4 bg-blue-500' : 'bg-white/50'
                }`}
              ></div>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50">Enable vision capabilities for image understanding</p>
        </div>
        
        {/* Safety Settings */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Safety Settings</label>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/70">Safety Level</span>
              <select
                value={settings.safetySettings?.harassment || 'block_medium_and_above'}
                onChange={(e) => handleSettingChange('safetySettings', {
                  ...settings.safetySettings,
                  harassment: e.target.value,
                  hateSpeech: e.target.value,
                  sexuallyExplicit: e.target.value,
                  dangerous: e.target.value
                })}
                className="bg-black/30 text-white border border-white/10 rounded-lg p-1 text-xs focus:outline-none focus:ring-1 focus:ring-white/20"
              >
                <option value="block_none">None</option>
                <option value="block_only_high">Block High</option>
                <option value="block_medium_and_above">Block Medium & High</option>
                <option value="block_low_and_above">Block All</option>
              </select>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50">Configure content filtering settings</p>
        </div>
        
        {/* Advanced Settings */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Top K</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.topK}
            </span>
          </div>
          <input
            type="range"
            min="1"
            max="100"
            step="1"
            value={settings.topK}
            onChange={(e) => handleSettingChange('topK', parseInt(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Limits token selection to top K options</p>
        </div>
      </>
    );
  }
} 