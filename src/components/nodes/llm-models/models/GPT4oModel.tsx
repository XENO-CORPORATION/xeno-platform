import React from 'react'; // Keep React import for JSX in renderModelSpecificSettings
import { BaseLLMModel } from '../BaseLLMModel';
import { LLMModelSettings, LLMModelResponse } from '../LLMModelInterface';

export class GPT4oModel extends BaseLLMModel {
  name = 'GPT-4o';
  description = 'OpenAI\'s most advanced multimodal model, capable of processing both text and images with state-of-the-art performance.';
  maxContextLength = 128000;
  
  // GPT-4o specific capabilities
  supportsStreaming = true;
  supportsFunctionCalling = true;
  supportsVision = true;
  
  defaultSettings: LLMModelSettings = {
    temperature: 0.7,
    maxTokens: 1000,
    prompt: '',
    topP: 1,
    frequencyPenalty: 0,
    presencePenalty: 0,
    visionEnabled: false
  };
  
  async generateText(prompt: string, settings: LLMModelSettings): Promise<LLMModelResponse> {
    // In a real implementation, this would call the OpenAI API
    console.log(`Generating text with GPT-4o: ${prompt}`);
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Return mock response
    return {
      text: `This is a response from GPT-4o with temperature ${settings.temperature}.\n\nPrompt: ${prompt}\n\nGPT-4o is OpenAI's most advanced multimodal model, capable of processing both text and images with state-of-the-art performance.`,
      usage: {
        promptTokens: prompt.length / 4,
        completionTokens: 150,
        totalTokens: prompt.length / 4 + 150
      }
    };
  }
  
  async streamText(
    prompt: string, 
    settings: LLMModelSettings, 
    onChunk: (chunk: string) => void
  ): Promise<LLMModelResponse> {
    // In a real implementation, this would stream from the OpenAI API
    console.log(`Streaming text with GPT-4o: ${prompt}`);
    
    const response = `This is a response from GPT-4o with temperature ${settings.temperature}.\n\nPrompt: ${prompt}\n\nGPT-4o is OpenAI's most advanced multimodal model, capable of processing both text and images with state-of-the-art performance.`;
    
    // Simulate streaming by sending chunks of the response
    const chunks = response.split(' ');
    for (const chunk of chunks) {
      await new Promise(resolve => setTimeout(resolve, 100));
      onChunk(chunk + ' ');
    }
    
    return {
      text: response,
      usage: {
        promptTokens: prompt.length / 4,
        completionTokens: 150,
        totalTokens: prompt.length / 4 + 150
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
                id="visionEnabled"
                checked={settings.visionEnabled}
                onChange={(e) => handleSettingChange('visionEnabled', e.target.checked)}
                className="sr-only"
              />
              <div className="block h-6 bg-black/30 rounded-full w-10"></div>
              <div 
                className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                  settings.visionEnabled ? 'transform translate-x-4 bg-yellow-500' : 'bg-white/50'
                }`}
              ></div>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50">Enable vision capabilities for image understanding</p>
        </div>
        
        {/* Advanced Settings */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Top P</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.topP}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.topP}
            onChange={(e) => handleSettingChange('topP', parseFloat(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Controls diversity via nucleus sampling</p>
        </div>
        
        {/* Frequency Penalty */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Frequency Penalty</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.frequencyPenalty}
            </span>
          </div>
          <input
            type="range"
            min="-2"
            max="2"
            step="0.1"
            value={settings.frequencyPenalty}
            onChange={(e) => handleSettingChange('frequencyPenalty', parseFloat(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Reduces repetition of token sequences</p>
        </div>
      </>
    );
  }
} 