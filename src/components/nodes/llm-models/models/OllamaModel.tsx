import React from 'react'; // Keep React import for JSX in renderModelSpecificSettings
import { BaseLLMModel } from '../BaseLLMModel';
import { LLMModelSettings, LLMModelResponse } from '../LLMModelInterface';

export class OllamaModel extends BaseLLMModel {
  name = 'Ollama';
  description = 'Run various open-source models locally on your own hardware with customizable settings.';
  maxContextLength = 8192; // Varies by specific model
  
  // Ollama specific capabilities
  supportsStreaming = true;
  supportsFunctionCalling = false;
  supportsVision = false; // Some models support vision
  
  defaultSettings: LLMModelSettings = {
    temperature: 0.7,
    maxTokens: 1000,
    prompt: '',
    specificModel: 'llama3',
    topK: 40,
    topP: 0.9,
    repeatPenalty: 1.1,
    seed: 0,
    availableModels: [
      { id: 'llama3', name: 'Llama 3 (8B)' },
      { id: 'mistral', name: 'Mistral (7B)' },
      { id: 'codellama', name: 'CodeLlama (7B)' },
      { id: 'phi3', name: 'Phi-3 (3.8B)' },
      { id: 'llava', name: 'LLaVA (Vision)' },
      { id: 'vicuna', name: 'Vicuna (7B)' }
    ]
  };
  
  async generateText(prompt: string, settings: LLMModelSettings): Promise<LLMModelResponse> {
    // In a real implementation, this would call the local Ollama API
    console.log(`Generating text with Ollama (${settings.specificModel}): ${prompt}`);
    
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 1200)); // Local models might be slower
    
    // Return mock response
    return {
      text: `This is a response from Ollama (${settings.specificModel}) with temperature ${settings.temperature}.\n\nPrompt: ${prompt}\n\nOllama allows you to run various open-source models locally on your own hardware with customizable settings.`,
      usage: {
        promptTokens: prompt.length / 4,
        completionTokens: 110,
        totalTokens: prompt.length / 4 + 110
      }
    };
  }
  
  async streamText(
    prompt: string, 
    settings: LLMModelSettings, 
    onChunk: (chunk: string) => void
  ): Promise<LLMModelResponse> {
    // In a real implementation, this would stream from the local Ollama API
    console.log(`Streaming text with Ollama (${settings.specificModel}): ${prompt}`);
    
    const response = `This is a response from Ollama (${settings.specificModel}) with temperature ${settings.temperature}.\n\nPrompt: ${prompt}\n\nOllama allows you to run various open-source models locally on your own hardware with customizable settings.`;
    
    // Simulate streaming by sending chunks of the response
    const chunks = response.split(' ');
    for (const chunk of chunks) {
      await new Promise(resolve => setTimeout(resolve, 120)); // Local models might stream slower
      onChunk(chunk + ' ');
    }
    
    return {
      text: response,
      usage: {
        promptTokens: prompt.length / 4,
        completionTokens: 110,
        totalTokens: prompt.length / 4 + 110
      }
    };
  }
  
  renderModelSpecificSettings(
    settings: LLMModelSettings, 
    handleSettingChange: (key: string, value: any) => void
  ): JSX.Element {
    // Update vision capability based on selected model
    const hasVisionCapability = settings.specificModel === 'llava';
    if (this.supportsVision !== hasVisionCapability) {
      this.supportsVision = hasVisionCapability;
    }
    
    return (
      <>
        {/* Specific Model Selection */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Specific Model</label>
          <select 
            value={settings.specificModel}
            onChange={(e) => handleSettingChange('specificModel', e.target.value)}
            className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
          >
            {settings.availableModels?.map((model: { id: string, name: string }) => (
              <option key={model.id} value={model.id}>{model.name}</option>
            ))}
          </select>
          <p className="mt-2 text-xs text-white/50">Select the specific model to run locally</p>
        </div>
        
        {/* Connection Settings */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Connection</label>
          <div className="flex space-x-2">
            <input
              type="text"
              value={settings.host || 'http://localhost:11434'}
              onChange={(e) => handleSettingChange('host', e.target.value)}
              className="flex-grow bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
              placeholder="http://localhost:11434"
            />
            <button 
              className="bg-black/30 text-white/70 border border-white/10 rounded-lg px-3 hover:bg-black/40 hover:text-white transition-colors"
              onClick={() => console.log('Testing connection to Ollama...')}
            >
              Test
            </button>
          </div>
          <p className="mt-2 text-xs text-white/50">Ollama API endpoint (default: http://localhost:11434)</p>
        </div>
        
        {/* Advanced Settings */}
        <div className="bg-black/20 rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-medium text-white/70">Repeat Penalty</label>
            <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
              {settings.repeatPenalty}
            </span>
          </div>
          <input
            type="range"
            min="1.0"
            max="2.0"
            step="0.05"
            value={settings.repeatPenalty}
            onChange={(e) => handleSettingChange('repeatPenalty', parseFloat(e.target.value))}
            className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
          />
          <p className="mt-2 text-xs text-white/50">Higher values reduce repetition in responses</p>
        </div>
        
        {/* Seed Setting */}
        <div className="bg-black/20 rounded-lg p-4">
          <label className="block text-xs font-medium text-white/70 mb-2">Random Seed</label>
          <div className="flex items-center space-x-2">
            <input
              type="number"
              value={settings.seed}
              onChange={(e) => handleSettingChange('seed', parseInt(e.target.value) || 0)}
              className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20"
              placeholder="0 (random)"
            />
            <button 
              className="bg-black/30 text-white/70 border border-white/10 rounded-lg px-3 hover:bg-black/40 hover:text-white transition-colors"
              onClick={() => handleSettingChange('seed', Math.floor(Math.random() * 1000000))}
            >
              Random
            </button>
          </div>
          <p className="mt-2 text-xs text-white/50">Set to 0 for random results, or specify for reproducible outputs</p>
        </div>
        
        {/* Vision capabilities note for LLaVA */}
        {settings.specificModel === 'llava' && (
          <div className="bg-black/20 rounded-lg p-4">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 rounded-full bg-green-500"></div>
              <span className="text-xs text-white/70">Vision capabilities available with LLaVA</span>
            </div>
          </div>
        )}
      </>
    );
  }
} 