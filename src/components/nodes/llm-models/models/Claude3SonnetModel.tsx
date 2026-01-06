import React from 'react'; // Keep React import for JSX in renderModelSpecificSettings
import { BaseLLMModel } from '../BaseLLMModel';
import { LLMModelSettings, LLMModelResponse } from '../LLMModelInterface';

export class Claude3SonnetModel extends BaseLLMModel {
  name = 'Claude 3 Sonnet';
  description = 'Anthropic\'s balanced model offering high-quality intelligence at increased speed and lower cost.';
  maxContextLength = 200000;
  
  // Claude 3 Sonnet specific capabilities
  supportsStreaming = true;
  supportsFunctionCalling = true;
  supportsVision = true;
  
  defaultSettings: LLMModelSettings = {
    temperature: 0.7,
    maxTokens: 1000,
    prompt: '',
    topK: 40,
    topP: 0.9,
    systemPrompt: 'You are Claude, an AI assistant created by Anthropic to be helpful, harmless, and honest.',
    visionEnabled: false
  };
  
  async generateText(prompt: string, settings: LLMModelSettings): Promise<LLMModelResponse> {
    // In a real implementation, this would call the Anthropic API
    console.log(`Generating text with Claude 3 Sonnet: ${prompt}`);
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Return mock response
    return {
      text: `This is a response from Claude 3 Sonnet with temperature ${settings.temperature}.\n\nPrompt: ${prompt}\n\nClaude 3 Sonnet is Anthropic's balanced model offering high-quality intelligence at increased speed and lower cost.`,
      usage: {
        promptTokens: prompt.length / 4,
        completionTokens: 120,
        totalTokens: prompt.length / 4 + 120
      }
    };
  }
  
  async streamText(
    prompt: string, 
    settings: LLMModelSettings, 
    onChunk: (chunk: string) => void
  ): Promise<LLMModelResponse> {
    // In a real implementation, this would stream from the Anthropic API
    console.log(`Streaming text with Claude 3 Sonnet: ${prompt}`);
    
    const response = `This is a response from Claude 3 Sonnet with temperature ${settings.temperature}.\n\nPrompt: ${prompt}\n\nClaude 3 Sonnet is Anthropic's balanced model offering high-quality intelligence at increased speed and lower cost.`;
    
    // Simulate streaming by sending chunks of the response
    const chunks = response.split(' ');
    for (const chunk of chunks) {
      await new Promise(resolve => setTimeout(resolve, 80));
      onChunk(chunk + ' ');
    }
    
    return {
      text: response,
      usage: {
        promptTokens: prompt.length / 4,
        completionTokens: 120,
        totalTokens: prompt.length / 4 + 120
      }
    };
  }
  
  renderModelSpecificSettings(
    settings: LLMModelSettings, 
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    return (
      <>
        {/* System Prompt */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">System Prompt</label>
          <textarea
            value={settings.systemPrompt}
            onChange={(e) => handleSettingChange('systemPrompt', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm min-h-[80px] focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20 resize-none"
            placeholder="Enter system instructions for Claude..."
          />
          <p className="mt-2 text-xs text-white/50">Define Claude's behavior and personality</p>
        </div>
        
        {/* Vision Toggle */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-white/70">Vision</label>
            <div className="relative inline-block w-10 align-middle select-none">
              <input
                type="checkbox"
                name="visionEnabled"
                id="claudeVisionEnabled"
                checked={settings.visionEnabled}
                onChange={(e) => handleSettingChange('visionEnabled', e.target.checked)}
                className="sr-only"
              />
              <div className="block h-6 bg-black/30 rounded-full w-10"></div>
              <div 
                className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                  settings.visionEnabled ? 'transform translate-x-4 bg-purple-500' : 'bg-white/50'
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
      </>
    );
  }
} 