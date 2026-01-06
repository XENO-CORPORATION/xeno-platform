import React, { useState, useEffect } from 'react';
import { BrainCircuit } from 'lucide-react';
import BaseNode, { BaseNodeProps } from '../BaseNode';
import { LLMModelInterface, LLMModelSettings } from './LLMModelInterface';
import { getModelImplementation } from './ModelRegistry';

interface EnhancedLLMNodeProps extends BaseNodeProps {
  initialModel?: string;
}

const EnhancedLLMNode: React.FC<EnhancedLLMNodeProps> = (props) => {
  // Get the initial model from props or default to GPT-4o
  const initialModelName = props.initialModel || 'gpt-4o';
  
  // State for the selected model and settings
  const [selectedModelName, setSelectedModelName] = useState(initialModelName);
  const [modelImplementation, setModelImplementation] = useState<LLMModelInterface | null>(null);
  const [settings, setSettings] = useState<LLMModelSettings>({
    temperature: 0.7,
    maxTokens: 1000,
    prompt: ''
  });
  
  // Load the model implementation when the selected model changes
  useEffect(() => {
    const implementation = getModelImplementation(selectedModelName);
    setModelImplementation(implementation);
    
    // Update settings with model-specific defaults
    if (implementation) {
      setSettings(prev => ({
        ...implementation.defaultSettings,
        // Preserve user-entered prompt if it exists
        prompt: prev.prompt || implementation.defaultSettings.prompt
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
          <option value="gpt-4o">GPT-4o</option>
          <option value="claude-3-sonnet">Claude 3 Sonnet</option>
          <option value="gemini">Gemini</option>
          <option value="grok-3">Grok 3</option>
          <option value="ollama">Ollama</option>
        </select>
        <p className="mt-2 text-xs text-white/50">Select the language model to use for text generation</p>
      </div>
      
      {/* Model-specific settings */}
      {modelImplementation && (
        modelImplementation.renderModelSettings(settings, handleSettingChange)
      )}
    </div>
  );
  
  return (
    <BaseNode {...props} icon={props.icon || <BrainCircuit size={16} />}>
      {renderSettings()}
    </BaseNode>
  );
};

export default EnhancedLLMNode; 