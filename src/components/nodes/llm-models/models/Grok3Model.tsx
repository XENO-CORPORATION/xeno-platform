import React from 'react'; // Keep React import for JSX in renderModelSpecificSettings
import { BaseLLMModel } from '../BaseLLMModel';
import { LLMModelSettings, LLMModelResponse } from '../LLMModelInterface';

export class Grok3Model extends BaseLLMModel {
  name = 'Grok 3';
  description = 'xAI\'s latest multimodal model with real-time knowledge and a conversational, witty personality.';
  maxContextLength = 128000;
  
  // Grok 3 specific capabilities
  supportsStreaming = true;
  supportsFunctionCalling = true;
  supportsVision = true;
  
  defaultSettings: LLMModelSettings = {
    temperature: 0.7,
    maxTokens: 1000,
    prompt: '',
    topP: 0.9,
    repetitionPenalty: 1.1,
    webSearch: false,
    visionEnabled: false,
    wittyResponses: true
  };
  
  async generateText(prompt: string, settings: LLMModelSettings): Promise<LLMModelResponse> {
    // In a real implementation, this would call the Grok API
    console.log(`Generating text with Grok 3: ${prompt}`);
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 700));
    
    // Return mock response with witty tone if enabled
    const wittyPrefix = settings.wittyResponses ? "Well, that's an interesting question! " : "";
    
    return {
      text: `${wittyPrefix}This is a response from Grok 3 with temperature ${settings.temperature}.\n\nPrompt: ${prompt}\n\nGrok 3 is xAI's latest multimodal model with real-time knowledge and a conversational, witty personality.`,
      usage: {
        promptTokens: prompt.length / 4,
        completionTokens: 140,
        totalTokens: prompt.length / 4 + 140
      }
    };
  }
  
  async streamText(
    prompt: string, 
    settings: LLMModelSettings, 
    onChunk: (chunk: string) => void
  ): Promise<LLMModelResponse> {
    // In a real implementation, this would stream from the Grok API
    console.log(`Streaming text with Grok 3: ${prompt}`);
    
    const wittyPrefix = settings.wittyResponses ? "Well, that's an interesting question! " : "";
    const response = `${wittyPrefix}This is a response from Grok 3 with temperature ${settings.temperature}.\n\nPrompt: ${prompt}\n\nGrok 3 is xAI's latest multimodal model with real-time knowledge and a conversational, witty personality.`;
    
    // Simulate streaming by sending chunks of the response
    const chunks = response.split(' ');
    for (const chunk of chunks) {
      await new Promise(resolve => setTimeout(resolve, 75));
      onChunk(chunk + ' ');
    }
    
    return {
      text: response,
      usage: {
        promptTokens: prompt.length / 4,
        completionTokens: 140,
        totalTokens: prompt.length / 4 + 140
      }
    };
  }
  
  renderModelSpecificSettings(
    settings: LLMModelSettings, 
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    return (
      <>
        {/* Web Search Toggle */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-white/70">Web Search</label>
            <div className="relative inline-block w-10 align-middle select-none">
              <input
                type="checkbox"
                name="webSearch"
                id="grokWebSearch"
                checked={settings.webSearch}
                onChange={(e) => handleSettingChange('webSearch', e.target.checked)}
                className="sr-only"
              />
              <div className="block h-6 bg-black/30 rounded-full w-10"></div>
              <div 
                className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                  settings.webSearch ? 'transform translate-x-4 bg-green-500' : 'bg-white/50'
                }`}
              ></div>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50">Enable real-time web search for up-to-date information</p>
        </div>
        
        {/* Witty Responses Toggle */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-white/70">Witty Responses</label>
            <div className="relative inline-block w-10 align-middle select-none">
              <input
                type="checkbox"
                name="wittyResponses"
                id="grokWittyResponses"
                checked={settings.wittyResponses}
                onChange={(e) => handleSettingChange('wittyResponses', e.target.checked)}
                className="sr-only"
              />
              <div className="block h-6 bg-black/30 rounded-full w-10"></div>
              <div 
                className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                  settings.wittyResponses ? 'transform translate-x-4 bg-red-500' : 'bg-white/50'
                }`}
              ></div>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50">Enable Grok's characteristic witty personality</p>
        </div>
        
        {/* Vision Toggle */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-white/70">Vision</label>
            <div className="relative inline-block w-10 align-middle select-none">
              <input
                type="checkbox"
                name="visionEnabled"
                id="grokVisionEnabled"
                checked={settings.visionEnabled}
                onChange={(e) => handleSettingChange('visionEnabled', e.target.checked)}
                className="sr-only"
              />
              <div className="block h-6 bg-black/30 rounded-full w-10"></div>
              <div 
                className={`absolute left-1 top-1 w-4 h-4 rounded-full transition-transform ${
                  settings.visionEnabled ? 'transform translate-x-4 bg-red-500' : 'bg-white/50'
                }`}
              ></div>
            </div>
          </div>
          <p className="mt-2 text-xs text-white/50">Enable vision capabilities for image understanding</p>
        </div>
        
        {/* Repetition Penalty */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Repetition Penalty</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.repetitionPenalty}
            </span>
          </div>
          <input
            type="range"
            min="1.0"
            max="2.0"
            step="0.05"
            value={settings.repetitionPenalty}
            onChange={(e) => handleSettingChange('repetitionPenalty', parseFloat(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Higher values reduce repetition in responses</p>
        </div>
      </>
    );
  }
} 