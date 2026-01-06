import React, { useState, useEffect } from 'react';
import { BrainCircuit } from 'lucide-react';
import BaseNode, { 
  BaseNodeProps, 
  useNodeContent
} from './BaseNode';

const LLMNode: React.FC<BaseNodeProps> = (props) => {
  const [nodeSettings, setNodeSettings] = useState({
    model: 'gpt-4o',
    temperature: 0.7,
    maxTokens: 1000,
    prompt: '',
    topP: 0.9,
    frequencyPenalty: 0.0,
    presencePenalty: 0.0,
    systemMessage: '',
    stopSequences: '',
    maxResponseTokens: 2000,
    cacheResults: true,
    streamResponse: true
  });

  const { isExpanded, showAdvancedSettings } = useNodeContent();

  // Listen for model change events from BaseNode's direct implementation
  useEffect(() => {
    const handleModelChange = (event: CustomEvent) => {
      const { value, nodeId } = event.detail;
      
      // Only process events for this node
      if (nodeId === props.id) {
        setNodeSettings(prev => ({
          ...prev,
          model: value
        }));
      }
    };

    // Add event listener
    window.addEventListener('llm-model-change', handleModelChange as EventListener);
    
    // Clean up
    return () => {
      window.removeEventListener('llm-model-change', handleModelChange as EventListener);
    };
  }, [props.id]);

  // Listen for prompt change events from BaseNode's direct implementation
  useEffect(() => {
    const handlePromptChange = (event: CustomEvent) => {
      const { value, nodeId } = event.detail;
      
      // Only process events for this node
      if (nodeId === props.id) {
        setNodeSettings(prev => ({
          ...prev,
          prompt: value
        }));
      }
    };

    // Add event listener
    window.addEventListener('llm-prompt-change', handlePromptChange as EventListener);
    
    // Clean up
    return () => {
      window.removeEventListener('llm-prompt-change', handlePromptChange as EventListener);
    };
  }, [props.id]);

  const handleSettingChange = (key: string, value: any) => {
    setNodeSettings(prev => ({
      ...prev,
      [key]: value
    }));
  };

  // Create content for expanded state
  const expandedContent = (
    <div className="space-y-4">
      {/* Model Selection */}
      <div className="bg-black/20 rounded-lg p-4">
        <label className="block text-xs font-medium text-white/70 mb-2">Model Selection</label>
        <select 
          value={nodeSettings.model}
          onChange={(e) => handleSettingChange('model', e.target.value)}
          className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
        >
          <option value="gpt-4o">GPT-4o</option>
          <option value="claude-3-sonnet">Claude 3 Sonnet</option>
          <option value="gemini">Gemini</option>
          <option value="grok-3">Grok 3</option>
          <option value="ollama">Ollama</option>
        </select>
        <p className="mt-2 text-xs text-white/50">Select the language model to use for text generation</p>
      </div>

      {/* Prompt Input */}
      <div className="bg-black/20 rounded-lg p-4">
        <label className="block text-xs font-medium text-white/70 mb-2">Prompt Input</label>
        <textarea
          value={nodeSettings.prompt}
          onChange={(e) => handleSettingChange('prompt', e.target.value)}
          className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm min-h-[120px] focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20 resize-none"
          placeholder="Enter text prompt here..."
        />
        <p className="mt-2 text-xs text-white/50">Input text that will be used by the LLM or passed to image/video generators</p>
      </div>

      {/* Expanded settings */}
      <div className="mt-4 pt-4 border-t border-white/10">
        <div className="text-xs text-white/50 mb-3 font-medium">Expanded Settings</div>
        <div className="space-y-4">
          {/* Temperature Control */}
          <div className="bg-black/20 rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-medium text-white/70">Temperature</label>
              <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                {nodeSettings.temperature}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={nodeSettings.temperature}
              onChange={(e) => handleSettingChange('temperature', parseFloat(e.target.value))}
              className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
            />
            <div className="flex justify-between text-xs text-white/50 mt-2">
              <span>Precise</span>
              <span>Balanced</span>
              <span>Creative</span>
            </div>
            <p className="mt-2 text-xs text-white/50">Adjust response creativity and randomness</p>
          </div>

          {/* Max Tokens */}
          <div className="bg-black/20 rounded-lg p-4">
            <div className="flex justify-between items-center mb-2">
              <label className="text-xs font-medium text-white/70">Max Tokens</label>
              <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                {nodeSettings.maxTokens}
              </span>
            </div>
            <input
              type="range"
              min="100"
              max="4000"
              step="100"
              value={nodeSettings.maxTokens}
              onChange={(e) => handleSettingChange('maxTokens', parseInt(e.target.value))}
              className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
            />
            <p className="mt-2 text-xs text-white/50">Maximum number of tokens in the response</p>
          </div>
        </div>
      </div>

      {/* Advanced settings - only visible when toggled */}
      {showAdvancedSettings && (
        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="text-xs text-white/50 mb-3 font-medium">Advanced Settings</div>
          <div className="space-y-4">
            {/* Top P */}
            <div className="bg-black/20 rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-medium text-white/70">Top P</label>
                <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                  {nodeSettings.topP}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={nodeSettings.topP}
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
                  {nodeSettings.frequencyPenalty}
                </span>
              </div>
              <input
                type="range"
                min="-2"
                max="2"
                step="0.1"
                value={nodeSettings.frequencyPenalty}
                onChange={(e) => handleSettingChange('frequencyPenalty', parseFloat(e.target.value))}
                className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
              />
              <p className="mt-2 text-xs text-white/50">Reduces repetition of token sequences</p>
            </div>

            {/* Presence Penalty */}
            <div className="bg-black/20 rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-medium text-white/70">Presence Penalty</label>
                <span className="text-xs text-white/70 bg-black/30 px-2 py-1 rounded">
                  {nodeSettings.presencePenalty}
                </span>
              </div>
              <input
                type="range"
                min="-2"
                max="2"
                step="0.1"
                value={nodeSettings.presencePenalty}
                onChange={(e) => handleSettingChange('presencePenalty', parseFloat(e.target.value))}
                className="w-full accent-white/50 bg-black/30 rounded-lg h-1.5"
              />
              <p className="mt-2 text-xs text-white/50">Increases likelihood of discussing new topics</p>
            </div>

            {/* Other advanced settings */}
            <div className="bg-black/20 rounded-lg p-4">
              <label className="block text-xs font-medium text-white/70 mb-2">Stop Sequences</label>
              <input
                type="text"
                value={nodeSettings.stopSequences}
                onChange={(e) => handleSettingChange('stopSequences', e.target.value)}
                className="w-full bg-black/30 text-white border border-white/10 rounded-lg p-2 text-sm focus:outline-none focus:ring-1 focus:ring-white/20 transition-colors hover:border-white/20"
                placeholder="Comma separated sequences"
              />
              <p className="mt-2 text-xs text-white/50">Sequences that signal the API to stop generating</p>
            </div>

            {/* Toggles */}
            <div className="bg-black/20 rounded-lg p-4 flex space-x-4">
              <div className="flex-1">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={nodeSettings.cacheResults}
                    onChange={(e) => handleSettingChange('cacheResults', e.target.checked)}
                    className="w-4 h-4 accent-white/50 rounded"
                  />
                  <span className="text-xs font-medium text-white/70">Cache Results</span>
                </label>
                <p className="mt-1 text-xs text-white/50">Save results for reuse</p>
              </div>
              <div className="flex-1">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={nodeSettings.streamResponse}
                    onChange={(e) => handleSettingChange('streamResponse', e.target.checked)}
                    className="w-4 h-4 accent-white/50 rounded"
                  />
                  <span className="text-xs font-medium text-white/70">Stream Response</span>
                </label>
                <p className="mt-1 text-xs text-white/50">Show results as they generate</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <BaseNode 
      {...props} 
      icon={props.icon || <BrainCircuit size={16} />}
      nodeState={nodeSettings}
    >
      {expandedContent}
    </BaseNode>
  );
};

export default LLMNode;